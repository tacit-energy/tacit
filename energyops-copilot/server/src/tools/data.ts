// Data-exploration tools, bound to a session's dataset. Schema-driven and
// scenario-blind: the agent discovers the loaded dataset and queries it freely.

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getDuck } from '../db/duck.js';
import {
  getDiagram,
  listDiagrams,
  neighbors,
  type TopoNode
} from '../db/topology.js';
import { annotationsBySensor } from '../db/memory.js';
import type { ToolContext } from './context.js';

const qid = (s: string) => `"${s.replace(/"/g, '""')}"`;
const jsonText = (obj: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }]
});

export function dataTools(ctx: ToolContext) {
  const { datasetId } = ctx;

  async function describeDataset() {
    const duck = await getDuck(datasetId);
    const tables: Record<string, unknown>[] = [];

    for (const name of duck.tables()) {
      const desc = await duck.raw(`DESCRIBE ${qid(name)}`, 1000);
      const cols = desc.rows.map(r => ({
        name: String(r.column_name),
        type: String(r.column_type)
      }));
      const counts = cols
        .map(c => `count(${qid(c.name)}) AS ${qid(c.name)}`)
        .join(', ');
      const stat = await duck.raw(
        `SELECT count(*) AS __n, ${counts} FROM ${qid(name)}`,
        1
      );
      const row = stat.rows[0] ?? {};
      const n = Number(row.__n ?? 0);
      const columns = cols.map(c => ({
        name: c.name,
        type: c.type,
        populated: n
          ? `${Math.round((Number(row[c.name] ?? 0) / n) * 100)}%`
          : 'n/a'
      }));

      const timeCol = cols.find(c => /TIMESTAMP|DATE/i.test(c.type));
      let timeRange: { from: unknown; to: unknown } | undefined;
      if (timeCol) {
        const tr = await duck.raw(
          `SELECT min(${qid(timeCol.name)}) AS f, max(${qid(timeCol.name)}) AS t FROM ${qid(name)}`,
          1
        );
        timeRange = { from: tr.rows[0]?.f, to: tr.rows[0]?.t };
      }

      tables.push({ table: name, rows: n, columns, timeRange });
    }

    return {
      dataset: datasetId,
      tables,
      diagrams: listDiagrams(datasetId),
      note: 'Schema reflects the currently loaded dataset. Query any table with query_data. Do not assume a specific scenario; rank deviations / inspect ranges to find what is unusual.'
    };
  }

  function enrichNodes(nodes: TopoNode[]) {
    const ann = annotationsBySensor(datasetId);
    return nodes.map(n => ({
      ...n,
      annotation: n.sensorId !== undefined ? ann.get(n.sensorId) : undefined
    }));
  }

  return [
    tool(
      'describe_dataset',
      'Inspect the currently loaded dataset: tables, columns (with type and how populated each is), row counts, time ranges, and available topology diagrams. Call this first to learn what you can query — never assume a specific scenario or schema.',
      {},
      async () => jsonText(await describeDataset())
    ),

    tool(
      'query_data',
      'Run a read-only SQL query (DuckDB) for INSPECTION and AGGREGATION — e.g. rank sensors by deviation, compute stats, sample a few rows. Do NOT pull long raw series with this (it wastes context and gets truncated); to plot a full series use render_chart_from_query instead, which runs server-side. Results are row- and size-capped.',
      {
        sql: z.string().describe('A single read-only SELECT/WITH statement'),
        maxRows: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe('Row cap (default 200). Prefer aggregation over large row counts.')
      },
      async ({ sql, maxRows }) => {
        const duck = await getDuck(datasetId);
        try {
          const res = await duck.query(sql, maxRows ?? 200);
          const MAX_CHARS = 40000;
          let rows = res.rows;
          let truncated = res.truncated;
          let text = JSON.stringify({
            columns: res.columns,
            rowCount: rows.length,
            truncated,
            rows
          });
          if (text.length > MAX_CHARS) {
            const keep = Math.max(
              1,
              Math.floor((rows.length * MAX_CHARS) / text.length)
            );
            rows = rows.slice(0, keep);
            truncated = true;
            text = JSON.stringify({
              columns: res.columns,
              rowCount: rows.length,
              truncated,
              note: 'Result trimmed to fit context. Aggregate in SQL, or use render_chart_from_query to plot a full series without returning rows.',
              rows
            });
          }
          return { content: [{ type: 'text' as const, text }] };
        } catch (err) {
          return {
            content: [{ type: 'text' as const, text: `Query error: ${String(err)}` }],
            isError: true
          };
        }
      }
    ),

    tool(
      'get_topology',
      'Get a topology diagram that ships with the dataset (nodes with id/label/sensorId/role/branch/position, plus edges). Omit diagram_id for the default. Operator annotations are merged onto nodes. Pass the result to render_topology to visualise it.',
      { diagram_id: z.string().optional() },
      async ({ diagram_id }) => {
        const diagram = getDiagram(datasetId, diagram_id);
        if (!diagram) {
          return jsonText({
            error: 'No diagram found',
            available: listDiagrams(datasetId)
          });
        }
        return jsonText({
          id: diagram.id,
          name: diagram.name,
          nodes: enrichNodes(diagram.nodes),
          edges: diagram.edges,
          available: listDiagrams(datasetId)
        });
      }
    ),

    tool(
      'get_neighbors',
      'Trace the topology around a node: upstream sources, downstream consumers, or both, up to a depth. Use this to follow energy flow and find what is up/downstream of a sensor of interest.',
      {
        node_id: z.string(),
        diagram_id: z.string().optional(),
        depth: z.number().int().positive().max(6).optional(),
        direction: z.enum(['up', 'down', 'both']).optional()
      },
      async ({ node_id, diagram_id, depth, direction }) => {
        const sub = neighbors(
          datasetId,
          diagram_id,
          node_id,
          depth ?? 1,
          direction ?? 'both'
        );
        return jsonText({
          node_id,
          nodes: enrichNodes(sub.nodes),
          edges: sub.edges
        });
      }
    )
  ];
}
