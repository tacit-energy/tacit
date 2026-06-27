// Generic discovery tools, bound to a session's dataset. Encode robust default
// methods so detection works even with no expected_value column.

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { scanAnomalies, scanDataQuality } from '../db/scan.js';
import type { ToolContext } from './context.js';

const jsonText = (obj: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }]
});

export function scanTools(ctx: ToolContext) {
  const { datasetId } = ctx;
  return [
    tool(
      'scan_anomalies',
      'Rank where the dataset is behaving unusually, scenario-blind, across a time range. Method "auto" uses deviation-from-expected if the data has it, otherwise a per-sensor statistical baseline (z-score). Returns a ranked shortlist of (sensor, peak time, magnitude). Use this to find what to investigate, then drill in with query_data.',
      {
        from: z.string().optional().describe('ISO start (default: full range)'),
        to: z.string().optional().describe('ISO end'),
        sensorIds: z
          .array(z.number())
          .optional()
          .describe('Limit to these sensor ids (default: all)'),
        method: z.enum(['auto', 'expected', 'baseline']).optional(),
        limit: z.number().int().positive().max(50).optional()
      },
      async input => jsonText(await scanAnomalies(datasetId, input))
    ),

    tool(
      'scan_data_quality',
      'Find data-quality problems generically: flatlined/stale sensors and missing-data gaps over a time range. Use this to decide whether something is a real event or a data issue.',
      {
        from: z.string().optional(),
        to: z.string().optional(),
        sensorIds: z.array(z.number()).optional()
      },
      async input => jsonText(await scanDataQuality(datasetId, input))
    )
  ];
}
