// Data-exploration tools, bound to a session's dataset. Schema-driven and
// scenario-blind: the agent discovers the loaded dataset and queries it freely.

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { describeDataset } from '../db/describe.js';
import { getDuck } from '../db/duck.js';
import {
  getDiagram,
  listDiagrams,
  neighbors,
  type TopoNode
} from '../db/topology.js';
import { annotationsBySensor } from '../db/memory.js';
import type { ToolContext } from './context.js';

const jsonText = (obj: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }]
});

export function dataTools(ctx: ToolContext) {
  const { datasetId } = ctx;
  const includePreviousKnowledge = ctx.includePreviousKnowledge !== false;

  function enrichNodes(nodes: TopoNode[]) {
    if (!includePreviousKnowledge) return nodes;
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
      async () => jsonText(await describeDataset(datasetId))
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
      includePreviousKnowledge
        ? 'Get a topology diagram that ships with the dataset (nodes with id/label/sensorId/role/branch/position, plus edges). Omit diagram_id for the default. Operator annotations are merged onto nodes. Pass the result to render_topology to visualise it.'
        : 'Get a topology diagram that ships with the dataset (nodes with id/label/sensorId/role/branch/position, plus edges). Omit diagram_id for the default. Pass the result to render_topology to visualise it.',
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
