// Dataset registry. Auto-discovers datasets from a folder: each immediate
// subdirectory containing sensors.csv is a dataset. Drop a new folder in and it
// shows up — no config. manifest.json (if present) provides nicer metadata.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

function resolveConfiguredPath(value: string): string {
  if (path.isAbsolute(value)) return path.resolve(value);

  const repoRelative = path.resolve(REPO_ROOT, value);
  if (existsSync(repoRelative)) return repoRelative;

  return path.resolve(SERVER_ROOT, value);
}

const configuredDatasetsDir = process.env.DATASETS_DIR ?? process.env.DATA_DIR;

export const DATASETS_DIR = configuredDatasetsDir
  ? resolveConfiguredPath(configuredDatasetsDir)
  : path.join(REPO_ROOT, 'datasets');

export interface DatasetInfo {
  id: string; // folder name (stable key)
  name: string;
  path: string;
  scenario?: string;
  narrative?: string;
  sensors?: number;
  diagrams?: number;
  startDate?: string;
  endDate?: string;
  days?: number;
  defaultStartDate?: string;
  defaultEndDate?: string;
}

const DEFAULT_ANALYSIS_RANGE_DAYS = 14;

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

export function datasetRoots(): string[] {
  const roots = [
    DATASETS_DIR,
    path.join(REPO_ROOT, 'datasets'),
    path.join(SERVER_ROOT, 'datasets'),
    path.join(SERVER_ROOT, 'data'),
    path.join(process.cwd(), 'datasets'),
    path.join(process.cwd(), 'server', 'datasets')
  ];
  return [...new Set(roots.map(root => path.resolve(root)))];
}

export function datasetRootStatus(): { path: string; exists: boolean; datasets: number }[] {
  return datasetRoots().map(root => {
    let datasets = 0;
    if (existsSync(root)) {
      const candidates = isDataset(root)
        ? [root]
        : readdirSync(root).map(entry => path.join(root, entry));
      datasets = candidates.filter(candidate => {
        try {
          return statSync(candidate).isDirectory() && isDataset(candidate);
        } catch {
          return false;
        }
      }).length;
    }

    return { path: root, exists: existsSync(root), datasets };
  });
}

function dateOnly(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1];
}

function inclusiveDays(startDate?: string, endDate?: string): number | undefined {
  if (!startDate || !endDate) return undefined;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function addDays(date: string, days: number): string | undefined {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time)) return undefined;
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

function inclusiveEndDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/);
  if (!match) return undefined;
  const [, date, time] = match;
  if (time && /^00:00(?::00)?$/.test(time)) return addDays(date, -1);
  return date;
}

function describe(id: string, dir: string): DatasetInfo {
  const m = readManifest(dir) ?? {};
  const counts = (m.counts ?? {}) as Record<string, number>;
  const timeWindow = (m.time_window ?? {}) as Record<string, unknown>;
  const startDate = dateOnly(m.start_date) ?? dateOnly(timeWindow.start);
  const endDate =
    startDate && typeof m.days === 'number'
      ? addDays(startDate, m.days - 1)
      : inclusiveEndDate(timeWindow.end);
  const days =
    typeof m.days === 'number'
      ? m.days
      : inclusiveDays(startDate, endDate);
  const defaultEndDate = endDate;
  const defaultStartDate =
    startDate && endDate
      ? addDays(endDate, -Math.min(DEFAULT_ANALYSIS_RANGE_DAYS, days ?? 1) + 1)
      : startDate;
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
    startDate,
    endDate,
    days,
    defaultStartDate,
    defaultEndDate
  };
}

export function listDatasets(): DatasetInfo[] {
  const datasets = new Map<string, DatasetInfo>();

  for (const root of datasetRoots()) {
    if (!existsSync(root)) continue;

    const candidates = isDataset(root)
      ? [root]
      : readdirSync(root).map(entry => path.join(root, entry));

    for (const candidate of candidates) {
      try {
        if (!statSync(candidate).isDirectory() || !isDataset(candidate)) continue;
      } catch {
        continue;
      }

      const id = path.basename(candidate);
      if (!datasets.has(id)) {
        datasets.set(id, describe(id, candidate));
      }
    }
  }

  return [...datasets.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function getDataset(id: string): DatasetInfo | undefined {
  return listDatasets().find(d => d.id === id);
}

export function datasetDir(id: string): string | undefined {
  return getDataset(id)?.path;
}
