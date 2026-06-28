export const homePath = () => '/';

export const datasetPath = (datasetId: string) =>
  `/app/datasets/${encodeURIComponent(datasetId)}`;

export const sessionPath = (datasetId: string, sessionId: string) =>
  `${datasetPath(datasetId)}/sessions/${encodeURIComponent(sessionId)}`;
