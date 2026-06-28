import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { datasetDir } from './datasets.js';
import { getDuck } from './duck.js';
import { listDiagrams } from './topology.js';

const qid = (s: string) => `"${s.replace(/"/g, '""')}"`;

export interface DatasetColumnSummary {
  name: string;
  type: string;
  populated: string;
}

export interface DatasetTableSummary {
  table: string;
  rows: number;
  columns: DatasetColumnSummary[];
  timeRange?: { from: unknown; to: unknown };
}

export interface DatasetSummary {
  dataset: string;
  tables: DatasetTableSummary[];
  diagrams: ReturnType<typeof listDiagrams>;
  note: string;
}

interface CacheEntry {
  fingerprint: string;
  summary: Promise<DatasetSummary>;
}

const cache = new Map<string, CacheEntry>();

function csvFingerprint(datasetId: string): string {
  const dir = datasetDir(datasetId);
  if (!dir) throw new Error(`Unknown dataset: ${datasetId}`);

  return readdirSync(dir)
    .filter(file => file.endsWith('.csv'))
    .sort()
    .map(file => {
      const st = statSync(path.join(dir, file));
      return `${file}:${st.size}:${st.mtimeMs}`;
    })
    .join('|');
}

async function computeDatasetSummary(datasetId: string): Promise<DatasetSummary> {
  const duck = await getDuck(datasetId);
  const tables: DatasetTableSummary[] = [];

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

export function describeDataset(datasetId: string): Promise<DatasetSummary> {
  const fingerprint = csvFingerprint(datasetId);
  const entry = cache.get(datasetId);
  if (entry?.fingerprint === fingerprint) return entry.summary;

  let summary: Promise<DatasetSummary>;
  summary = computeDatasetSummary(datasetId).catch(err => {
    if (cache.get(datasetId)?.summary === summary) cache.delete(datasetId);
    throw err;
  });
  cache.set(datasetId, { fingerprint, summary });
  return summary;
}

export function getCachedDatasetDescription(
  datasetId: string
): Promise<DatasetSummary> | undefined {
  const fingerprint = csvFingerprint(datasetId);
  const entry = cache.get(datasetId);
  return entry?.fingerprint === fingerprint ? entry.summary : undefined;
}
