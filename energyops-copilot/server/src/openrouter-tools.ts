import { describeDataset } from './db/describe.js';
import { getDuck } from './db/duck.js';
import { annotationsBySensor, getAnnotations, setAnnotation, type AnnotationKind } from './db/memory.js';
import { scanAnomalies, scanDataQuality } from './db/scan.js';
import { getDiagram, listDiagrams, neighbors, type TopoNode } from './db/topology.js';
import { enrichNodesWithSparklines } from './db/topology-sparklines.js';
import { emitWidget, type ToolContext } from './tools/context.js';
import type {
  ChartSpec,
  DataQualitySpec,
  InsightCardSpec,
  NodeStatus,
  StateSummarySpec,
  TopologySpec
} from './types.js';

type JsonSchema = Record<string, unknown>;

export interface OpenRouterTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute(input: Record<string, unknown>): Promise<string>;
}

const objectSchema = (properties: Record<string, JsonSchema>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
});

const json = (obj: unknown) => JSON.stringify(obj, null, 2);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const strArray = (v: unknown) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : undefined);
const numArray = (v: unknown) => (Array.isArray(v) ? v.filter(x => typeof x === 'number') : undefined);
const DISPLAY_TIME_DESC =
  'Operator-facing date/time text must use German/European format: TT.MM.JJJJ, 24-hour time, Europe/Berlin zone names (MEZ/MESZ). Keep chart x values machine-readable ISO timestamps.';
const CUMULATIVE_CHART_DESC =
  'For cumulative meter sensors, do not chart raw counter levels. Compute period deltas in SQL with lag(value) partitioned by sensor_id; if expected_value exists, compute expected deltas and deviation from expected deltas.';

function enrichNodes(datasetId: string, nodes: TopoNode[], includePreviousKnowledge = true) {
  if (!includePreviousKnowledge) return nodes;
  const ann = annotationsBySensor(datasetId);
  return nodes.map(n => ({
    ...n,
    annotation: n.sensorId !== undefined ? ann.get(n.sensorId) : undefined
  }));
}

async function buildChartFromQuery(
  datasetId: string,
  input: Record<string, unknown> & { title: string }
): Promise<ChartSpec> {
  const duck = await getDuck(datasetId);
  const res = await duck.query(str(input.sql), 5000);
  let rows = res.rows;
  const maxPoints = Math.min(num(input.maxPoints) ?? 500, 2000);
  if (rows.length > maxPoints) {
    const stride = Math.ceil(rows.length / maxPoints);
    rows = rows.filter((_, i) => i % stride === 0);
  }
  const xColumn = str(input.xColumn);
  const seriesInput = Array.isArray(input.series) ? input.series : [];
  return {
    title: input.title,
    x: rows.map(r => String(r[xColumn] ?? '')),
    series: seriesInput
      .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
      .map(s => {
        const column = str(s.column);
        return {
          name: str(s.name, column),
          role: s.role as ChartSpec['series'][number]['role'],
          kind: s.kind as ChartSpec['series'][number]['kind'],
          axis: s.axis as ChartSpec['series'][number]['axis'],
          data: rows.map(r => {
            const v = r[column];
            return v === null || v === undefined ? null : Number(v);
          })
        };
      }),
    unit: str(input.unit) || undefined,
    chartType: input.chartType as ChartSpec['chartType'],
    referenceLines: Array.isArray(input.referenceLines)
      ? (input.referenceLines as ChartSpec['referenceLines'])
      : undefined,
    markBands: Array.isArray(input.markBands) ? (input.markBands as ChartSpec['markBands']) : undefined
  };
}

const textProp = { type: 'string' };
const numberProp = { type: 'number' };
const arrayProp = { type: 'array', items: {} };
const stateItemSchema = objectSchema({
  label: textProp,
  value: { anyOf: [textProp, numberProp] },
  unit: textProp,
  status: textProp,
  delta: numberProp,
  comparison: textProp,
  note: textProp
});
const stateSectionSchema = objectSchema({
  title: textProp,
  interpretation: textProp,
  items: { type: 'array', items: stateItemSchema }
});

export function makeOpenRouterTools(ctx: ToolContext): OpenRouterTool[] {
  const { datasetId, sessionId } = ctx;
  const includePreviousKnowledge = ctx.includePreviousKnowledge !== false;
  const newId = () => ctx.nextWidgetId();

  const tools: OpenRouterTool[] = [
    {
      name: 'describe_dataset',
      description: 'Inspect available tables, columns, row counts, time ranges, and topology diagrams. Call this first.',
      parameters: objectSchema({}),
      execute: async () => json(await describeDataset(datasetId))
    },
    {
      name: 'query_data',
      description: 'Run one read-only DuckDB SELECT/WITH query for inspection or aggregation. Results are row- and size-capped.',
      parameters: objectSchema({ sql: textProp, maxRows: numberProp }, ['sql']),
      execute: async input => {
        try {
          const duck = await getDuck(datasetId);
          const res = await duck.query(str(input.sql), Math.min(num(input.maxRows) ?? 200, 1000));
          let rows = res.rows;
          let truncated = res.truncated;
          let out = JSON.stringify({ columns: res.columns, rowCount: rows.length, truncated, rows });
          if (out.length > 40000) {
            rows = rows.slice(0, Math.max(1, Math.floor((rows.length * 40000) / out.length)));
            truncated = true;
            out = JSON.stringify({ columns: res.columns, rowCount: rows.length, truncated, rows });
          }
          return out;
        } catch (err) {
          throw new Error(`Query error: ${String(err)}`);
        }
      }
    },
    {
      name: 'get_topology',
      description: includePreviousKnowledge
        ? 'Get a topology diagram with nodes and edges. Omit diagram_id for the default. Operator annotations are merged onto nodes.'
        : 'Get a topology diagram with nodes and edges. Omit diagram_id for the default.',
      parameters: objectSchema({ diagram_id: textProp }),
      execute: async input => {
        const diagram = getDiagram(datasetId, str(input.diagram_id) || undefined);
        if (!diagram) return json({ error: 'No diagram found', available: listDiagrams(datasetId) });
        return json({
          id: diagram.id,
          name: diagram.name,
          nodes: enrichNodes(datasetId, diagram.nodes, includePreviousKnowledge),
          edges: diagram.edges,
          available: listDiagrams(datasetId)
        });
      }
    },
    {
      name: 'get_neighbors',
      description: 'Trace upstream/downstream topology around a node.',
      parameters: objectSchema(
        { node_id: textProp, diagram_id: textProp, depth: numberProp, direction: textProp },
        ['node_id']
      ),
      execute: async input => {
        const direction = ['up', 'down', 'both'].includes(str(input.direction))
          ? (str(input.direction) as 'up' | 'down' | 'both')
          : 'both';
        const sub = neighbors(datasetId, str(input.diagram_id) || undefined, str(input.node_id), num(input.depth) ?? 1, direction);
        return json({
          node_id: str(input.node_id),
          nodes: enrichNodes(datasetId, sub.nodes, includePreviousKnowledge),
          edges: sub.edges
        });
      }
    },
    {
      name: 'scan_anomalies',
      description: 'Rank unusual sensor behavior over a time range. For cumulative sensors, scoring uses period deltas rather than raw counter levels; with expected_value it compares actual delta vs expected delta.',
      parameters: objectSchema({ from: textProp, to: textProp, sensorIds: arrayProp, method: textProp, limit: numberProp }),
      execute: async input =>
        json(
          await scanAnomalies(datasetId, {
            from: str(input.from) || undefined,
            to: str(input.to) || undefined,
            sensorIds: numArray(input.sensorIds),
            method: ['auto', 'expected', 'baseline'].includes(str(input.method))
              ? (str(input.method) as 'auto' | 'expected' | 'baseline')
              : undefined,
            limit: num(input.limit)
          })
        )
    },
    {
      name: 'scan_data_quality',
      description: 'Find data-quality problems: stale sensors and gaps.',
      parameters: objectSchema({ from: textProp, to: textProp, sensorIds: arrayProp }),
      execute: async input =>
        json(
          await scanDataQuality(datasetId, {
            from: str(input.from) || undefined,
            to: str(input.to) || undefined,
            sensorIds: numArray(input.sensorIds)
          })
        )
    },
    {
      name: 'render_topology',
      description: includePreviousKnowledge
        ? 'Render a topology graph in the workspace. Use from_diagram plus highlight/statuses, or provide nodes and edges. Operator annotations are merged in automatically.'
        : 'Render a topology graph in the workspace. Use from_diagram plus highlight/statuses, or provide nodes and edges.',
      parameters: objectSchema({ title: textProp, from_diagram: textProp, nodes: arrayProp, edges: arrayProp, highlight: arrayProp, statuses: arrayProp, collapsedGroups: arrayProp, replaceId: textProp }, ['title']),
      execute: async input => {
        let nodes = Array.isArray(input.nodes) ? (input.nodes as TopologySpec['nodes']) : [];
        let edges = Array.isArray(input.edges) ? (input.edges as TopologySpec['edges']) : [];
        const fromDiagram = str(input.from_diagram);
        if (fromDiagram && !Array.isArray(input.nodes)) {
          const diagram = getDiagram(datasetId, fromDiagram);
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
            if (!Array.isArray(input.edges)) edges = diagram.edges;
          }
        }
        if (Array.isArray(input.statuses)) {
          const byId = new Map(
            input.statuses
              .filter((s): s is { id: string; status: NodeStatus } => Boolean(s && typeof s === 'object'))
              .map(s => [String(s.id), s.status])
          );
          nodes = nodes.map(n => (byId.has(n.id) ? { ...n, status: byId.get(n.id) } : n));
        }
        if (includePreviousKnowledge) {
          const ann = annotationsBySensor(datasetId);
          nodes = nodes.map(n => (n.sensorId !== undefined && ann.has(n.sensorId) ? { ...n, annotation: ann.get(n.sensorId) } : n));
        }
        nodes = await enrichNodesWithSparklines(datasetId, nodes);
        const spec: TopologySpec = {
          title: str(input.title, 'Topology'),
          nodes,
          edges,
          highlight: strArray(input.highlight),
          collapsedGroups: strArray(input.collapsedGroups)
        };
        const id = emitWidget(ctx, { id: newId(), type: 'topology', spec }, str(input.replaceId) || undefined);
        return `Rendered topology "${spec.title}" (${nodes.length} nodes) as widget ${id}.`;
      }
    },
    {
      name: 'render_chart_from_query',
      description: `Render a chart by running SQL server-side. The query returns x plus numeric series columns. ${CUMULATIVE_CHART_DESC} ${DISPLAY_TIME_DESC}`,
      parameters: objectSchema({ title: textProp, sql: textProp, xColumn: textProp, series: arrayProp, unit: textProp, chartType: textProp, maxPoints: numberProp, replaceId: textProp }, ['title', 'sql', 'xColumn', 'series']),
      execute: async input => {
        const spec = await buildChartFromQuery(datasetId, { ...input, title: str(input.title, 'Chart') });
        const id = emitWidget(ctx, { id: newId(), type: 'chart', spec }, str(input.replaceId) || undefined);
        return `Rendered chart "${spec.title}" (${spec.x.length} points) as widget ${id}.`;
      }
    },
    {
      name: 'render_state_summary',
      description: `Render a Current Operating Snapshot, not a raw KPI dump. Use a clear verdict plus 2-4 grouped sections with only the values needed to explain whether the system is okay, what is driving the state, and what the operator should inspect next. Include comparisons/notes only when grounded in data. Legacy flat items are still accepted. ${DISPLAY_TIME_DESC}`,
      parameters: objectSchema(
        {
          title: textProp,
          observedAt: textProp,
          verdict: objectSchema({ label: textProp, status: textProp, detail: textProp }),
          sections: { type: 'array', items: stateSectionSchema },
          items: { type: 'array', items: stateItemSchema },
          replaceId: textProp
        },
        ['title']
      ),
      execute: async input => {
        const spec: StateSummarySpec = {
          title: str(input.title, 'Current Operating Snapshot'),
          observedAt: str(input.observedAt) || undefined,
          verdict:
            input.verdict && typeof input.verdict === 'object'
              ? (input.verdict as StateSummarySpec['verdict'])
              : undefined,
          sections: Array.isArray(input.sections)
            ? (input.sections as StateSummarySpec['sections'])
            : undefined,
          items: Array.isArray(input.items) ? (input.items as StateSummarySpec['items']) : []
        };
        const id = emitWidget(ctx, { id: newId(), type: 'state_summary', spec }, str(input.replaceId) || undefined);
        return `Rendered state summary "${spec.title}" as widget ${id}.`;
      }
    },
    {
      name: 'render_data_quality',
      description: 'Render a data-quality issue panel. Preserve every referenced meter as targets[]. Use sensor_id/sensorId for single-sensor scan results, and targets/sensorIds/sensor_ids for multi-meter findings. Pass from/to when the issue has a concrete affected time range.',
      parameters: objectSchema({ title: textProp, issues: arrayProp, replaceId: textProp }, ['title', 'issues']),
      execute: async input => {
        const rawIssues = Array.isArray(input.issues) ? input.issues : [];
        const issues: DataQualitySpec['issues'] = rawIssues
          .filter((issue): issue is Record<string, unknown> => Boolean(issue && typeof issue === 'object'))
          .map(issue => {
            const from = str(issue.from) || undefined;
            const to = str(issue.to) || undefined;
            const primarySensorId = num(issue.sensorId) ?? num(issue.sensor_id);
            const targetMap = new Map<number, NonNullable<DataQualitySpec['issues'][number]['targets']>[number]>();
            const addTarget = (sensorId: number | undefined, target?: Record<string, unknown>) => {
              if (sensorId === undefined || !Number.isFinite(sensorId)) return;
              targetMap.set(sensorId, {
                sensorId,
                nodeId: str(target?.nodeId) || str(target?.node_id) || undefined,
                label: str(target?.label) || str(target?.sensor) || str(target?.name) || `Sensor ${sensorId}`,
                from: str(target?.from) || from,
                to: str(target?.to) || to
              });
            };
            for (const sensorId of numArray(issue.sensorIds) ?? numArray(issue.sensor_ids) ?? []) addTarget(sensorId);
            addTarget(primarySensorId, issue);
            if (Array.isArray(issue.targets)) {
              for (const target of issue.targets) {
                if (target && typeof target === 'object') {
                  const t = target as Record<string, unknown>;
                  addTarget(num(t.sensorId) ?? num(t.sensor_id), t);
                }
              }
            }

            return {
              sensor: str(issue.sensor, issue.name ? String(issue.name) : 'Sensor'),
              sensorId: primarySensorId,
              targets: targetMap.size ? [...targetMap.values()] : undefined,
              type: ['gap', 'stale', 'unit_mismatch', 'inconsistent'].includes(str(issue.type))
                ? (str(issue.type) as DataQualitySpec['issues'][number]['type'])
                : 'inconsistent',
              severity: ['low', 'med', 'high'].includes(str(issue.severity))
                ? (str(issue.severity) as DataQualitySpec['issues'][number]['severity'])
                : 'med',
              detail: str(issue.detail),
              from,
              to
            };
          });
        const spec: DataQualitySpec = { title: str(input.title, 'Data quality'), issues };
        const id = emitWidget(ctx, { id: newId(), type: 'data_quality', spec }, str(input.replaceId) || undefined);
        return `Rendered data-quality panel "${spec.title}" as widget ${id}.`;
      }
    },
    {
      name: 'render_insight_card',
      description: `Render the key operational insight as a reviewable card with evidence, recommendations, and optional chart. Set relatedNodeIds so the UI can handle prior-decision recall separately. ${CUMULATIVE_CHART_DESC} ${DISPLAY_TIME_DESC}`,
      parameters: objectSchema({ title: textProp, severity: textProp, summary: textProp, evidence: arrayProp, recommendations: arrayProp, relatedNodeIds: arrayProp, impact: {}, chart: {}, replaceId: textProp }, ['title', 'severity', 'summary']),
      execute: async input => {
        let chart: ChartSpec | undefined;
        if (input.chart && typeof input.chart === 'object') {
          try {
            chart = await buildChartFromQuery(datasetId, { ...(input.chart as Record<string, unknown>), title: str(input.title, 'Insight') });
          } catch {
            chart = undefined;
          }
        }
        const severity = ['info', 'watch', 'act'].includes(str(input.severity))
          ? (str(input.severity) as InsightCardSpec['severity'])
          : 'info';
        const spec: InsightCardSpec = {
          title: str(input.title, 'Insight'),
          severity,
          summary: str(input.summary),
          evidence: strArray(input.evidence),
          recommendations: strArray(input.recommendations),
          relatedNodeIds: strArray(input.relatedNodeIds),
          impact: input.impact && typeof input.impact === 'object' ? (input.impact as InsightCardSpec['impact']) : undefined,
          chart
        };
        const id = emitWidget(ctx, { id: newId(), type: 'insight_card', spec }, str(input.replaceId) || undefined);
        return `Rendered insight card "${spec.title}" as widget ${id}.`;
      }
    },
    {
      name: 'remove_widget',
      description: 'Remove a widget by id, or pass id "all" to clear the workspace.',
      parameters: objectSchema({ id: textProp }, ['id']),
      execute: async input => {
        const id = str(input.id);
        ctx.broadcast({ kind: 'widget_remove', id });
        return id === 'all' ? 'Cleared the workspace.' : `Removed widget ${id}.`;
      }
    },
    {
      name: 'get_annotations',
      description: 'Read operator annotations for this dataset.',
      parameters: objectSchema({ kind: textProp, id: textProp }),
      execute: async input =>
        json(
          getAnnotations({
            datasetId,
            kind: str(input.kind) as AnnotationKind | undefined,
            id: str(input.id) || undefined
          })
        )
    },
    {
      name: 'set_annotation',
      description: 'Pin or update a durable operator annotation on an entity.',
      parameters: objectSchema({ kind: textProp, id: textProp, text: textProp }, ['kind', 'id', 'text']),
      execute: async input =>
        json(
          setAnnotation(
            datasetId,
            str(input.kind) as AnnotationKind,
            str(input.id),
            str(input.text),
            sessionId
          )
        )
    }
  ];
  return includePreviousKnowledge
    ? tools
    : tools.filter(tool => tool.name !== 'get_annotations');
}
