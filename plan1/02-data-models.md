# Spec 02: Data Models

All types live in `src/types/index.ts`. The design is **agnostic** — generic enough for a factory, a campus, or a district-heating grid. Everything here is serializable to JSON (no class instances, no functions, no `Date` objects — timestamps are ISO strings).

## 1. Topology

```ts
export type NodeStatus = 'ok' | 'warning' | 'critical';

export type NodeType =
  | 'chiller'
  | 'heat_exchanger'
  | 'valve'
  | 'pump'
  | 'sensor_group'
  | 'boiler'
  | 'generic';

export interface TopologyNode {
  id: string;            // stable; referenced by edges, time-series, anomalies
  type: NodeType;
  name: string;          // e.g. "Main Chiller", "Return Valve V3"
  status: NodeStatus;    // drives node color + badge in the canvas
  meta?: Record<string, string | number>; // optional: location, rated power, etc.
}

export interface TopologyEdge {
  id: string;
  source: string;        // TopologyNode.id
  target: string;        // TopologyNode.id
  label?: string;        // optional flow label, e.g. "chilled water"
}

export interface TopologyData {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}
```

> **ReactFlow mapping:** `TopologyNode` → ReactFlow node `{ id, type: 'rich', position, data: TopologyNode }`. `TopologyEdge` → `{ id, source, target, label }`. Positions are assigned by a simple layout helper (see `04`), since Agent 1 returns logical nodes, not coordinates.

## 2. Time Series

```ts
export interface TimePoint {
  timestamp: string;     // ISO 8601, e.g. "2026-06-15T08:00:00Z"
  value: number;
}

export interface TimeSeriesData {
  nodeId: string;        // TopologyNode.id this series belongs to
  unit?: string;         // e.g. "°C", "kW", "%"
  metric?: string;       // e.g. "supply_temp", "power_draw"
  points: TimePoint[];   // ordered ascending by timestamp; drives the sparkline
}
```

The store holds `timeSeries: TimeSeriesData[]`. A node may have one primary series for its sparkline; additional series are allowed and selectable later (not required for the prototype).

## 3. Anomalies

```ts
export type ConfidenceType = 'rule_based_data' | 'ai_inferred';

export interface AnomalyData {
  id: string;
  description: string;          // human-readable summary
  relatedNodeIds: string[];     // TopologyNode.id[]
  timestamp: string;            // ISO 8601 — when detected
  confidenceScore: number;      // 0–100
  confidenceType: ConfidenceType;

  // --- UI / loop state (not produced by Agent 2; managed by the store) ---
  status: AnomalyStatus;        // see below
  explanation?: MemoryRecall;   // populated when "Explain (AI)" runs Agent 3
  isExplaining?: boolean;       // spinner flag for the Explain button
}

export type AnomalyStatus =
  | 'open'        // newly detected, awaiting operator
  | 'accepted'    // operator accepted the AI action
  | 'overridden'  // operator modified the action (rationale captured)
  | 'dismissed';  // operator dismissed (rationale captured)
```

> **`confidenceType` is load-bearing.** `rule_based_data` → solid **blue** badge ("Rule-based"); `ai_inferred` → vibrant **orange** badge ("Inferred from past decision"). This contrast is the product's signature (Spec 04 §ConfidenceBadge).

## 4. Decision Memory (the compounding asset)

```ts
export type ActionTaken = 'accept' | 'modify' | 'dismiss';

export interface DecisionMemory {
  id: string;
  anomalyId: string;            // the anomaly this decision resolved
  anomalySnapshot: {            // denormalized so memory survives independently
    description: string;
    relatedNodeIds: string[];
    confidenceType: ConfidenceType;
  };
  humanRationale: string;       // the captured "why" (required for modify/dismiss)
  actionTaken: ActionTaken;
  timestamp: string;            // ISO 8601 — when the decision was made
}
```

The full `decisionMemory: DecisionMemory[]` array is passed verbatim to Agent 3.

## 5. Agent 3 Recall Result

```ts
export interface MemoryRecall {
  isRelated: boolean;
  pastRationale?: string;       // present when isRelated
  suggestedAction?: string;     // present when isRelated
  relatedDecisionId?: string;   // optional back-reference into decisionMemory
}
```

Stored on the anomaly as `explanation` after **Explain (AI)** completes.

## 6. Raw Sensors (Agent 1 input)

```ts
export interface RawSensor {
  id: string;
  name: string;                 // e.g. "TT-1043 supply temp, Plant Room B"
  type: string;                 // free-form sensor type
  location: string;             // building / zone / system
  unit: string;
  lastValue?: number;
  tags?: string[];
}
```

`rawSensors: RawSensor[]` (the dummy ~2,000-entry dataset, Spec 06) is the input to Agent 1, which collapses it into a `TopologyData`.

## 7. Settings & Provider Config

```ts
export type ProviderId = 'anthropic' | 'openai' | 'demo';

export interface ProviderConfig {
  apiKey: string;               // empty string if not provided
  model: string;                // provider-specific default
}

export interface Settings {
  provider: ProviderId;                 // active backend (switchable at runtime)
  providers: Record<ProviderId, ProviderConfig>;
  demoMode: boolean;            // hidden toggle; see Spec 06
}
```

## 8. Impact KPIs (derived, not stored)

```ts
export interface ImpactSummary {
  co2TonsSaved: number;
  eurosSaved: number;
  resolvedCount: number;
}
```

Computed from resolved anomalies via `src/lib/impact.ts` (Spec 04 §Top Bar). Not part of the persisted state — recomputed from `anomalies` + `decisionMemory`.

## 9. Persisted App State (the Export/Import shape)

```ts
export interface PersistedState {
  version: 1;                   // schema version for forward-compat
  exportedAt: string;           // ISO 8601
  rawSensors: RawSensor[];
  topology: TopologyData | null;
  timeSeries: TimeSeriesData[];
  anomalies: AnomalyData[];
  decisionMemory: DecisionMemory[];
  settings: Settings;           // NOTE: see Spec 03 — API keys are stripped on export by default
}
```

This is exactly what `Export State` writes and `Import State` reads (Spec 03 §Import/Export). Keeping it as a flat, explicit shape (rather than dumping the whole Zustand store, which also contains action functions and transient UI flags) keeps the JSON clean and the demo "Day 1 / Day 14" files hand-editable.

## 10. Invariants

- Every `AnomalyData.relatedNodeIds[i]` and `TimeSeriesData.nodeId` must reference an existing `TopologyNode.id`. (Agent outputs are validated/clamped on ingest; dangling refs are dropped — see `extractJSON`/agent post-processing in Spec 05.)
- `confidenceScore` is clamped to `[0, 100]`.
- `confidenceType` must be one of the two literals; unknown values default to `'ai_inferred'` (the more cautious label) and a console warning.
- Timestamps are ISO strings. To stay reproducible across Export/Import, demo timestamps are fixed constants (Spec 06), not `new Date()`.
