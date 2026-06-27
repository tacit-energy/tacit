// DuckDB layer, per dataset. Each dataset gets its own in-memory instance with a
// view per CSV (dataset-agnostic: whatever files exist become tables). Instances
// are cached by dataset id. Agent-facing query() is read-only + row-capped.

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { datasetDir } from './datasets.js';

const toPosix = (p: string) => p.split(path.sep).join('/');
const viewName = (file: string) =>
  path.basename(file, '.csv').replace(/[^a-zA-Z0-9_]/g, '_');

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

export interface Duck {
  /** Agent-facing: validated read-only SELECT/WITH only, row-capped. */
  query(sql: string, maxRows?: number): Promise<QueryResult>;
  /** Internal/trusted: runs any statement (e.g. DESCRIBE) unvalidated. */
  raw(sql: string, maxRows?: number): Promise<QueryResult>;
  tables(): string[];
  dataDir: string;
}

function normalizeValue(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('micros' in o) return new Date(Number(o.micros) / 1000).toISOString();
    if ('days' in o)
      return new Date(Number(o.days) * 86400000).toISOString().slice(0, 10);
    if (Array.isArray(v)) return v.map(normalizeValue);
  }
  return v;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(row)) out[k] = normalizeValue(val);
  return out;
}

const READ_ONLY = /^\s*(select|with)\b/i;
const FORBIDDEN =
  /\b(insert|update|delete|drop|create|alter|attach|detach|copy|pragma|install|load|export|set|call|truncate)\b/i;

const cache = new Map<string, Promise<Duck>>();

async function init(datasetId: string): Promise<Duck> {
  const dir = datasetDir(datasetId);
  if (!dir) throw new Error(`Unknown dataset: ${datasetId}`);

  const instance = await DuckDBInstance.create(':memory:');
  const conn: DuckDBConnection = await instance.connect();

  const csvFiles = readdirSync(dir).filter(f => f.endsWith('.csv'));
  const tableNames: string[] = [];
  for (const file of csvFiles) {
    const name = viewName(file);
    const abs = toPosix(path.join(dir, file));
    await conn.run(
      `CREATE VIEW ${name} AS SELECT * FROM read_csv_auto('${abs}', sample_size=-1)`
    );
    tableNames.push(name);
  }
  console.log(
    `DuckDB[${datasetId}] ready — ${tableNames.length} tables: ${tableNames.join(', ')}`
  );

  async function raw(sql: string, maxRows = 1000): Promise<QueryResult> {
    const wrapped = `SELECT * FROM (${sql.trim().replace(/;\s*$/, '')}) AS _q LIMIT ${maxRows + 1}`;
    const reader = await conn.runAndReadAll(wrapped);
    const allRows = reader.getRowObjects() as Record<string, unknown>[];
    const truncated = allRows.length > maxRows;
    const rows = (truncated ? allRows.slice(0, maxRows) : allRows).map(
      normalizeRow
    );
    return {
      columns: reader.columnNames(),
      rows,
      rowCount: rows.length,
      truncated
    };
  }

  async function query(sql: string, maxRows = 1000): Promise<QueryResult> {
    const trimmed = sql.trim().replace(/;\s*$/, '');
    if (!READ_ONLY.test(trimmed)) {
      throw new Error('Only read-only SELECT / WITH queries are allowed.');
    }
    if (FORBIDDEN.test(trimmed)) {
      throw new Error('Query contains a forbidden (write/DDL) keyword.');
    }
    if (trimmed.includes(';')) {
      throw new Error('Only a single statement is allowed (no ";").');
    }
    return raw(trimmed, maxRows);
  }

  return { query, raw, tables: () => [...tableNames], dataDir: dir };
}

export function getDuck(datasetId: string): Promise<Duck> {
  let p = cache.get(datasetId);
  if (!p) {
    p = init(datasetId);
    cache.set(datasetId, p);
  }
  return p;
}
