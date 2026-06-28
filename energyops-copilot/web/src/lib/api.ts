// Thin fetch helpers for the dataset / session REST API.
import type { ChartSpec, InsightCardSpec, ServerEvent, TopologySpec } from '@shared/types';

export interface DatasetInfo {
  id: string;
  name: string;
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

export interface SessionRow {
  id: string;
  dataset_id: string;
  name: string;
  sdk_session_id: string | null;
  provider?: 'claude' | 'openrouter' | 'azure';
  model?: string | null;
  include_previous_knowledge?: number;
  created_at: string;
  updated_at: string;
}

export interface SessionSnapshot {
  row: SessionRow;
  live: boolean;
  events: ServerEvent[];
}

export interface DiagramInfo {
  id: string;
  name: string;
  nodes: number;
}

export interface TableInfo {
  table: string;
  rows: number;
}

export interface TableRows {
  table: string;
  page: number;
  pageSize: number;
  totalRows: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

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

export interface AnalysisRange {
  from?: string;
  to?: string;
}

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const getDatasets = () => getJSON<DatasetInfo[]>('/datasets');
export const getSessions = (datasetId: string) =>
  getJSON<SessionRow[]>(`/datasets/${datasetId}/sessions`);
export const getSessionSnapshot = (sessionId: string) =>
  getJSON<SessionSnapshot>(`/sessions/${sessionId}/snapshot`);
export const getTopologies = (datasetId: string) =>
  getJSON<DiagramInfo[]>(`/datasets/${datasetId}/topologies`);
export const getTopology = (datasetId: string, diagramId: string) =>
  getJSON<TopologySpec>(
    `/datasets/${datasetId}/topologies/${encodeURIComponent(diagramId)}`
  );
export const getTables = (datasetId: string) =>
  getJSON<TableInfo[]>(`/datasets/${datasetId}/tables`);

export async function cacheDataset(datasetId: string): Promise<{
  ok: boolean;
  dataset: string;
  tables: number;
  rows: number;
}> {
  const res = await fetch(`/datasets/${datasetId}/cache`, { method: 'POST' });
  if (!res.ok) throw new Error(`cache dataset -> ${res.status}`);
  return res.json() as Promise<{
    ok: boolean;
    dataset: string;
    tables: number;
    rows: number;
  }>;
}

export const getTableRows = (
  datasetId: string,
  table: string,
  page: number,
  pageSize = 25
) =>
  getJSON<TableRows>(
    `/datasets/${datasetId}/tables/${encodeURIComponent(
      table
    )}/rows?page=${page}&pageSize=${pageSize}`
  );
export const getDatasetAnnotations = (datasetId: string) =>
  getJSON<Annotation[]>(`/datasets/${datasetId}/annotations`);

export async function postAnnotation(
  sessionId: string,
  body: { kind: AnnotationKind; id: string; text: string }
): Promise<Annotation> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/annotation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`annotation -> ${res.status}`);
  return res.json() as Promise<Annotation>;
}

export async function startSession(
  datasetId: string,
  prompt?: string,
  range?: AnalysisRange,
  provider?: 'claude' | 'openrouter' | 'azure',
  model?: string,
  openRouterApiKey?: string,
  azureEndpoint?: string,
  azureApiKey?: string,
  claudeApiKey?: string,
  includePreviousKnowledge?: boolean
): Promise<string> {
  const res = await fetch(`${API_BASE}/datasets/${datasetId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      range,
      provider,
      model,
      openRouterApiKey,
      azureEndpoint,
      azureApiKey,
      claudeApiKey,
      includePreviousKnowledge
    })
  });
  const { id } = (await res.json()) as { id: string };
  return id;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete session -> ${res.status}`);
}

export async function postProviderCredentials(
  sessionId: string,
  credentials: {
    claudeApiKey?: string;
    claudeModel?: string;
    openRouterApiKey?: string;
    azureEndpoint?: string;
    azureApiKey?: string;
    azureModel?: string;
  }
): Promise<void> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/provider-credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials)
  });
  if (!res.ok) throw new Error(`provider credentials -> ${res.status}`);
}

// --- Decisions + series ----------------------------------------------------

export type DecisionType = 'accept' | 'override' | 'dismiss';

export interface Decision {
  id: string;
  dataset_id: string;
  session_id: string | null;
  insight_card_id: string | null;
  insight_title: string;
  decision_type: DecisionType;
  rationale: string | null;
  related_node_ids: string[];
  insight_snapshot: Partial<InsightCardSpec> | null;
  impact: number | null;
  created_at: string;
}

export const getDatasetDecisions = (datasetId: string) =>
  getJSON<Decision[]>(`/datasets/${datasetId}/decisions`);

export const getDecisions = (sessionId: string) =>
  getJSON<Decision[]>(`/sessions/${sessionId}/decisions`);

export const getSimilarDecisions = (
  sessionId: string,
  nodeIds: string[],
  title: string
) =>
  getJSON<Decision[]>(
    `/sessions/${sessionId}/decisions/similar?nodeIds=${encodeURIComponent(
      nodeIds.join(',')
    )}&title=${encodeURIComponent(title)}`
  );

export async function postDecision(
  sessionId: string,
  body: {
    insightCardId?: string;
    insightTitle: string;
    decisionType: DecisionType;
    rationale?: string;
    relatedNodeIds?: string[];
    insightSnapshot?: Partial<InsightCardSpec>;
    impact?: number;
  }
): Promise<Decision> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`decision → ${res.status}`);
  return res.json() as Promise<Decision>;
}

export const getSeries = (
  sessionId: string,
  sensorId: number,
  range?: { from?: string; to?: string }
) => {
  const params = new URLSearchParams({ sensorId: String(sensorId) });
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  return getJSON<ChartSpec | null>(`/sessions/${sessionId}/series?${params}`);
};
