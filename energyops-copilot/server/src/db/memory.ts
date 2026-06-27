// Persistent state (SQLite): dataset-scoped operator annotations, and the
// session registry (id, dataset, name, SDK session id for resume).

import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const DB_PATH = process.env.MEMORY_DB
  ? process.env.MEMORY_DB
  : fileURLToPath(new URL('../../memory.db', import.meta.url));

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Migration: annotations gained a dataset_id column. Older dev DBs lacked it —
// drop the legacy table (dev data only) so the new schema applies cleanly.
const annCols = db.prepare('PRAGMA table_info(annotations)').all() as {
  name: string;
}[];
if (annCols.length && !annCols.some(c => c.name === 'dataset_id')) {
  db.exec('DROP TABLE annotations');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS annotations (
    dataset_id  TEXT NOT NULL,
    target_kind TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    text        TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (dataset_id, target_kind, target_id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id             TEXT PRIMARY KEY,
    dataset_id     TEXT NOT NULL,
    name           TEXT NOT NULL,
    sdk_session_id TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
`);

// --- Annotations (dataset-scoped) ------------------------------------------

export type AnnotationKind =
  | 'sensor'
  | 'node'
  | 'edge'
  | 'subsystem'
  | 'dataset'
  | 'widget';

export interface Annotation {
  dataset_id: string;
  target_kind: AnnotationKind;
  target_id: string;
  text: string;
  updated_at: string;
}

const upsertStmt = db.prepare(`
  INSERT INTO annotations (dataset_id, target_kind, target_id, text, updated_at)
  VALUES (@dataset_id, @target_kind, @target_id, @text, @updated_at)
  ON CONFLICT(dataset_id, target_kind, target_id)
  DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at
`);

export function setAnnotation(
  datasetId: string,
  kind: AnnotationKind,
  id: string,
  text: string
): Annotation {
  const row: Annotation = {
    dataset_id: datasetId,
    target_kind: kind,
    target_id: String(id),
    text,
    updated_at: new Date().toISOString()
  };
  upsertStmt.run(row);
  return row;
}

export function getAnnotations(filter: {
  datasetId: string;
  kind?: AnnotationKind;
  id?: string;
}): Annotation[] {
  const { datasetId, kind, id } = filter;
  if (kind && id) {
    return db
      .prepare(
        'SELECT * FROM annotations WHERE dataset_id = ? AND target_kind = ? AND target_id = ?'
      )
      .all(datasetId, kind, String(id)) as Annotation[];
  }
  if (kind) {
    return db
      .prepare('SELECT * FROM annotations WHERE dataset_id = ? AND target_kind = ?')
      .all(datasetId, kind) as Annotation[];
  }
  return db
    .prepare('SELECT * FROM annotations WHERE dataset_id = ? ORDER BY updated_at DESC')
    .all(datasetId) as Annotation[];
}

/** Map of sensorId -> annotation text for a dataset, for enriching topology. */
export function annotationsBySensor(datasetId: string): Map<number, string> {
  const rows = getAnnotations({ datasetId, kind: 'sensor' });
  const map = new Map<number, string>();
  for (const r of rows) map.set(Number(r.target_id), r.text);
  return map;
}

// --- Sessions --------------------------------------------------------------

export interface SessionRow {
  id: string;
  dataset_id: string;
  name: string;
  sdk_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export function insertSession(row: {
  id: string;
  dataset_id: string;
  name: string;
}): SessionRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, dataset_id, name, sdk_session_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?)`
  ).run(row.id, row.dataset_id, row.name, now, now);
  return getSessionRow(row.id)!;
}

export function setSdkSessionId(id: string, sdkId: string): void {
  db.prepare('UPDATE sessions SET sdk_session_id = ?, updated_at = ? WHERE id = ?').run(
    sdkId,
    new Date().toISOString(),
    id
  );
}

export function getSessionRow(id: string): SessionRow | undefined {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
    | SessionRow
    | undefined;
}

export function listSessions(datasetId: string): SessionRow[] {
  return db
    .prepare('SELECT * FROM sessions WHERE dataset_id = ? ORDER BY updated_at DESC')
    .all(datasetId) as SessionRow[];
}

export function touchSession(id: string): void {
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id
  );
}

export function renameSession(id: string, name: string): void {
  db.prepare('UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?').run(
    name,
    new Date().toISOString(),
    id
  );
}
