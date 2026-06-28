// Builds a demo-optimized EnergyOps dataset for a fictional medical campus.
// The data is synthetic but intentionally structured around a product demo:
// prior operator decisions are visible as tables and as seeded decision memory,
// and those decisions materially affect later operation.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const outDir = path.resolve(process.argv[2] ?? path.join(REPO, 'datasets/aster-campus-demo'));

const start = Date.parse('2026-04-20T00:00:00Z');
const end = Date.parse('2026-06-08T00:00:00Z');
const HOUR = 3_600_000;

const round = (value, digits = 3) =>
  Math.round((value + Number.EPSILON) * 10 ** digits) / 10 ** digits;
const iso = ms => new Date(ms).toISOString().replace('.000Z', 'Z');
const day = ms => iso(ms).slice(0, 10);
const hour = ms => new Date(ms).getUTCHours();
const dow = ms => new Date(ms).getUTCDay();
const inRange = (ms, from, to) => ms >= Date.parse(from) && ms < Date.parse(to);
const betweenHours = (ms, fromHour, toHour) => {
  const h = hour(ms);
  return h >= fromHour && h < toHour;
};

function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  return `${headers.join(',')}\n${rows
    .map(row => headers.map(header => csvCell(row[header])).join(','))
    .join('\n')}\n`;
}

const sensors = [
  [910101, 'Grid import', 'kW', 'electricity', 'source', 'grid', 'Utility import at the campus intertie. Positive means importing from the grid.', 'grid_import'],
  [910102, 'Campus electric load', 'kW', 'electricity', 'load', 'campus', 'Total campus electric demand before on-site generation and storage.', 'campus_load'],
  [910103, 'PV output', 'kW', 'electricity', 'source', 'renewable', 'Rooftop and carport photovoltaic output.', 'pv_output'],
  [910104, 'CHP electric output', 'kW', 'electricity', 'source', 'chp', 'Combined heat and power electric output.', 'chp_output'],
  [910105, 'Battery discharge power', 'kW', 'electricity', 'storage', 'battery', 'Battery power. Positive values discharge to support the campus.', 'battery_power'],
  [910106, 'Battery state of charge', '%', 'electricity', 'storage', 'battery', 'Battery state of charge.', 'battery_soc'],
  [910201, 'Chiller plant electric power', 'kW', 'cold', 'plant', 'cooling', 'Total electric power for the chilled-water plant.', 'chiller_power'],
  [910202, 'Chilled water supply temperature', 'C', 'cold', 'control', 'cooling', 'Leaving chilled-water temperature from the central plant.', 'chw_supply_temp'],
  [910203, 'Chilled water return temperature', 'C', 'cold', 'return', 'cooling', 'Return chilled-water temperature from campus loads.', 'chw_return_temp'],
  [910204, 'Chiller COP', 'COP', 'cold', 'efficiency', 'cooling', 'Measured chiller coefficient of performance.', 'chiller_cop'],
  [910205, 'North chilled water flow', 'm3/h', 'cold', 'branch', 'north', 'North branch chilled-water flow feeding critical clinical zones.', 'north_chw_flow'],
  [910301, 'OR AHU cooling load', 'kW', 'cold', 'consumer', 'or', 'Cooling load for operating-room air handling units.', 'or_ahu_load'],
  [910302, 'OR relative humidity', '%RH', '', 'comfort', 'or', 'Operating-room relative humidity.', 'or_humidity'],
  [910303, 'Lab chilled water load', 'kW', 'cold', 'consumer', 'lab', 'Research lab chilled-water load.', 'lab_cooling_load'],
  [910304, 'Data center cooling load', 'kW', 'cold', 'consumer', 'datacenter', 'Data center chilled-water load.', 'data_center_cooling'],
  [910401, 'Steam boiler gas input', 'kW', 'gas', 'plant', 'thermal', 'Gas input to steam boilers for reheat and sterilization.', 'boiler_gas'],
  [910402, 'Thermal storage state', '%', 'cold', 'storage', 'cooling', 'Thermal storage state of charge.', 'thermal_storage'],
  [910501, 'Outdoor air temperature', 'C', '', 'reference', 'weather', 'Outdoor air dry-bulb temperature.', 'outdoor_temp'],
  [910502, 'Outdoor relative humidity', '%RH', '', 'reference', 'weather', 'Outdoor air relative humidity.', 'outdoor_humidity']
].map(([sensor_id, name, unit, energy_type, role, branch, description, node]) => ({
  sensor_id,
  name,
  unit,
  cumulative: 'False',
  energy_type,
  role,
  branch,
  description,
  node
}));

const nodeById = new Map(sensors.map(sensor => [sensor.node, sensor]));

function weather(ms) {
  const h = hour(ms);
  const daily = Math.sin(((h - 6) / 24) * Math.PI * 2);
  const weekly = Math.sin(((ms - start) / (7 * 24 * HOUR)) * Math.PI * 2);
  let temp = 22 + 6 * Math.max(0, daily) + 1.8 * weekly;
  let rh = 54 - 8 * Math.max(0, daily) + 5 * Math.cos((h / 24) * Math.PI * 2);
  if (inRange(ms, '2026-06-02T12:00:00Z', '2026-06-04T09:00:00Z')) {
    temp += 4.5;
    rh += 18;
  }
  return { temp, rh };
}

function decisionState(ms) {
  return {
    chwReset: inRange(ms, '2026-05-20T08:00:00Z', '2026-06-04T10:00:00Z'),
    batteryReserve: inRange(ms, '2026-05-27T12:00:00Z', '2026-06-04T18:00:00Z'),
    economizer: inRange(ms, '2026-05-13T07:00:00Z', '2026-06-08T00:00:00Z')
  };
}

function eventName(ms) {
  if (inRange(ms, '2026-06-03T15:00:00Z', '2026-06-03T19:00:00Z')) return 'DR_CALL_HUMID_AFTERNOON';
  if (inRange(ms, '2026-06-02T12:00:00Z', '2026-06-04T09:00:00Z')) return 'HUMID_HEAT_EVENT';
  if (inRange(ms, '2026-05-27T10:00:00Z', '2026-05-27T12:00:00Z')) return 'BESS_RELAY_NUISANCE_TRIP';
  if (inRange(ms, '2026-05-20T08:00:00Z', '2026-05-20T10:00:00Z')) return 'CHW_RESET_ACCEPTED';
  return '';
}

const rows = [];
const push = (sensorId, timestamp, value, expected, sampleCount = 12) => {
  const deviation =
    expected != null && expected !== 0 ? round(((value - expected) / expected) * 100, 2) : '';
  rows.push({
    sensor_id: sensorId,
    timestamp,
    value: round(value),
    expected_value: expected == null ? '' : round(expected),
    deviation_pct: deviation,
    sample_count: sampleCount,
    scenario_event: eventName(Date.parse(timestamp))
  });
};

for (let ms = start; ms < end; ms += HOUR) {
  const ts = iso(ms);
  const h = hour(ms);
  const weekday = dow(ms) >= 1 && dow(ms) <= 5;
  const occupied = weekday && h >= 7 && h < 19;
  const clinical = weekday && h >= 6 && h < 21;
  const solar = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
  const w = weather(ms);
  const state = decisionState(ms);
  const dr = inRange(ms, '2026-06-03T15:00:00Z', '2026-06-03T19:00:00Z');
  const humidRisk = (w.rh > 62 && w.temp > 26 && clinical) || dr;

  const campusExpected = 1780 + (occupied ? 560 : 160) + Math.max(0, w.temp - 24) * 28;
  const campusActual = campusExpected + (dr ? 140 : 0) + (humidRisk ? 90 : 0);
  const pvExpected = solar * 760 * (w.rh > 70 ? 0.82 : 1);
  const pvActual = pvExpected * (inRange(ms, '2026-06-03T14:00:00Z', '2026-06-03T17:00:00Z') ? 0.72 : 0.96 + 0.04 * Math.sin(ms / HOUR));
  const chpExpected = 520;
  const chpActual = inRange(ms, '2026-05-08T06:00:00Z', '2026-05-08T12:00:00Z') ? 480 : 520;

  const chwExpected = 7;
  let chwActual = state.chwReset ? 8.6 : 7.1;
  if (humidRisk) chwActual += 0.4;
  const orLoadExpected = 280 + Math.max(0, w.temp - 22) * 12 + (clinical ? 70 : 25);
  const orLoadActual = orLoadExpected + (humidRisk && state.chwReset ? 95 : 10);
  const labLoadExpected = 230 + Math.max(0, w.temp - 22) * 8 + (occupied ? 70 : 20);
  const labLoadActual = labLoadExpected + (humidRisk ? 34 : 0);
  const dcLoadExpected = 330 + Math.max(0, w.temp - 24) * 6;
  const dcLoadActual = dcLoadExpected + 15 * Math.sin(ms / (6 * HOUR));
  const flowExpected = 560 + orLoadExpected * 0.55 + labLoadExpected * 0.25;
  const flowActual = flowExpected + (humidRisk && state.chwReset ? 105 : 0);
  const chillerExpected = 620 + (orLoadExpected + labLoadExpected + dcLoadExpected) * 0.42;
  const chillerActual =
    chillerExpected * (state.chwReset && !humidRisk ? 0.92 : 1) +
    (humidRisk && state.chwReset ? 235 : 0);
  const copExpected = 4.6 - Math.max(0, w.temp - 24) * 0.04;
  const copActual = copExpected + (state.chwReset && !humidRisk ? 0.25 : 0) - (humidRisk && state.chwReset ? 1.05 : 0);
  const returnExpected = chwExpected + 5.6;
  const returnActual = chwActual + 5.3 + (humidRisk ? 0.8 : 0);
  const boilerExpected = 430 + (clinical ? 180 : 80);
  const boilerActual = boilerExpected + (state.chwReset && humidRisk ? 155 : 0);
  const thermalExpected = 70 - Math.max(0, h - 10) * 1.3 + (h < 5 ? 22 : 0);
  const thermalActual = Math.max(18, Math.min(95, thermalExpected - (humidRisk ? 18 : 0)));

  let batteryExpected = dr ? 650 : h >= 17 && h < 20 ? 260 : h >= 11 && h < 15 ? -180 : 0;
  let batteryActual = batteryExpected;
  if (state.batteryReserve && batteryExpected > 0) batteryActual = dr ? 80 : 60;
  if (state.batteryReserve && batteryExpected < 0) batteryActual = -120;
  const socExpected = Math.max(24, Math.min(96, 64 - (h - 12) * 2 + (batteryExpected < 0 ? 18 : 0)));
  const socActual = state.batteryReserve
    ? Math.max(87, Math.min(96, socExpected + 28))
    : Math.max(20, Math.min(96, socExpected + 4 * Math.sin(ms / (8 * HOUR))));
  const gridExpected = campusExpected + chillerExpected - pvExpected - chpExpected - batteryExpected;
  const gridActual = campusActual + chillerActual - pvActual - chpActual - batteryActual;

  push(910101, ts, gridActual, gridExpected);
  push(910102, ts, campusActual, campusExpected);
  push(910103, ts, pvActual, pvExpected);
  push(910104, ts, chpActual, chpExpected);
  push(910105, ts, batteryActual, batteryExpected);
  push(910106, ts, socActual, socExpected);
  push(910201, ts, chillerActual, chillerExpected);
  push(910202, ts, chwActual, chwExpected);
  push(910203, ts, returnActual, returnExpected);
  push(910204, ts, copActual, copExpected);
  push(910205, ts, flowActual, flowExpected);
  push(910301, ts, orLoadActual, orLoadExpected);
  push(910302, ts, (state.chwReset && humidRisk ? 62 : 51 + Math.max(0, w.rh - 60) * 0.16), 52);
  push(910303, ts, labLoadActual, labLoadExpected);
  push(910304, ts, dcLoadActual, dcLoadExpected);
  push(910401, ts, boilerActual, boilerExpected);
  push(910402, ts, thermalActual, thermalExpected);
  push(910501, ts, w.temp, w.temp);
  push(910502, ts, w.rh, w.rh);
}

const sensorRows = sensors.map(({ node, ...sensor }) => sensor);
const attrRows = sensors.flatMap(sensor => [
  { sensor_id: sensor.sensor_id, attribute: 'node_id', value: sensor.node },
  { sensor_id: sensor.sensor_id, attribute: 'role', value: sensor.role },
  { sensor_id: sensor.sensor_id, attribute: 'branch', value: sensor.branch },
  { sensor_id: sensor.sensor_id, attribute: 'demo_relevance', value: ['or_humidity', 'chw_supply_temp', 'battery_power', 'grid_import', 'chiller_cop'].includes(sensor.node) ? 'hero_chain' : 'context' }
]);
const refRows = sensors.map(sensor => ({
  sensor_id: sensor.sensor_id,
  source: 'aster-campus-bms',
  external_id: `ASTER-${sensor.sensor_id}`,
  external_key: sensor.node,
  label: sensor.name
}));

const decisionsCsv = [
  {
    decision_id: 'DEC-2026-05-13-ECONOMIZER',
    decided_at: '2026-05-13T07:30:00Z',
    operator: 'Nora Weiss',
    decision_type: 'accept',
    affected_nodes: 'chiller_power;chw_supply_temp;or_ahu_load',
    action: 'Enable wider airside economizer window for shoulder-season nights.',
    rationale: 'Night temperatures were stable and OR humidity stayed below 52 percent during the trial.',
    status: 'active',
    active_from: '2026-05-13T08:00:00Z',
    active_to: '',
    expected_impact_eur: 1800,
    guardrail: 'Disable if OR RH exceeds 56 percent for two consecutive hours.',
    outcome: 'Held normally; not the primary June 3 driver.'
  },
  {
    decision_id: 'DEC-2026-05-20-CHW-RESET',
    decided_at: '2026-05-20T08:15:00Z',
    operator: 'Maya Koenig',
    decision_type: 'accept',
    affected_nodes: 'chw_supply_temp;chiller_power;chiller_cop;or_humidity;or_ahu_load',
    action: 'Raise chilled-water supply setpoint from 7.0 C to 8.6 C.',
    rationale: 'Two mild weeks showed improved COP and no clinical humidity excursions.',
    status: 'stale_guardrail_missed',
    active_from: '2026-05-20T08:30:00Z',
    active_to: '2026-06-04T10:00:00Z',
    expected_impact_eur: 4200,
    guardrail: 'Rollback if OR RH exceeds 58 percent or if chiller COP drops below 3.6.',
    outcome: 'On June 3 the humid event pushed OR RH above 60 percent and COP below 3.4.'
  },
  {
    decision_id: 'DEC-2026-05-27-BESS-RESERVE',
    decided_at: '2026-05-27T12:20:00Z',
    operator: 'Jonas Feld',
    decision_type: 'override',
    affected_nodes: 'battery_power;battery_soc;grid_import',
    action: 'Hold battery SOC above 88 percent after relay nuisance trip.',
    rationale: 'Protect backup reserve until relay inspection; accept higher imports temporarily.',
    status: 'active_too_long',
    active_from: '2026-05-27T12:30:00Z',
    active_to: '2026-06-04T18:00:00Z',
    expected_impact_eur: -2600,
    guardrail: 'Release reserve before any demand-response dispatch unless relay alarms recur.',
    outcome: 'Reserve was still active during the June 3 demand-response call, so the battery barely discharged.'
  },
  {
    decision_id: 'DEC-2026-06-04-ROLLBACK',
    decided_at: '2026-06-04T10:05:00Z',
    operator: 'Nora Weiss',
    decision_type: 'override',
    affected_nodes: 'chw_supply_temp;or_humidity;battery_power;grid_import',
    action: 'Rollback CHW reset and release battery reserve for DR participation.',
    rationale: 'June 3 showed the two temporary decisions interacted badly under humid peak conditions.',
    status: 'implemented',
    active_from: '2026-06-04T10:15:00Z',
    active_to: '',
    expected_impact_eur: 7600,
    guardrail: 'Keep OR RH below 56 percent and discharge battery during DR events unless a fresh relay alarm is present.',
    outcome: 'Humidity normalized and grid imports returned near expected after June 4.'
  }
];

const controlActions = [
  ['2026-05-13T08:00:00Z', 'DEC-2026-05-13-ECONOMIZER', 'or_ahu_load', 'economizer_min_oa_pct', 18, 28, 'accepted'],
  ['2026-05-20T08:30:00Z', 'DEC-2026-05-20-CHW-RESET', 'chw_supply_temp', 'supply_setpoint_c', 7, 8.6, 'accepted'],
  ['2026-05-27T12:30:00Z', 'DEC-2026-05-27-BESS-RESERVE', 'battery_soc', 'minimum_soc_pct', 35, 88, 'temporary_override'],
  ['2026-06-04T10:15:00Z', 'DEC-2026-06-04-ROLLBACK', 'chw_supply_temp', 'supply_setpoint_c', 8.6, 7, 'rollback'],
  ['2026-06-04T18:00:00Z', 'DEC-2026-06-04-ROLLBACK', 'battery_soc', 'minimum_soc_pct', 88, 35, 'released']
].map(([timestamp, decision_id, node_id, control, prior_value, new_value, mode]) => ({
  timestamp,
  decision_id,
  node_id,
  control,
  prior_value,
  new_value,
  mode
}));

const events = [
  ['2026-05-20T08:00:00Z', '2026-05-20T10:00:00Z', 'operator_decision', 'CHW reset accepted', 'Mild-weather efficiency decision raised chilled-water supply setpoint.'],
  ['2026-05-27T10:00:00Z', '2026-05-27T12:00:00Z', 'equipment_alarm', 'Battery relay nuisance trip', 'Spurious relay trip led to a conservative SOC override.'],
  ['2026-06-02T12:00:00Z', '2026-06-04T09:00:00Z', 'weather', 'Humid heat event', 'Outdoor humidity and temperature rose together, increasing latent cooling load.'],
  ['2026-06-03T15:00:00Z', '2026-06-03T19:00:00Z', 'market', 'Demand-response call', 'Campus was expected to discharge the battery and reduce grid import.'],
  ['2026-06-04T10:00:00Z', '2026-06-04T18:00:00Z', 'operator_decision', 'Rollback and release', 'Temporary decisions were rolled back after the June 3 interaction was reviewed.']
].map(([start_time, end_time, event_type, title, detail]) => ({
  start_time,
  end_time,
  event_type,
  title,
  detail
}));

const costRows = [
  ['currency', 'EUR'],
  ['energy_price_eur_per_kwh', 0.22],
  ['demand_charge_eur_per_kw_month', 14.5],
  ['dr_nonperformance_penalty_eur_per_kw', 38],
  ['or_humidity_risk_threshold_pct', 58],
  ['or_humidity_risk_eur_per_hour_above_threshold', 2200],
  ['chiller_low_cop_threshold', 3.6]
].map(([param, value]) => ({ param, value }));

const annotations = [
  {
    target_kind: 'sensor',
    target_id: '910302',
    text: '[2026-05-20 Nora] OR humidity guardrail for CHW reset is 58 percent. If it crosses that under humid weather, the setpoint reset should roll back immediately.',
    updated_at: '2026-05-20T08:30:00Z'
  },
  {
    target_kind: 'sensor',
    target_id: '910106',
    text: '[2026-05-27 Jonas] Battery minimum SOC was raised to 88 percent after a relay nuisance trip. This is temporary and should not block demand-response dispatch.',
    updated_at: '2026-05-27T12:30:00Z'
  },
  {
    target_kind: 'dataset',
    target_id: 'aster-campus-demo',
    text: 'Demo objective: connect prior decisions to later operation. The June 3 humid DR event is the primary story.',
    updated_at: '2026-06-04T10:15:00Z'
  }
];

const decisionMemory = [
  {
    id: 'seed-aster-chw-reset',
    dataset_id: 'aster-campus-demo',
    session_id: null,
    insight_card_id: 'seed-insight-chw-reset',
    insight_title: 'CHW reset saved energy in mild weather but needs humidity guardrail',
    decision_type: 'accept',
    rationale: 'Accepted the 8.6 C chilled-water reset after mild-weather data showed COP improvement. Guardrail: rollback if OR RH exceeds 58 percent or COP drops below 3.6.',
    related_node_ids: ['chw_supply_temp', 'chiller_power', 'chiller_cop', 'or_humidity', 'or_ahu_load'],
    impact: 4200,
    created_at: '2026-05-20T08:15:00Z',
    insight_snapshot: {
      title: 'CHW reset saved energy in mild weather but needs humidity guardrail',
      severity: 'watch',
      summary: 'Raising chilled-water supply from 7.0 C to 8.6 C improved plant efficiency during mild weeks, but the decision depends on OR humidity staying below 58 percent.',
      evidence: [
        'Chiller COP improved during mild occupied hours after 20.05.2026.',
        'OR humidity stayed near 52 percent during the acceptance window.',
        'The decision explicitly required rollback above 58 percent RH.'
      ],
      recommendations: [
        'Keep the reset active only while clinical humidity remains below the guardrail.',
        'Rollback automatically during humid weather or low-COP operation.'
      ],
      relatedNodeIds: ['chw_supply_temp', 'chiller_cop', 'or_humidity'],
      impact: { value: 4200, unit: 'EUR/month', confidence: 'med' },
      chart: {
        title: 'CHW reset acceptance window',
        x: ['2026-05-18T12:00:00Z', '2026-05-20T12:00:00Z', '2026-05-22T12:00:00Z'],
        unit: '%RH',
        chartType: 'line',
        referenceLines: [{ value: 58, label: 'Rollback guardrail' }],
        series: [{ name: 'OR RH', role: 'actual', data: [51.8, 52.4, 52.1] }]
      }
    }
  },
  {
    id: 'seed-aster-bess-reserve',
    dataset_id: 'aster-campus-demo',
    session_id: null,
    insight_card_id: 'seed-insight-bess-reserve',
    insight_title: 'Battery reserve override should not block demand response',
    decision_type: 'override',
    rationale: 'Raised minimum SOC to 88 percent after a nuisance relay trip, but only as a temporary protection until inspection. The guardrail says to release before DR unless the alarm recurs.',
    related_node_ids: ['battery_power', 'battery_soc', 'grid_import'],
    impact: -2600,
    created_at: '2026-05-27T12:20:00Z',
    insight_snapshot: {
      title: 'Battery reserve override should not block demand response',
      severity: 'watch',
      summary: 'The high-SOC override protects backup reserve after a relay event, but it suppresses dispatch value during peak grid events.',
      evidence: [
        'Minimum SOC was raised to 88 percent after the 27.05.2026 relay trip.',
        'The override was marked temporary and should be released before DR calls.',
        'Expected impact was negative while the override remained active.'
      ],
      recommendations: [
        'Release the override for DR windows unless a fresh relay alarm is present.',
        'Track grid import against expected battery discharge during every DR call.'
      ],
      relatedNodeIds: ['battery_power', 'battery_soc', 'grid_import'],
      impact: { value: -2600, unit: 'EUR', confidence: 'med' },
      chart: {
        title: 'Battery reserve override',
        x: ['2026-05-27T12:00:00Z', '2026-05-28T12:00:00Z', '2026-05-29T12:00:00Z'],
        unit: '%',
        chartType: 'line',
        referenceLines: [{ value: 88, label: 'Temporary minimum SOC' }],
        series: [{ name: 'Battery SOC', role: 'actual', data: [89, 91, 92] }]
      }
    }
  }
];

const positions = {
  grid_import: [60, 180],
  pv_output: [60, 40],
  chp_output: [60, 320],
  campus_load: [320, 180],
  battery_power: [320, 40],
  battery_soc: [560, 40],
  chiller_power: [560, 180],
  chw_supply_temp: [820, 120],
  chw_return_temp: [820, 260],
  chiller_cop: [560, 340],
  north_chw_flow: [1080, 180],
  or_ahu_load: [1340, 80],
  or_humidity: [1580, 80],
  lab_cooling_load: [1340, 220],
  data_center_cooling: [1340, 360],
  boiler_gas: [820, 440],
  thermal_storage: [1080, 440],
  outdoor_temp: [560, 540],
  outdoor_humidity: [820, 540]
};

const topology = {
  id: 'campus_microgrid',
  name: 'Aster medical campus energy system',
  type: 'energy_topology',
  nodes: Object.entries(positions).map(([node, [x, y]]) => {
    const sensor = nodeById.get(node);
    return {
      id: node,
      type: 'meterNode',
      position: { x, y },
      data: {
        label: sensor.name,
        sensor_id: sensor.sensor_id,
        unit: sensor.unit,
        energy_type: sensor.energy_type || null,
        role: sensor.role,
        branch: sensor.branch
      }
    };
  }),
  edges: [
    ['pv_output', 'campus_load', 'PV offsets load'],
    ['chp_output', 'campus_load', 'CHP offsets load'],
    ['battery_power', 'campus_load', 'Storage dispatch'],
    ['campus_load', 'grid_import', 'Net import'],
    ['battery_soc', 'battery_power', 'Dispatch constraint'],
    ['campus_load', 'chiller_power', 'Cooling electricity'],
    ['chiller_power', 'chw_supply_temp', 'Produces chilled water'],
    ['chw_return_temp', 'chiller_power', 'Return load'],
    ['chiller_power', 'chiller_cop', 'Plant efficiency'],
    ['chw_supply_temp', 'north_chw_flow', 'North loop supply'],
    ['north_chw_flow', 'or_ahu_load', 'Critical clinical load'],
    ['or_ahu_load', 'or_humidity', 'Latent control'],
    ['north_chw_flow', 'lab_cooling_load', 'Lab load'],
    ['north_chw_flow', 'data_center_cooling', 'Data center load'],
    ['boiler_gas', 'or_ahu_load', 'Reheat support'],
    ['thermal_storage', 'chiller_power', 'Load shifting'],
    ['outdoor_temp', 'chiller_power', 'Weather driver'],
    ['outdoor_humidity', 'or_humidity', 'Latent driver']
  ].map(([source, target, label], index) => ({
    id: `edge-${index + 1}`,
    source,
    target,
    data: { label }
  }))
};

const graphTxt =
  `# ${topology.name}\n\nTopology edges:\n` +
  topology.edges
    .map(edge => `- ${edge.source} -> ${edge.target}: ${edge.data.label}`)
    .join('\n') +
  '\n';

const manifest = {
  created_at_utc: new Date().toISOString(),
  source: 'synthetic_demo',
  scenario: 'prior_decision_influenced_operation',
  start_date: '2026-04-20',
  time_window: { start: '2026-04-20', end: '2026-06-07' },
  site: 'Aster Medical Campus',
  narrative:
    'Synthetic medical-campus microgrid and chilled-water dataset designed for EnergyOps Copilot demos. The hero incident is 2026-06-03: a humid demand-response event exposes two stale temporary decisions, a chilled-water reset and a battery reserve override.',
  hero_day: '2026-06-03',
  hero_window: ['15:00', '19:00'],
  counts: {
    sensors: sensors.length,
    diagrams: 1,
    hourly_sensor_rows: rows.length,
    sensor_attributes: attrRows.length,
    sensor_external_refs: refRows.length,
    decisions: decisionsCsv.length,
    seeded_decision_memory: decisionMemory.length,
    control_actions: controlActions.length,
    events: events.length,
    annotations: annotations.length
  },
  files: {
    readme: 'README.md',
    diagrams: 'diagrams/',
    sensors: 'sensors.csv',
    sensor_attributes: 'sensor_attributes.csv',
    sensor_external_refs: 'sensor_external_refs.csv',
    sensor_data_hourly: 'sensor_data_hourly.csv',
    decisions: 'decisions.csv',
    decision_memory: 'decisions.json',
    control_actions: 'control_actions.csv',
    events: 'events.csv',
    cost_model: 'cost_model.csv',
    annotations: 'annotations.json'
  }
};

const readme = `# Aster Medical Campus Demo Dataset

Synthetic dataset optimized for the EnergyOps Copilot product demo.

## Hero story

On 2026-06-03 from 15:00 to 19:00 UTC, a humid demand-response event exposes two
past decisions that were still influencing operations:

- DEC-2026-05-20-CHW-RESET raised chilled-water supply temperature from 7.0 C
  to 8.6 C. It saved energy in mild weather but had a 58 percent OR humidity
  rollback guardrail.
- DEC-2026-05-27-BESS-RESERVE held battery SOC above 88 percent after a relay
  nuisance trip. It was temporary and should have been released before demand
  response.

The interaction causes high OR humidity, low chiller COP, weak battery
discharge, and excess grid import. DEC-2026-06-04-ROLLBACK resolves the issue.

## Demo prompts

- What past decision influenced the June 3 operation?
- Show me why grid import spiked during the demand-response window.
- Did the chilled-water reset still make sense under humid conditions?
- Which prior decision should be recalled before acting on this insight?
`;

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(outDir, 'diagrams'), { recursive: true });

writeFileSync(
  path.join(outDir, 'sensors.csv'),
  toCsv(
    ['sensor_id', 'name', 'unit', 'cumulative', 'energy_type', 'role', 'branch', 'description'],
    sensorRows
  )
);
writeFileSync(
  path.join(outDir, 'sensor_data_hourly.csv'),
  toCsv(
    ['sensor_id', 'timestamp', 'value', 'expected_value', 'deviation_pct', 'sample_count', 'scenario_event'],
    rows
  )
);
writeFileSync(
  path.join(outDir, 'sensor_attributes.csv'),
  toCsv(['sensor_id', 'attribute', 'value'], attrRows)
);
writeFileSync(
  path.join(outDir, 'sensor_external_refs.csv'),
  toCsv(['sensor_id', 'source', 'external_id', 'external_key', 'label'], refRows)
);
writeFileSync(
  path.join(outDir, 'decisions.csv'),
  toCsv(
    [
      'decision_id',
      'decided_at',
      'operator',
      'decision_type',
      'affected_nodes',
      'action',
      'rationale',
      'status',
      'active_from',
      'active_to',
      'expected_impact_eur',
      'guardrail',
      'outcome'
    ],
    decisionsCsv
  )
);
writeFileSync(
  path.join(outDir, 'control_actions.csv'),
  toCsv(
    ['timestamp', 'decision_id', 'node_id', 'control', 'prior_value', 'new_value', 'mode'],
    controlActions
  )
);
writeFileSync(
  path.join(outDir, 'events.csv'),
  toCsv(['start_time', 'end_time', 'event_type', 'title', 'detail'], events)
);
writeFileSync(path.join(outDir, 'cost_model.csv'), toCsv(['param', 'value'], costRows));
writeFileSync(path.join(outDir, 'annotations.json'), JSON.stringify(annotations, null, 2));
writeFileSync(path.join(outDir, 'decisions.json'), JSON.stringify(decisionMemory, null, 2));
writeFileSync(
  path.join(outDir, 'diagrams/campus_microgrid.json'),
  JSON.stringify(topology, null, 2)
);
writeFileSync(path.join(outDir, 'diagrams/campus_microgrid_graph.txt'), graphTxt);
writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(path.join(outDir, 'README.md'), readme);

console.log(`Built ${outDir}`);
console.log(
  `  sensors=${sensors.length} rows=${rows.length} decisions=${decisionsCsv.length} events=${events.length}`
);
