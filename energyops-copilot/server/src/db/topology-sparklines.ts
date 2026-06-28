import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { datasetDir } from './datasets.js';
import { getDuck, type Duck } from './duck.js';
import type { TopologySpec } from '../types.js';

const NUMERIC = /INT|DOUBLE|DECIMAL|FLOAT|REAL|HUGEINT|BIGINT/i;
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

type TopologyNode = TopologySpec['nodes'][number];
type NodeSparkline = NonNullable<TopologyNode['sparkline']>;

interface TsSchema {
  table: string;
  idCol: string;
  timeCol: string;
  valueCol: string;
  catalog?: { table: string; idCol: string; nameCol: string };
}

interface CacheEntry {
  fingerprint: string;
  summary: Promise<Map<number, NodeSparkline>>;
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

async function columns(duck: Duck, table: string) {
  const d = await duck.raw(`DESCRIBE ${q(table)}`, 1000);
  return d.rows.map(r => ({
    name: String(r.column_name),
    type: String(r.column_type)
  }));
}

async function sniff(datasetId: string): Promise<TsSchema | null> {
  const duck = await getDuck(datasetId);
  let best: TsSchema | null = null;
  let bestRows = -1;

  for (const table of duck.tables()) {
    const cols = await columns(duck, table);
    const timeCol = cols.find(c => /TIMESTAMP|DATE/i.test(c.type));
    const idCol =
      cols.find(c => c.name.toLowerCase() === 'sensor_id') ??
      cols.find(c => /(^|_)id$/i.test(c.name) && NUMERIC.test(c.type));
    if (!timeCol || !idCol) continue;

    const valueCol =
      cols.find(c => c.name.toLowerCase() === 'value') ??
      cols.find(
        c =>
          NUMERIC.test(c.type) &&
          !/expected|deviation|sample|count|_id$/i.test(c.name) &&
          c.name !== idCol.name
      );
    if (!valueCol) continue;

    const { rows } = await duck.raw(`SELECT count(*) AS n FROM ${q(table)}`, 1);
    const n = Number(rows[0]?.n ?? 0);
    if (n <= bestRows) continue;
    bestRows = n;

    let catalog: TsSchema['catalog'];
    for (const t of duck.tables()) {
      if (t === table) continue;
      const cc = await columns(duck, t);
      const cid = cc.find(c => c.name.toLowerCase() === idCol.name.toLowerCase());
      const cname = cc.find(c => /name|label|description/i.test(c.name));
      if (cid && cname) {
        catalog = { table: t, idCol: cid.name, nameCol: cname.name };
        break;
      }
    }

    best = {
      table,
      idCol: idCol.name,
      timeCol: timeCol.name,
      valueCol: valueCol.name,
      catalog
    };
  }
  return best;
}

function truthySql(expr: string): string {
  return `lower(CAST(${expr} AS VARCHAR)) IN ('true', '1', 'yes', 'y')`;
}

async function computeSparklines(
  datasetId: string
): Promise<Map<number, NodeSparkline>> {
  const s = await sniff(datasetId);
  if (!s) return new Map();
  const duck = await getDuck(datasetId);

  let cumulativeCol: string | undefined;
  let unitCol: string | undefined;
  if (s.catalog) {
    const cols = await columns(duck, s.catalog.table);
    cumulativeCol = cols.find(c => c.name.toLowerCase() === 'cumulative')?.name;
    unitCol = cols.find(c => c.name.toLowerCase() === 'unit')?.name;
  }

  const catalogJoin = s.catalog
    ? `LEFT JOIN ${q(s.catalog.table)} c ON d.${q(s.idCol)} = c.${q(s.catalog.idCol)}`
    : '';
  const isCumulativeExpr =
    s.catalog && cumulativeCol ? truthySql(`c.${q(cumulativeCol)}`) : 'false';
  const unitExpr = s.catalog && unitCol ? `c.${q(unitCol)}` : 'NULL';

  const res = await duck.raw(
    `WITH source AS (
       SELECT d.${q(s.idCol)} AS sid,
              d.${q(s.timeCol)} AS ts,
              d.${q(s.valueCol)} AS raw_value,
              ${isCumulativeExpr} AS is_cumulative,
              ${unitExpr} AS unit
       FROM ${q(s.table)} d
       ${catalogJoin}
     ), lagged AS (
       SELECT sid,
              ts,
              raw_value,
              lag(raw_value) OVER (PARTITION BY sid ORDER BY ts) AS prev_value,
              is_cumulative,
              unit
       FROM source
     ), daily AS (
       SELECT sid,
              CAST(date_trunc('day', ts) AS VARCHAR) AS day,
              is_cumulative,
              max(unit) AS unit,
              CASE
                WHEN is_cumulative THEN
                  sum(
                    CASE
                      WHEN prev_value IS NULL OR raw_value < prev_value THEN NULL
                      ELSE raw_value - prev_value
                    END
                  )
                ELSE avg(raw_value)
              END AS value
       FROM lagged
       GROUP BY sid, day, is_cumulative
     ), ranked AS (
       SELECT *,
              row_number() OVER (PARTITION BY sid ORDER BY day DESC) AS rn
       FROM daily
     )
     SELECT sid AS sensor_id,
            day,
            is_cumulative,
            unit,
            value
     FROM ranked
     WHERE rn <= 60
     ORDER BY sid, day`,
    200000
  );

  const bySensor = new Map<number, NodeSparkline>();
  for (const row of res.rows) {
    const sensorId = Number(row.sensor_id);
    if (!Number.isFinite(sensorId)) continue;
    const metric =
      row.is_cumulative === true || String(row.is_cumulative).toLowerCase() === 'true'
        ? 'daily_delta'
        : 'daily_average';
    const current =
      bySensor.get(sensorId) ??
      ({
        metric,
        unit: row.unit !== undefined && row.unit !== null ? String(row.unit) : undefined,
        points: []
      } satisfies NodeSparkline);
    current.points.push({
      date: String(row.day).slice(0, 10),
      value: row.value === null || row.value === undefined ? null : Number(row.value)
    });
    bySensor.set(sensorId, current);
  }

  return bySensor;
}

export function getTopologySparklineCache(
  datasetId: string
): Promise<Map<number, NodeSparkline>> {
  const fingerprint = csvFingerprint(datasetId);
  const entry = cache.get(datasetId);
  if (entry?.fingerprint === fingerprint) return entry.summary;

  let summary: Promise<Map<number, NodeSparkline>>;
  summary = computeSparklines(datasetId).catch(err => {
    if (cache.get(datasetId)?.summary === summary) cache.delete(datasetId);
    throw err;
  });
  cache.set(datasetId, { fingerprint, summary });
  return summary;
}

export async function warmTopologySparklineCache(datasetId: string): Promise<number> {
  try {
    return (await getTopologySparklineCache(datasetId)).size;
  } catch (err) {
    console.warn(`Failed to warm topology sparkline cache for ${datasetId}`, err);
    return 0;
  }
}

export async function enrichNodesWithSparklines<T extends TopologyNode>(
  datasetId: string,
  nodes: T[]
): Promise<T[]> {
  if (!nodes.some(node => node.sensorId !== undefined)) return nodes;
  let sparklines: Map<number, NodeSparkline>;
  try {
    sparklines = await getTopologySparklineCache(datasetId);
  } catch (err) {
    console.warn(`Failed to enrich topology nodes with sparklines for ${datasetId}`, err);
    return nodes;
  }
  return nodes.map(node => {
    if (node.sensorId === undefined) return node;
    const sparkline = sparklines.get(node.sensorId);
    return sparkline ? ({ ...node, sparkline } as T) : node;
  });
}
