// Topology diagrams per dataset (diagrams/*.json). Loaded lazily and cached by
// dataset id. Dataset-agnostic: whatever diagrams exist are loaded.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { datasetDir } from './datasets.js';

export interface TopoNode {
  id: string;
  label: string;
  sensorId?: number;
  unit?: string;
  energyType?: string | null;
  role?: string;
  branch?: string;
  position?: { x: number; y: number };
}
export interface TopoEdge {
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
}
export interface Diagram {
  id: string;
  name: string;
  nodes: TopoNode[];
  edges: TopoEdge[];
}

const cache = new Map<string, Map<string, Diagram>>();

function load(datasetId: string): Map<string, Diagram> {
  let diagrams = cache.get(datasetId);
  if (diagrams) return diagrams;
  diagrams = new Map<string, Diagram>();
  cache.set(datasetId, diagrams);

  const root = datasetDir(datasetId);
  if (!root) return diagrams;
  const dir = path.join(root, 'diagrams');
  if (!existsSync(dir)) return diagrams;

  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      const raw = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      const nodes: TopoNode[] = (raw.nodes ?? []).map(
        (n: Record<string, unknown>) => {
          const d = (n.data ?? {}) as Record<string, unknown>;
          const rawSensorId = d.sensor_id ?? d.sensorId;
          const rawMeterId = d.meterId;
          const sensorId =
            typeof rawSensorId === 'number'
              ? rawSensorId
              : typeof rawSensorId === 'string'
                ? Number.parseInt(rawSensorId.replace(/^sensor_/, ''), 10)
                : typeof rawMeterId === 'string'
                  ? Number.parseInt(rawMeterId.replace(/^sensor_/, ''), 10)
                  : undefined;
          const rawEnergyType = d.energy_type ?? d.energyType;
          return {
            id: String(n.id),
            label: String(d.label ?? n.id),
            sensorId: Number.isFinite(sensorId) ? sensorId : undefined,
            unit: d.unit as string | undefined,
            energyType:
              typeof rawEnergyType === 'string' || rawEnergyType === null
                ? rawEnergyType
                : undefined,
            role: d.role as string | undefined,
            branch: d.branch as string | undefined,
            position: n.position as { x: number; y: number } | undefined
          };
        }
      );
      const edges: TopoEdge[] = (raw.edges ?? []).map(
        (e: Record<string, unknown>) => {
          const d = (e.data ?? {}) as Record<string, unknown>;
          return {
            source: String(e.source),
            target: String(e.target),
            label: (d.label as string) ?? undefined,
            animated: typeof e.animated === 'boolean' ? e.animated : undefined
          };
        }
      );
      const id = String(raw.id ?? path.basename(file, '.json'));
      diagrams.set(id, { id, name: String(raw.name ?? id), nodes, edges });
    } catch {
      // skip unparseable diagram files
    }
  }
  return diagrams;
}

export function listDiagrams(
  datasetId: string
): { id: string; name: string; nodes: number }[] {
  return [...load(datasetId).values()].map(d => ({
    id: d.id,
    name: d.name,
    nodes: d.nodes.length
  }));
}

export function getDiagram(datasetId: string, id?: string): Diagram | undefined {
  const diagrams = load(datasetId);
  if (id) return diagrams.get(id);
  return diagrams.values().next().value; // default to the first
}

export function neighbors(
  datasetId: string,
  diagramId: string | undefined,
  nodeId: string,
  depth = 1,
  direction: 'up' | 'down' | 'both' = 'both'
): { nodes: TopoNode[]; edges: TopoEdge[] } {
  const diagram = getDiagram(datasetId, diagramId);
  if (!diagram) return { nodes: [], edges: [] };

  const byId = new Map(diagram.nodes.map(n => [n.id, n]));
  const keptNodes = new Set<string>([nodeId]);
  const keptEdges: TopoEdge[] = [];
  let frontier = new Set<string>([nodeId]);

  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const e of diagram.edges) {
      const goDown =
        (direction === 'down' || direction === 'both') && frontier.has(e.source);
      const goUp =
        (direction === 'up' || direction === 'both') && frontier.has(e.target);
      if (goDown || goUp) {
        keptEdges.push(e);
        for (const id of [e.source, e.target]) {
          if (!keptNodes.has(id)) {
            keptNodes.add(id);
            next.add(id);
          }
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  return {
    nodes: [...keptNodes].map(id => byId.get(id)).filter(Boolean) as TopoNode[],
    edges: keptEdges
  };
}
