// Widget-rendering tools, bound to a session. Each pushes a typed widget into
// that session's workspace over its event stream and returns the widget id.

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getDuck } from '../db/duck.js';
import { getDiagram } from '../db/topology.js';
import { annotationsBySensor } from '../db/memory.js';
import { emitWidget, type ToolContext } from './context.js';
import type {
  ChartSpec,
  DataQualitySpec,
  InsightCardSpec,
  NodeStatus,
  StateSummarySpec,
  TopologySpec
} from '../types.js';

const STATUS = z.enum(['ok', 'warn', 'alert', 'stale', 'inferred', 'missing']);
const stateSummaryItem = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
  status: STATUS.optional(),
  delta: z.number().optional(),
  comparison: z
    .string()
    .optional()
    .describe('Short comparison context, e.g. "+0.6 kWh vs expected" or "largest visible zone load"'),
  note: z
    .string()
    .optional()
    .describe('One concise operator-facing meaning, only when grounded in queried data')
});

const topoNode = z.object({
  id: z.string(),
  label: z.string(),
  sensorId: z.number().optional(),
  energyType: z.string().nullable().optional(),
  role: z.string().optional(),
  branch: z.string().optional(),
  group: z.string().optional(),
  status: STATUS.optional(),
  value: z.number().optional(),
  unit: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional()
});
const topoEdge = z.object({
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  emphasis: z.boolean().optional(),
  animated: z.boolean().optional()
});

const REPLACE_ID_DESC =
  'To UPDATE an existing widget in place (e.g. the user asks to change a chart/topology already shown), pass its id from a previous render result. Omit to create a new widget.';

const CHART_TYPE = z.enum(['line', 'area', 'bar', 'scatter']);
const referenceLinesSchema = z
  .array(
    z.object({
      value: z.number(),
      label: z.string().optional(),
      axis: z.enum(['left', 'right']).optional()
    })
  )
  .optional();
const markBandsSchema = z
  .array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() }))
  .optional();

// Shared "build a chart by running SQL server-side" shape — reused by
// render_chart_from_query and the chart embedded in an insight card.
const chartQueryFields = {
  sql: z.string().describe('Read-only SELECT returning an x column + numeric value column(s)'),
  xColumn: z.string().describe('Column for the x axis (timestamp, or a category for bar/scatter)'),
  series: z.array(
    z.object({
      column: z.string(),
      name: z.string().optional(),
      role: z.enum(['actual', 'expected', 'deviation']).optional(),
      kind: CHART_TYPE.optional().describe('Per-series form override (mixed charts)'),
      axis: z.enum(['left', 'right']).optional().describe('Dual-axis support')
    })
  ),
  unit: z.string().optional(),
  chartType: CHART_TYPE.optional().describe('line (default) / area / bar / scatter'),
  referenceLines: referenceLinesSchema,
  markBands: markBandsSchema,
  maxPoints: z.number().int().positive().max(2000).optional()
};
const chartQuerySchema = z.object(chartQueryFields);
type ChartQuery = z.infer<typeof chartQuerySchema>;

async function buildChartFromQuery(
  datasetId: string,
  input: ChartQuery & { title: string }
): Promise<ChartSpec> {
  const duck = await getDuck(datasetId);
  const res = await duck.query(input.sql, 5000);
  let rows = res.rows;
  const maxPoints = input.maxPoints ?? 500;
  if (rows.length > maxPoints) {
    const stride = Math.ceil(rows.length / maxPoints);
    rows = rows.filter((_, i) => i % stride === 0);
  }
  const x = rows.map(r => String(r[input.xColumn] ?? ''));
  const series = input.series.map(s => ({
    name: s.name ?? s.column,
    role: s.role,
    kind: s.kind,
    axis: s.axis,
    data: rows.map(r => {
      const v = r[s.column];
      return v === null || v === undefined ? null : Number(v);
    })
  }));
  return {
    title: input.title,
    x,
    series,
    unit: input.unit,
    chartType: input.chartType,
    referenceLines: input.referenceLines,
    markBands: input.markBands
  };
}

export function widgetTools(ctx: ToolContext) {
  const { datasetId } = ctx;
  const includePreviousKnowledge = ctx.includePreviousKnowledge !== false;
  const newId = () => ctx.nextWidgetId();

  return [
    tool(
      'render_topology',
      includePreviousKnowledge
        ? 'Render a topology graph in the workspace. Easiest path: pass `from_diagram` (a diagram id from get_topology) to seed all nodes/edges/positions, then use `highlight` and `statuses` to spotlight or flag nodes. For a simplified/custom view, pass your own `nodes` and `edges` instead. Operator annotations are merged in automatically.'
        : 'Render a topology graph in the workspace. Easiest path: pass `from_diagram` (a diagram id from get_topology) to seed all nodes/edges/positions, then use `highlight` and `statuses` to spotlight or flag nodes. For a simplified/custom view, pass your own `nodes` and `edges` instead.',
      {
        title: z.string(),
        from_diagram: z
          .string()
          .optional()
          .describe('Diagram id to seed nodes/edges/positions from'),
        nodes: z
          .array(topoNode)
          .optional()
          .describe('Explicit nodes (override/replace the seeded diagram nodes)'),
        edges: z.array(topoEdge).optional(),
        highlight: z.array(z.string()).optional().describe('Node ids to spotlight'),
        statuses: z
          .array(z.object({ id: z.string(), status: STATUS }))
          .optional()
          .describe('Per-node status flags applied by node id'),
        collapsedGroups: z.array(z.string()).optional(),
        replaceId: z.string().optional().describe(REPLACE_ID_DESC)
      },
      async input => {
        let nodes = input.nodes ?? [];
        let edges = input.edges ?? [];

        if (input.from_diagram !== undefined && input.nodes === undefined) {
          const diagram = getDiagram(datasetId, input.from_diagram);
          if (diagram) {
            nodes = diagram.nodes.map(n => ({
              id: n.id,
              label: n.label,
              sensorId: n.sensorId,
              energyType: n.energyType,
              role: n.role,
              branch: n.branch,
              unit: n.unit,
              position: n.position
            }));
            if (input.edges === undefined) edges = diagram.edges;
          }
        }

        if (input.statuses?.length) {
          const byId = new Map(input.statuses.map(s => [s.id, s.status]));
          nodes = nodes.map(n =>
            byId.has(n.id) ? { ...n, status: byId.get(n.id) as NodeStatus } : n
          );
        }

        if (includePreviousKnowledge) {
          const annById = annotationsBySensor(datasetId);
          nodes = nodes.map(n =>
            n.sensorId !== undefined && annById.has(n.sensorId)
              ? { ...n, annotation: annById.get(n.sensorId) }
              : n
          );
        }

        const spec: TopologySpec = {
          title: input.title,
          nodes,
          edges,
          highlight: input.highlight,
          collapsedGroups: input.collapsedGroups
        };
        const id = emitWidget(
          ctx,
          { id: newId(), type: 'topology', spec },
          input.replaceId
        );
        return {
          content: [
            { type: 'text', text: `Rendered topology "${input.title}" (${nodes.length} nodes) as widget ${id}.` }
          ]
        };
      }
    ),

    tool(
      'render_chart',
      'Render a time-series chart from data you already have. Build `x` (ISO timestamps) and one `series` per metric. Use role "expected"/"deviation" for those traces, markBands to shade a window. For a full raw series prefer render_chart_from_query.',
      {
        title: z.string(),
        x: z.array(z.string()),
        series: z.array(
          z.object({
            name: z.string(),
            data: z.array(z.number().nullable()),
            role: z.enum(['actual', 'expected', 'deviation']).optional(),
            kind: CHART_TYPE.optional(),
            axis: z.enum(['left', 'right']).optional()
          })
        ),
        unit: z.string().optional(),
        chartType: CHART_TYPE.optional(),
        referenceLines: referenceLinesSchema,
        markBands: markBandsSchema,
        replaceId: z.string().optional().describe(REPLACE_ID_DESC)
      },
      async input => {
        const spec: ChartSpec = {
          title: input.title,
          x: input.x,
          series: input.series,
          unit: input.unit,
          chartType: input.chartType,
          referenceLines: input.referenceLines,
          markBands: input.markBands
        };
        const id = emitWidget(
          ctx,
          { id: newId(), type: 'chart', spec },
          input.replaceId
        );
        return {
          content: [{ type: 'text', text: `Rendered chart "${input.title}" as widget ${id}.` }]
        };
      }
    ),

    tool(
      'render_chart_from_query',
      'Plot a time-series chart by running SQL SERVER-SIDE — the rows are NOT returned to you, so use THIS (not query_data + render_chart) to chart a full sensor series without pulling thousands of points into context. The query should return an x column (e.g. timestamp) plus one or more numeric value columns, ideally ORDER BY the x column. Data is downsampled to maxPoints for rendering.',
      {
        title: z.string(),
        ...chartQueryFields,
        replaceId: z.string().optional().describe(REPLACE_ID_DESC)
      },
      async input => {
        try {
          const spec = await buildChartFromQuery(datasetId, input);
          const id = emitWidget(
            ctx,
            { id: newId(), type: 'chart', spec },
            input.replaceId
          );
          return {
            content: [
              { type: 'text', text: `Rendered chart "${input.title}" (${spec.x.length} points) as widget ${id}.` }
            ]
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Chart query error: ${String(err)}` }],
            isError: true
          };
        }
      }
    ),

    tool(
      'render_state_summary',
      'Render a Current Operating Snapshot, not a raw KPI dump. Use it to answer: are we okay, what is driving the state, and what should the operator inspect next? Prefer a clear verdict plus 2-4 grouped sections with only the values needed to support that verdict. Include comparisons/notes when grounded in data. Legacy flat items are still accepted.',
      {
        title: z.string(),
        observedAt: z.string().optional().describe('Timestamp or range label for this snapshot'),
        verdict: z
          .object({
            label: z.string().describe('One-line operator verdict, e.g. "Balanced supply, north branch carrying the load"'),
            status: STATUS.optional(),
            detail: z.string().optional().describe('One short sentence explaining why the verdict follows from the values')
          })
          .optional(),
        sections: z
          .array(
            z.object({
              title: z.string(),
              interpretation: z.string().optional().describe('Short meaning of this group, not a restatement of the numbers'),
              items: z.array(stateSummaryItem).min(1).max(5)
            })
          )
          .optional()
          .describe('Grouped values such as Supply / Demand, Branch Load, Zone Demand, and Drivers'),
        items: z
          .array(stateSummaryItem)
          .optional()
          .describe('Fallback flat list for old KPI-style summaries; prefer sections for new snapshots'),
        replaceId: z.string().optional().describe(REPLACE_ID_DESC)
      },
      async input => {
        const spec: StateSummarySpec = {
          title: input.title,
          observedAt: input.observedAt,
          verdict: input.verdict,
          sections: input.sections,
          items: input.items ?? []
        };
        const id = emitWidget(
          ctx,
          { id: newId(), type: 'state_summary', spec },
          input.replaceId
        );
        return {
          content: [{ type: 'text', text: `Rendered state summary "${input.title}" as widget ${id}.` }]
        };
      }
    ),

    tool(
      'render_data_quality',
      'Render a data-quality panel listing issues (gaps, stale sensors, inconsistencies) found via scan_data_quality, so the operator can see whether a signal is trustworthy.',
      {
        title: z.string(),
        issues: z.array(
          z.object({
            sensor: z.string(),
            type: z.enum(['gap', 'stale', 'unit_mismatch', 'inconsistent']),
            severity: z.enum(['low', 'med', 'high']),
            detail: z.string()
          })
        ),
        replaceId: z.string().optional().describe(REPLACE_ID_DESC)
      },
      async input => {
        const spec: DataQualitySpec = { title: input.title, issues: input.issues };
        const id = emitWidget(
          ctx,
          { id: newId(), type: 'data_quality', spec },
          input.replaceId
        );
        return {
          content: [{ type: 'text', text: `Rendered data-quality panel "${input.title}" as widget ${id}.` }]
        };
      }
    ),

    tool(
      'render_insight_card',
      'Render the key operational insight as a reviewable card: a concise summary, evidence, and recommended actions. This is the payoff of an analysis. Set severity info/watch/act. Set relatedNodeIds to the topology node ids this insight concerns (links the card to the diagram and prior-decision recall). Embed the supporting chart via `chart` (a SQL query, built server-side) instead of a standalone chart. Set impact only when you can quantify the at-stake value from data.',
      {
        title: z.string(),
        severity: z.enum(['info', 'watch', 'act']),
        summary: z.string(),
        evidence: z.array(z.string()).optional(),
        recommendations: z.array(z.string()).optional(),
        relatedNodeIds: z
          .array(z.string())
          .optional()
          .describe('Topology node ids this insight is about'),
        impact: z
          .object({
            value: z.number(),
            unit: z.string().optional(),
            confidence: z.enum(['low', 'med', 'high']).optional()
          })
          .optional()
          .describe('Grounded impact estimate only — omit if not quantifiable'),
        chart: chartQuerySchema
          .optional()
          .describe('Supporting chart, built server-side from SQL and embedded in the card'),
        replaceId: z.string().optional().describe(REPLACE_ID_DESC)
      },
      async input => {
        let chart: ChartSpec | undefined;
        if (input.chart) {
          try {
            chart = await buildChartFromQuery(datasetId, {
              ...input.chart,
              title: input.title
            });
          } catch {
            chart = undefined; // a bad chart query shouldn't drop the insight
          }
        }
        const spec: InsightCardSpec = {
          title: input.title,
          severity: input.severity,
          summary: input.summary,
          evidence: input.evidence,
          recommendations: input.recommendations,
          relatedNodeIds: input.relatedNodeIds,
          impact: input.impact,
          chart
        };
        const id = emitWidget(
          ctx,
          { id: newId(), type: 'insight_card', spec },
          input.replaceId
        );
        return {
          content: [{ type: 'text', text: `Rendered insight card "${input.title}" as widget ${id}.` }]
        };
      }
    ),

    tool(
      'remove_widget',
      'Remove a widget from the workspace by its id (from a previous render result). Pass id "all" to clear the entire workspace.',
      { id: z.string().describe('Widget id to remove, or "all" to clear everything') },
      async ({ id }) => {
        ctx.broadcast({ kind: 'widget_remove', id });
        return {
          content: [
            { type: 'text', text: id === 'all' ? 'Cleared the workspace.' : `Removed widget ${id}.` }
          ]
        };
      }
    )
  ];
}
