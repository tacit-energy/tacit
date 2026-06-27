// Thin fetch helpers for the dataset / session REST API.

export interface DatasetInfo {
  id: string;
  name: string;
  scenario?: string;
  narrative?: string;
  sensors?: number;
  diagrams?: number;
  startDate?: string;
  days?: number;
}

export interface SessionRow {
  id: string;
  dataset_id: string;
  name: string;
  sdk_session_id: string | null;
  created_at: string;
  updated_at: string;
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

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const getDatasets = () => getJSON<DatasetInfo[]>('/datasets');
export const getSessions = (datasetId: string) =>
  getJSON<SessionRow[]>(`/datasets/${datasetId}/sessions`);
export const getTopologies = (datasetId: string) =>
  getJSON<DiagramInfo[]>(`/datasets/${datasetId}/topologies`);
export const getTables = (datasetId: string) =>
  getJSON<TableInfo[]>(`/datasets/${datasetId}/tables`);

export async function startSession(
  datasetId: string,
  prompt?: string
): Promise<string> {
  const res = await fetch(`/datasets/${datasetId}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });
  const { id } = (await res.json()) as { id: string };
  return id;
}
