// Dataset registry. Auto-discovers datasets from a folder: each immediate
// subdirectory containing sensors.csv is a dataset. Drop a new folder in and it
// shows up — no config. manifest.json (if present) provides nicer metadata.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const DATASETS_DIR = process.env.DATASETS_DIR
  ? path.resolve(SERVER_ROOT, process.env.DATASETS_DIR)
  : path.resolve(SERVER_ROOT, '../datasets'); // energyops-copilot/datasets

export interface DatasetInfo {
  id: string; // folder name (stable key)
  name: string;
  path: string;
  scenario?: string;
  narrative?: string;
  sensors?: number;
  diagrams?: number;
  startDate?: string;
  days?: number;
}

function readManifest(dir: string): Record<string, unknown> | null {
  const p = path.join(dir, 'manifest.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function isDataset(dir: string): boolean {
  return existsSync(path.join(dir, 'sensors.csv'));
}

function describe(id: string, dir: string): DatasetInfo {
  const m = readManifest(dir) ?? {};
  const counts = (m.counts ?? {}) as Record<string, number>;
  const prettyId = id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  return {
    id,
    name: (m.scenario as string) ? prettyId : prettyId,
    path: dir,
    scenario: m.scenario as string | undefined,
    narrative: m.narrative as string | undefined,
    sensors: counts.sensors,
    diagrams: counts.diagrams,
    startDate: m.start_date as string | undefined,
    days: m.days as number | undefined
  };
}

export function listDatasets(): DatasetInfo[] {
  if (!existsSync(DATASETS_DIR)) return [];
  return readdirSync(DATASETS_DIR)
    .map(entry => path.join(DATASETS_DIR, entry))
    .filter(p => {
      try {
        return statSync(p).isDirectory() && isDataset(p);
      } catch {
        return false;
      }
    })
    .map(dir => describe(path.basename(dir), dir))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getDataset(id: string): DatasetInfo | undefined {
  return listDatasets().find(d => d.id === id);
}

export function datasetDir(id: string): string | undefined {
  return getDataset(id)?.path;
}
