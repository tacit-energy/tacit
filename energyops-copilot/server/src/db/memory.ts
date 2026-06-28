// Persistent state (SQLite): dataset-scoped operator annotations, and the
// session registry (id, dataset, name, SDK session id for resume).

import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { ServerEvent } from '../types.js';
import { datasetDir } from './datasets.js';

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
    source_session_id TEXT,
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
  CREATE TABLE IF NOT EXISTS decisions (
    id               TEXT PRIMARY KEY,
    dataset_id       TEXT NOT NULL,
    session_id       TEXT,
    insight_card_id  TEXT,
    insight_title    TEXT NOT NULL,
    decision_type    TEXT NOT NULL,   -- 'accept' | 'override' | 'dismiss'
    rationale        TEXT,
    related_node_ids TEXT,            -- JSON string[]
    insight_snapshot TEXT,            -- JSON InsightCardSpec subset
    impact           REAL,
    created_at       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_decisions_dataset ON decisions(dataset_id);
  CREATE TABLE IF NOT EXISTS session_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    event_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_session_events_session
    ON session_events(session_id, id);
`);

const sessionCols = db.prepare('PRAGMA table_info(sessions)').all() as {
  name: string;
}[];
if (sessionCols.length && !sessionCols.some(c => c.name === 'provider')) {
  db.exec("ALTER TABLE sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'");
}
if (sessionCols.length && !sessionCols.some(c => c.name === 'model')) {
  db.exec('ALTER TABLE sessions ADD COLUMN model TEXT');
}
if (sessionCols.length && !sessionCols.some(c => c.name === 'include_previous_knowledge')) {
  db.exec('ALTER TABLE sessions ADD COLUMN include_previous_knowledge INTEGER NOT NULL DEFAULT 1');
}

const currentAnnCols = db.prepare('PRAGMA table_info(annotations)').all() as {
  name: string;
}[];
if (currentAnnCols.length && !currentAnnCols.some(c => c.name === 'source_session_id')) {
  db.exec('ALTER TABLE annotations ADD COLUMN source_session_id TEXT');
}

const decisionCols = db.prepare('PRAGMA table_info(decisions)').all() as {
  name: string;
}[];
if (decisionCols.length && !decisionCols.some(c => c.name === 'insight_snapshot')) {
  db.exec('ALTER TABLE decisions ADD COLUMN insight_snapshot TEXT');
}

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
  source_session_id: string | null;
  updated_at: string;
}

const upsertStmt = db.prepare(`
  INSERT INTO annotations
    (dataset_id, target_kind, target_id, text, source_session_id, updated_at)
  VALUES
    (@dataset_id, @target_kind, @target_id, @text, @source_session_id, @updated_at)
  ON CONFLICT(dataset_id, target_kind, target_id)
  DO UPDATE SET
    text = excluded.text,
    source_session_id = COALESCE(excluded.source_session_id, annotations.source_session_id),
    updated_at = excluded.updated_at
`);

export function setAnnotation(
  datasetId: string,
  kind: AnnotationKind,
  id: string,
  text: string,
  sourceSessionId?: string | null
): Annotation {
  const row: Annotation = {
    dataset_id: datasetId,
    target_kind: kind,
    target_id: String(id),
    text,
    source_session_id: sourceSessionId ?? null,
    updated_at: new Date().toISOString()
  };
  upsertStmt.run(row);
  return row;
}

// One-time seed of operator knowledge shipped with a dataset. If the dataset
// folder has an annotations.json and no annotations exist yet for it, load them.
// Additive and idempotent: never overwrites annotations a user has since added.
const seededDatasets = new Set<string>();
const countStmt = db.prepare(
  'SELECT count(*) AS n FROM annotations WHERE dataset_id = ?'
);

function ensureAnnotationsSeeded(datasetId: string): void {
  if (seededDatasets.has(datasetId)) return;
  seededDatasets.add(datasetId);
  const dir = datasetDir(datasetId);
  if (!dir) return;
  const file = path.join(dir, 'annotations.json');
  if (!existsSync(file)) return;
  if (Number((countStmt.get(datasetId) as { n: number }).n) > 0) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;
  for (const raw of parsed) {
    const a = raw as Partial<Annotation> & { target_kind?: string };
    if (!a?.target_kind || a.target_id == null || !a.text) continue;
    upsertStmt.run({
      dataset_id: datasetId,
      target_kind: a.target_kind,
      target_id: String(a.target_id),
      text: String(a.text),
      source_session_id: null,
      updated_at: a.updated_at ?? new Date().toISOString()
    });
  }
}

export function getAnnotations(filter: {
  datasetId: string;
  kind?: AnnotationKind;
  id?: string;
}): Annotation[] {
  const { datasetId, kind, id } = filter;
  ensureAnnotationsSeeded(datasetId);
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
  provider: 'claude' | 'openrouter' | 'azure';
  model: string | null;
  include_previous_knowledge: number;
  created_at: string;
  updated_at: string;
}

export function insertSession(row: {
  id: string;
  dataset_id: string;
  name: string;
  provider?: 'claude' | 'openrouter' | 'azure';
  model?: string | null;
  includePreviousKnowledge?: boolean;
}): SessionRow {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions
       (id, dataset_id, name, sdk_session_id, provider, model, include_previous_knowledge, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.dataset_id,
    row.name,
    row.provider ?? 'claude',
    row.model ?? null,
    row.includePreviousKnowledge === false ? 0 : 1,
    now,
    now
  );
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

export function deleteSessionRow(id: string): boolean {
  const tx = db.transaction((sessionId: string) => {
    db.prepare('DELETE FROM session_events WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM decisions WHERE session_id = ?').run(sessionId);
    return db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId).changes;
  });
  return tx(id) > 0;
}

// --- Session event snapshots -----------------------------------------------

export function appendSessionEvent(sessionId: string, event: ServerEvent): void {
  db.prepare(
    `INSERT INTO session_events (session_id, event_json, created_at)
     VALUES (?, ?, ?)`
  ).run(sessionId, JSON.stringify(event), new Date().toISOString());
}

export function getSessionEvents(sessionId: string): ServerEvent[] {
  const rows = db
    .prepare('SELECT event_json FROM session_events WHERE session_id = ? ORDER BY id')
    .all(sessionId) as { event_json: string }[];

  const events: ServerEvent[] = [];
  for (const row of rows) {
    try {
      events.push(JSON.parse(row.event_json) as ServerEvent);
    } catch {
      // Ignore corrupt dev rows; the rest of the snapshot is still useful.
    }
  }
  return events;
}

// --- Decisions (dataset-scoped) --------------------------------------------

export type DecisionType = 'accept' | 'override' | 'dismiss';

export interface DecisionRow {
  id: string;
  dataset_id: string;
  session_id: string | null;
  insight_card_id: string | null;
  insight_title: string;
  decision_type: DecisionType;
  rationale: string | null;
  related_node_ids: string | null; // JSON string[]
  insight_snapshot: string | null; // JSON InsightSnapshot
  impact: number | null;
  created_at: string;
}

export interface Decision
  extends Omit<DecisionRow, 'related_node_ids' | 'insight_snapshot'> {
  related_node_ids: string[];
  insight_snapshot: unknown | null;
}

function hydrate(row: DecisionRow): Decision {
  let nodes: string[] = [];
  let insightSnapshot: unknown | null = null;
  try {
    nodes = row.related_node_ids ? JSON.parse(row.related_node_ids) : [];
  } catch {
    nodes = [];
  }
  try {
    insightSnapshot = row.insight_snapshot ? JSON.parse(row.insight_snapshot) : null;
  } catch {
    insightSnapshot = null;
  }
  return { ...row, related_node_ids: nodes, insight_snapshot: insightSnapshot };
}

export function recordDecision(input: {
  datasetId: string;
  sessionId?: string | null;
  insightCardId?: string | null;
  insightTitle: string;
  decisionType: DecisionType;
  rationale?: string | null;
  relatedNodeIds?: string[];
  insightSnapshot?: unknown | null;
  impact?: number | null;
}): Decision {
  const row: DecisionRow = {
    id: randomUUID(),
    dataset_id: input.datasetId,
    session_id: input.sessionId ?? null,
    insight_card_id: input.insightCardId ?? null,
    insight_title: input.insightTitle,
    decision_type: input.decisionType,
    rationale: input.rationale ?? null,
    related_node_ids: JSON.stringify(input.relatedNodeIds ?? []),
    insight_snapshot: input.insightSnapshot
      ? JSON.stringify(input.insightSnapshot)
      : null,
    impact: input.impact ?? null,
    created_at: new Date().toISOString()
  };
  db.prepare(
    `INSERT INTO decisions
       (id, dataset_id, session_id, insight_card_id, insight_title,
        decision_type, rationale, related_node_ids, insight_snapshot, impact, created_at)
     VALUES (@id, @dataset_id, @session_id, @insight_card_id, @insight_title,
        @decision_type, @rationale, @related_node_ids, @insight_snapshot, @impact, @created_at)`
  ).run(row);
  return hydrate(row);
}

export function getDecisions(filter: {
  datasetId: string;
  sessionId?: string;
  limit?: number;
}): Decision[] {
  const rows = filter.sessionId
    ? (db
        .prepare(
          'SELECT * FROM decisions WHERE dataset_id = ? AND session_id = ? ORDER BY created_at DESC LIMIT ?'
        )
        .all(filter.datasetId, filter.sessionId, filter.limit ?? 200) as DecisionRow[])
    : (db
        .prepare(
          'SELECT * FROM decisions WHERE dataset_id = ? ORDER BY created_at DESC LIMIT ?'
        )
        .all(filter.datasetId, filter.limit ?? 200) as DecisionRow[]);
  return rows.map(hydrate);
}

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 2)
  );

/** Rank prior decisions by related-node overlap + title-token overlap. */
export function findSimilarDecisions(filter: {
  datasetId: string;
  nodeIds?: string[];
  title?: string;
  limit?: number;
}): Decision[] {
  const all = getDecisions({ datasetId: filter.datasetId });
  const wantNodes = new Set(filter.nodeIds ?? []);
  const wantTokens = filter.title ? tokens(filter.title) : new Set<string>();

  const scored = all.map(d => {
    const nodeOverlap = d.related_node_ids.filter(n => wantNodes.has(n)).length;
    const titleOverlap = [...tokens(d.insight_title)].filter(t =>
      wantTokens.has(t)
    ).length;
    return { d, score: nodeOverlap * 3 + titleOverlap };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, filter.limit ?? 3)
    .map(s => s.d);
}
