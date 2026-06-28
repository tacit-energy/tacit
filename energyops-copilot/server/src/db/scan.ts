// Generic, schema-sniffing anomaly + data-quality scans, per dataset. Works on
// any dataset following the sensor-timeseries shape, with OR without an
// expected_value column (falls back to per-sensor statistical baselines).

import { getDuck, type Duck } from './duck.js';
import type { ChartSpec } from '../types.js';

interface TsSchema {
  table: string;
  idCol: string;
  timeCol: string;
  valueCol: string;
  expectedCol?: string;
  deviationCol?: string;
  catalog?: { table: string; idCol: string; nameCol: string };
}

const NUMERIC = /INT|DOUBLE|DECIMAL|FLOAT|REAL|HUGEINT|BIGINT/i;
const sanitizeTs = (s: string) => s.replace('T', ' ').replace('Z', '').trim();
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

const schemaCache = new Map<string, Promise<TsSchema | null>>();

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
      expectedCol: cols.find(c => /expected/i.test(c.name))?.name,
      deviationCol: cols.find(c => /deviation/i.test(c.name))?.name,
      catalog
    };
  }
  return best;
}

function getTsSchema(datasetId: string): Promise<TsSchema | null> {
  let p = schemaCache.get(datasetId);
  if (!p) {
    p = sniff(datasetId);
    schemaCache.set(datasetId, p);
  }
  return p;
}

function timeFilter(s: TsSchema, from?: string, to?: string): string {
  const parts: string[] = [];
  if (from) parts.push(`${q(s.timeCol)} >= TIMESTAMP '${sanitizeTs(from)}'`);
  if (to) parts.push(`${q(s.timeCol)} <= TIMESTAMP '${sanitizeTs(to)}'`);
  return parts.length ? parts.join(' AND ') : '';
}

function scopeFilter(s: TsSchema, sensorIds?: number[]): string {
  if (!sensorIds?.length) return '';
  return `${q(s.idCol)} IN (${sensorIds.map(Number).filter(Number.isFinite).join(',')})`;
}

function whereClause(...clauses: string[]): string {
  const cs = clauses.filter(Boolean);
  return cs.length ? `WHERE ${cs.join(' AND ')}` : '';
}

export interface AnomalyHit {
  sensor_id: number;
  name?: string;
  peak_at: string;
  magnitude: number;
  unit: 'deviation_pct' | 'pct_vs_expected' | 'zscore';
  value?: number;
  method: string;
}

export async function scanAnomalies(
  datasetId: string,
  opts: {
    from?: string;
    to?: string;
    sensorIds?: number[];
    method?: 'auto' | 'expected' | 'baseline';
    limit?: number;
  }
): Promise<{ method: string; schema: Partial<TsSchema>; results: AnomalyHit[] }> {
  const s = await getTsSchema(datasetId);
  if (!s) return { method: 'none', schema: {}, results: [] };
  const duck = await getDuck(datasetId);
  const limit = Math.min(opts.limit ?? 10, 50);
  const where = whereClause(
    timeFilter(s, opts.from, opts.to),
    scopeFilter(s, opts.sensorIds)
  );

  const useDeviation =
    (opts.method === 'auto' || opts.method === undefined) && s.deviationCol;
  const useExpected =
    !useDeviation &&
    (opts.method === 'expected' ||
      ((opts.method === 'auto' || opts.method === undefined) && s.expectedCol));

  let metric: string;
  let unit: AnomalyHit['unit'];
  let method: string;
  if (useDeviation) {
    metric = `abs(${q(s.deviationCol!)})`;
    unit = 'deviation_pct';
    method = `deviation-from-expected (${s.deviationCol})`;
  } else if (useExpected) {
    metric = `abs((${q(s.valueCol)} - ${q(s.expectedCol!)}) / nullif(${q(s.expectedCol!)}, 0)) * 100`;
    unit = 'pct_vs_expected';
    method = `pct-vs-expected (${s.expectedCol})`;
  } else {
    const inner = `
      WITH base AS (
        SELECT ${q(s.idCol)} AS sid, ${q(s.timeCol)} AS ts, ${q(s.valueCol)} AS v
        FROM ${q(s.table)} ${where}
      ), stats AS (
        SELECT sid, avg(v) m, stddev_pop(v) sd FROM base GROUP BY sid
      ), scored AS (
        SELECT b.sid, b.ts, b.v,
          CASE WHEN st.sd > 0 THEN abs((b.v - st.m) / st.sd) ELSE 0 END AS mag
        FROM base b JOIN stats st ON b.sid = st.sid
      ), ranked AS (
        SELECT sid, ts, v, mag,
          row_number() OVER (PARTITION BY sid ORDER BY mag DESC) rn
        FROM scored
      )
      SELECT sid AS sensor_id, ts AS peak_at, v AS value, mag AS magnitude
      FROM ranked WHERE rn = 1 ORDER BY mag DESC LIMIT ${limit}`;
    return finalize(duck, s, inner, 'zscore', 'per-sensor z-score baseline');
  }

  const inner = `
    WITH base AS (
      SELECT ${q(s.idCol)} AS sid, ${q(s.timeCol)} AS ts, ${q(s.valueCol)} AS value,
        ${metric} AS mag
      FROM ${q(s.table)} ${where}
    ), ranked AS (
      SELECT sid, ts, value, mag,
        row_number() OVER (PARTITION BY sid ORDER BY mag DESC NULLS LAST) rn
      FROM base WHERE mag IS NOT NULL
    )
    SELECT sid AS sensor_id, ts AS peak_at, value, mag AS magnitude
    FROM ranked WHERE rn = 1 ORDER BY mag DESC LIMIT ${limit}`;
  return finalize(duck, s, inner, unit, method);
}

async function finalize(
  duck: Duck,
  s: TsSchema,
  inner: string,
  unit: AnomalyHit['unit'],
  method: string
) {
  const res = await duck.raw(inner, 100);
  const names = await sensorNames(duck, s);
  const results: AnomalyHit[] = res.rows.map(r => ({
    sensor_id: Number(r.sensor_id),
    name: names.get(Number(r.sensor_id)),
    peak_at: String(r.peak_at),
    magnitude: Number((r.magnitude as number)?.toFixed?.(2) ?? r.magnitude),
    value: r.value !== undefined ? Number(r.value) : undefined,
    unit,
    method
  }));
  return {
    method,
    schema: { table: s.table, valueCol: s.valueCol, timeCol: s.timeCol },
    results
  };
}

async function sensorNames(duck: Duck, s: TsSchema): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (!s.catalog) return map;
  const r = await duck.raw(
    `SELECT ${q(s.catalog.idCol)} AS id, ${q(s.catalog.nameCol)} AS name FROM ${q(s.catalog.table)}`,
    5000
  );
  for (const row of r.rows) map.set(Number(row.id), String(row.name));
  return map;
}

function boolValue(v: unknown): boolean | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'boolean') return v;
  const normalized = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return undefined;
}

async function sensorMeta(
  duck: Duck,
  s: TsSchema,
  sensorId: number
): Promise<{ name?: string; cumulative?: boolean; unit?: string }> {
  if (!s.catalog) return {};
  const cols = await columns(duck, s.catalog.table);
  const cumulativeCol = cols.find(c => c.name.toLowerCase() === 'cumulative')?.name;
  const unitCol = cols.find(c => c.name.toLowerCase() === 'unit')?.name;
  const select = [
    `${q(s.catalog.nameCol)} AS name`,
    cumulativeCol ? `${q(cumulativeCol)} AS cumulative` : undefined,
    unitCol ? `${q(unitCol)} AS unit` : undefined
  ]
    .filter(Boolean)
    .join(', ');
  const r = await duck.raw(
    `SELECT ${select} FROM ${q(s.catalog.table)}
     WHERE ${q(s.catalog.idCol)} = ${Number(sensorId)}`,
    1
  );
  const row = r.rows[0];
  if (!row) return {};
  return {
    name: row.name !== undefined && row.name !== null ? String(row.name) : undefined,
    cumulative: boolValue(row.cumulative),
    unit: row.unit !== undefined && row.unit !== null ? String(row.unit) : undefined
  };
}

export interface QualityIssue {
  sensor_id: number;
  name?: string;
  type: 'gap' | 'stale' | 'inconsistent';
  severity: 'low' | 'med' | 'high';
  detail: string;
  from?: string;
  to?: string;
}

export async function scanDataQuality(
  datasetId: string,
  opts: { from?: string; to?: string; sensorIds?: number[] }
): Promise<{ checked: number; issues: QualityIssue[] }> {
  const s = await getTsSchema(datasetId);
  if (!s) return { checked: 0, issues: [] };
  const duck = await getDuck(datasetId);
  const where = whereClause(
    timeFilter(s, opts.from, opts.to),
    scopeFilter(s, opts.sensorIds)
  );
  const names = await sensorNames(duck, s);
  const issues: QualityIssue[] = [];

  const flat = await duck.raw(
    `SELECT ${q(s.idCol)} AS sid, count(*) AS n, stddev_pop(${q(s.valueCol)}) AS sd
     FROM ${q(s.table)} ${where}
     GROUP BY ${q(s.idCol)} HAVING n > 3 AND (sd = 0 OR sd IS NULL)`,
    1000
  );
  for (const r of flat.rows) {
    issues.push({
      sensor_id: Number(r.sid),
      name: names.get(Number(r.sid)),
      type: 'stale',
      severity: 'high',
      detail: `Value never changes across ${Number(r.n)} readings (flatlined / possibly stale).`,
      from: opts.from,
      to: opts.to
    });
  }

  const gaps = await duck.raw(
    `WITH d AS (
       SELECT ${q(s.idCol)} AS sid, ${q(s.timeCol)} AS ts,
         lag(${q(s.timeCol)}) OVER (
           PARTITION BY ${q(s.idCol)} ORDER BY ${q(s.timeCol)}) AS prev_ts,
         epoch(${q(s.timeCol)}) - epoch(lag(${q(s.timeCol)}) OVER (
           PARTITION BY ${q(s.idCol)} ORDER BY ${q(s.timeCol)})) AS gap
       FROM ${q(s.table)} ${where}
     ), agg AS (
       SELECT sid, median(gap) AS med, max(gap) AS mx FROM d WHERE gap IS NOT NULL GROUP BY sid
     ), ranked AS (
       SELECT d.sid, d.prev_ts, d.ts, d.gap, agg.med, agg.mx,
         row_number() OVER (PARTITION BY d.sid ORDER BY d.gap DESC NULLS LAST) AS rn
       FROM d JOIN agg ON d.sid = agg.sid
       WHERE d.gap IS NOT NULL
     )
     SELECT sid, prev_ts, ts, med, mx FROM ranked WHERE rn = 1 AND med > 0 AND mx > med * 3`,
    1000
  );
  for (const r of gaps.rows) {
    const med = Number(r.med);
    const mx = Number(r.mx);
    issues.push({
      sensor_id: Number(r.sid),
      name: names.get(Number(r.sid)),
      type: 'gap',
      severity: mx > med * 10 ? 'high' : 'med',
      detail: `Largest gap ${Math.round(mx / 60)} min vs typical ${Math.round(med / 60)} min between readings (missing data).`,
      from: r.prev_ts !== undefined && r.prev_ts !== null ? String(r.prev_ts) : undefined,
      to: r.ts !== undefined && r.ts !== null ? String(r.ts) : undefined
    });
  }

  const checked = names.size || (await sensorCount(duck, s));
  return { checked, issues };
}

async function sensorCount(duck: Duck, s: TsSchema): Promise<number> {
  const r = await duck.raw(
    `SELECT count(DISTINCT ${q(s.idCol)}) AS n FROM ${q(s.table)}`,
    1
  );
  return Number(r.rows[0]?.n ?? 0);
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** A single sensor's time series as a ChartSpec — powers the node drill-down. */
export async function getSensorSeries(
  datasetId: string,
  sensorId: number,
  opts: { from?: string; to?: string; maxPoints?: number } = {}
): Promise<ChartSpec | null> {
  const s = await getTsSchema(datasetId);
  if (!s) return null;
  const duck = await getDuck(datasetId);

  const meta = await sensorMeta(duck, s, sensorId);
  const cumulative = meta.cumulative === true;
  const where = [`${q(s.idCol)} = ${Number(sensorId)}`];
  if (!cumulative && opts.from) where.push(`${q(s.timeCol)} >= TIMESTAMP '${sanitizeTs(opts.from)}'`);
  if (!cumulative && opts.to) where.push(`${q(s.timeCol)} <= TIMESTAMP '${sanitizeTs(opts.to)}'`);

  const sql = cumulative
    ? `SELECT x,
              CASE
                WHEN prev_actual IS NULL OR actual < prev_actual THEN NULL
                ELSE actual - prev_actual
              END AS actual
              ${
                s.expectedCol
                  ? `, CASE
                       WHEN prev_expected IS NULL OR expected < prev_expected THEN NULL
                       ELSE expected - prev_expected
                     END AS expected`
                  : ''
              }
       FROM (
         SELECT ${q(s.timeCol)} AS x,
                ${q(s.valueCol)} AS actual,
                lag(${q(s.valueCol)}) OVER (ORDER BY ${q(s.timeCol)}) AS prev_actual
                ${
                  s.expectedCol
                    ? `, ${q(s.expectedCol)} AS expected,
                       lag(${q(s.expectedCol)}) OVER (ORDER BY ${q(s.timeCol)}) AS prev_expected`
                    : ''
                }
         FROM ${q(s.table)}
         WHERE ${q(s.idCol)} = ${Number(sensorId)}
       ) AS series
       ${whereClause(
         opts.from ? `x >= TIMESTAMP '${sanitizeTs(opts.from)}'` : '',
         opts.to ? `x <= TIMESTAMP '${sanitizeTs(opts.to)}'` : ''
       )}
       ORDER BY x`
    : `SELECT ${[
        `${q(s.timeCol)} AS x`,
        `${q(s.valueCol)} AS actual`,
        s.expectedCol ? `${q(s.expectedCol)} AS expected` : undefined
      ]
        .filter(Boolean)
        .join(', ')}
       FROM ${q(s.table)}
       WHERE ${where.join(' AND ')}
       ORDER BY ${q(s.timeCol)}`;
  const res = await duck.raw(sql, 5000);
  let rows = res.rows;
  const maxPoints = opts.maxPoints ?? 500;
  if (rows.length > maxPoints) {
    const stride = Math.ceil(rows.length / maxPoints);
    rows = rows.filter((_, i) => i % stride === 0);
  }

  const series: ChartSpec['series'] = [
    {
      name: cumulative ? 'Delta' : 'Actual',
      role: 'actual',
      data: rows.map(r => num(r.actual))
    }
  ];
  if (s.expectedCol) {
    series.push({
      name: cumulative ? 'Expected delta' : 'Expected',
      role: 'expected',
      data: rows.map(r => num(r.expected))
    });
  }
  return {
    title: meta.name ?? `Sensor ${sensorId}`,
    x: rows.map(r => String(r.x)),
    series,
    unit: meta.unit,
    chartType: 'line'
  };
}
