// Annotation tools — the descriptive knowledge layer. (Currently global across
// datasets; dataset-scoping is a follow-up.)

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import {
  getAnnotations,
  setAnnotation,
  type AnnotationKind
} from '../db/memory.js';
import type { ToolContext } from './context.js';

const KIND = z.enum([
  'sensor',
  'node',
  'edge',
  'subsystem',
  'dataset',
  'widget'
]);
const jsonText = (obj: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }]
});

export function annotationTools(ctx: ToolContext) {
  const { datasetId, sessionId } = ctx;
  return [
    tool(
      'get_annotations',
      'Read operator-supplied descriptions pinned to entities (sensors, nodes, subsystems, or the dataset) in this dataset. Call this to ground your explanation in what the operator already knows. Omit filters to get all.',
      {
        kind: KIND.optional(),
        id: z.string().optional().describe('Target id, e.g. a sensor_id or node id')
      },
      async ({ kind, id }) =>
        jsonText(
          getAnnotations({ datasetId, kind: kind as AnnotationKind | undefined, id })
        )
    ),

    tool(
      'set_annotation',
      'Pin or update a durable description on an entity when the operator tells you a fact about it (what it is, a known defect, a special operating mode). This is documentation, not an event note. target.kind is sensor/node/edge/subsystem/dataset; target.id is the entity id (e.g. sensor_id).',
      { kind: KIND, id: z.string(), text: z.string() },
      async ({ kind, id, text }) =>
        jsonText(setAnnotation(datasetId, kind as AnnotationKind, id, text, sessionId))
    )
  ];
}
