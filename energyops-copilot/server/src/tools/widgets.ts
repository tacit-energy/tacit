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

const topoNode = z.object({
  id: z.string(),
  label: z.string(),
  sensorId: z.number().optional(),
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
  emphasis: z.boolean().optional()
});

const REPLACE_ID_DESC =
  'To UPDATE an existing widget in place (e.g. the user asks to change a chart/topology already shown), pass its id from a previous render result. Omit to create a new widget.';

export function widgetTools(ctx: ToolContext) {
  const { datasetId } = ctx;
  const newId = () => ctx.nextWidgetId();

  return [
    tool(
      'render_topology',
      'Render a topology graph in the workspace. Easiest path: pass `from_diagram` (a diagram id from get_topology) to seed all nodes/edges/positions, then use `highlight` and `statuses` to spotlight or flag nodes. For a simplified/custom view, pass your own `nodes` and `edges` instead. Operator annotations are merged in automatically.',
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

        const annById = annotationsBySensor(datasetId);
        nodes = nodes.map(n =>
          n.sensorId !== undefined && annById.has(n.sensorId)
            ? { ...n, annotation: annById.get(n.sensorId) }
            : n
        );

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
            role: z.enum(['actual', 'expected', 'deviation']).optional()
          })
        ),
        unit: z.string().optional(),
        markBands: z
          .array(
            z.object({ from: z.string(), to: z.string(), label: z.string().optional() })
          )
          .optional(),
        replaceId: z.string().optional().describe(REPLACE_ID_DESC)
      },
      async input => {
        const spec: ChartSpec = {
          title: input.title,
          x: input.x,
          series: input.series,
          unit: input.unit,
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
        sql: z.string().describe('Read-only SELECT returning an x column + numeric value column(s)'),
        xColumn: z.string().describe('Column for the x axis, e.g. "timestamp"'),
        series: z.array(
          z.object({
            column: z.string(),
            name: z.string().optional(),
            role: z.enum(['actual', 'expected', 'deviation']).optional()
          })
        ),
        unit: z.string().optional(),
        markBands: z
          .array(
            z.object({ from: z.string(), to: z.string(), label: z.string().optional() })
          )
          .optional(),
        maxPoints: z.number().int().positive().max(2000).optional(),
        replaceId: z.string().optional().describe(REPLACE_ID_DESC)
      },
      async input => {
        const duck = await getDuck(datasetId);
        try {
          const res = await duck.query(input.sql, 5000);
          let rows = res.rows;
          const maxPoints = input.maxPoints ?? 500;
          let note = '';
          if (rows.length > maxPoints) {
            const stride = Math.ceil(rows.length / maxPoints);
            rows = rows.filter((_, i) => i % stride === 0);
            note = ` (downsampled ${res.rows.length}→${rows.length})`;
          }
          const x = rows.map(r => String(r[input.xColumn] ?? ''));
          const series = input.series.map(s => ({
            name: s.name ?? s.column,
            role: s.role,
            data: rows.map(r => {
              const v = r[s.column];
              return v === null || v === undefined ? null : Number(v);
            })
          }));
          const spec: ChartSpec = {
            title: input.title,
            x,
            series,
            unit: input.unit,
            markBands: input.markBands
          };
          const id = emitWidget(
            ctx,
            { id: newId(), type: 'chart', spec },
            input.replaceId
          );
          return {
            content: [
              { type: 'text', text: `Rendered chart "${input.title}" (${x.length} points${note}) as widget ${id}.` }
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
      'Render a compact grid of key state values (KPIs) in the workspace — current operating values, setpoints, notable deviations. Set a status per item to colour it.',
      {
        title: z.string(),
        items: z.array(
          z.object({
            label: z.string(),
            value: z.union([z.string(), z.number()]),
            unit: z.string().optional(),
            status: STATUS.optional(),
            delta: z.number().optional()
          })
        ),
        replaceId: z.string().optional().describe(REPLACE_ID_DESC)
      },
      async input => {
        const spec: StateSummarySpec = { title: input.title, items: input.items };
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
      'Render the key operational insight as a reviewable card: a concise summary, supporting evidence, recommended checks/actions, and optionally a "have we seen this before?" question. This is the payoff of an analysis. Set severity: info / watch / act.',
      {
        title: z.string(),
        severity: z.enum(['info', 'watch', 'act']),
        summary: z.string(),
        evidence: z.array(z.string()).optional(),
        recommendations: z.array(z.string()).optional(),
        question: z.string().optional(),
        replaceId: z.string().optional().describe(REPLACE_ID_DESC)
      },
      async input => {
        const spec: InsightCardSpec = {
          title: input.title,
          severity: input.severity,
          summary: input.summary,
          evidence: input.evidence,
          recommendations: input.recommendations,
          question: input.question
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
