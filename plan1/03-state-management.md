# Spec 03: State Management (Zustand + Import/Export)

Single store in `src/store/useAppStore.ts`. State is the single source of truth; the Export JSON is a projection of it (Spec 02 §9).

## 1. Store Shape

```ts
import { create } from 'zustand';

interface AppState {
  // ---- domain data ----
  rawSensors: RawSensor[];
  topology: TopologyData | null;
  timeSeries: TimeSeriesData[];
  anomalies: AnomalyData[];
  decisionMemory: DecisionMemory[];

  // ---- config ----
  settings: Settings;

  // ---- transient UI ----
  ui: {
    analysisRunning: boolean;
    analysisStage: null | 'understanding' | 'anomaly' | 'done';
    settingsOpen: boolean;
    dataSource: string;          // selected source label
    dateRange: { from: string; to: string };
    lastError: string | null;    // surfaced as a toast/banner, never a crash
  };

  // ---- actions (Section 3) ----
  // ...
}
```

### Initial state

- `rawSensors` seeded from `data/rawSensors.ts`.
- `topology`, `timeSeries`, `anomalies` start as seed fallbacks **off** (empty / null) so the user explicitly clicks **Start Analysis** — except when `demoMode` is true, where seeds are preloaded (Spec 06).
- `decisionMemory` empty by default; **preloaded with the June-15 decision when Demo Mode is on** (Spec 06).
- `settings` resolved from `import.meta.env` defaults (Spec 05 §Key resolution).

## 2. Selectors (avoid over-rendering)

Components subscribe narrowly:

```ts
const anomalies = useAppStore(s => s.anomalies);
const provider  = useAppStore(s => s.settings.provider);
```

Derived data (KPIs) is computed in a selector/helper, not stored:

```ts
const impact = useAppStore(s => computeImpact(s.anomalies, s.decisionMemory));
```

`computeImpact` lives in `src/lib/impact.ts` (Spec 04 §Top Bar).

## 3. Actions

### Analysis lifecycle

```ts
startAnalysis(): Promise<void>
```
Orchestrates the decision cycle (Spec 01 §3):
1. set `ui.analysisRunning = true`, `analysisStage = 'understanding'`.
2. If `demoMode` → load seed topology/timeSeries/anomalies synchronously, skip network (Spec 06). Else:
   - `topology = await runUnderstandingAgent(rawSensors, provider)` (fallback → `seedTopology`).
   - `analysisStage = 'anomaly'`.
   - `timeSeries` ensured present (seed if empty).
   - `anomalies = await runAnomalyAgent(topology, timeSeries, provider)` (fallback → `seedAnomalies`).
3. Normalize anomalies: clamp scores, drop dangling node refs, set `status = 'open'` (Spec 02 §10).
4. `analysisStage = 'done'`, `analysisRunning = false`. On any throw → set `ui.lastError`, fall back to seeds, never crash.

### The action loop

```ts
explainAnomaly(anomalyId: string): Promise<void>
```
- Sets `anomaly.isExplaining = true`.
- Runs `runMemoryAgent(anomaly, decisionMemory, provider)` → `MemoryRecall`.
- Stores result on `anomaly.explanation`; expands the card if `isRelated`.
- Fallback on error → `{ isRelated: false }` (no crash). In Demo Mode → deterministic recall of the June-15 decision (Spec 06).

```ts
acceptAnomaly(anomalyId: string): void
overrideAnomaly(anomalyId: string, rationale: string): void
dismissAnomaly(anomalyId: string, rationale: string): void
```
- `accept` → status `'accepted'`; appends a `DecisionMemory` with `actionTaken='accept'`, `humanRationale` = `''` allowed (accept doesn't force a rationale per brief, but we still log the action).
- `override` / `dismiss` → **rationale required** (non-empty, trimmed). Sets status `'overridden'`/`'dismissed'`, appends a `DecisionMemory` entry with the captured rationale.
- All three append to `decisionMemory` so the next cycle's Agent 3 sees them. Each entry denormalizes the anomaly snapshot (Spec 02 §4).

> **Rationale enforcement is in the action, not just the UI.** `override`/`dismiss` throw / no-op on empty rationale, so even programmatic callers can't bypass it.

### Settings

```ts
openSettings() / closeSettings(): void
setProvider(id: ProviderId): void                 // runtime backend switch
setProviderConfig(id: ProviderId, cfg: Partial<ProviderConfig>): void
toggleDemoMode(): void                             // see Spec 06 for side effects
```

Switching provider takes effect immediately for the **next** agent call — `providerRegistry` reads `settings` fresh each call (Spec 05), so no re-instantiation dance is needed.

### State IO

```ts
exportState(): void          // triggers a JSON file download
importState(file: File): Promise<void>
resetState(): void           // back to initial (with confirm in UI)
```

## 4. Export / Import (the demo-critical feature)

Implemented in `src/store/stateIO.ts`, called by the store actions.

### Export

```ts
function toPersisted(s: AppState): PersistedState {
  return {
    version: 1,
    exportedAt: nowIso(),
    rawSensors: s.rawSensors,
    topology: s.topology,
    timeSeries: s.timeSeries,
    anomalies: s.anomalies,
    decisionMemory: s.decisionMemory,
    settings: stripSecrets(s.settings),   // see below
  };
}
```

- `stripSecrets` blanks every `providers[*].apiKey` to `''` by default so exported demo files never leak keys. (A "include keys" checkbox in the export UI is optional; default OFF.)
- Serialize with `JSON.stringify(persisted, null, 2)` for human-editable demo files.
- Download via a Blob + temporary `<a download>`; filename `energyops-state-<exportedAt>.json`.

### Import

```ts
async function importState(file: File) {
  const text = await file.text();
  const parsed = JSON.parse(text) as PersistedState;     // wrapped in try/catch
  validatePersisted(parsed);                              // version + shape check
  // replace domain slices; MERGE settings so the user's pasted API key survives
  set({
    rawSensors, topology, timeSeries, anomalies, decisionMemory,
    settings: mergeSettings(current.settings, parsed.settings),
  });
}
```

- On malformed JSON or version mismatch → set `ui.lastError`, keep current state (never wipe to a broken state).
- **Settings merge:** imported settings provide `provider`/`model`/`demoMode`, but API keys from the imported file (blanked on export) must **not** clobber a key the user already pasted this session → merge, preferring a non-empty existing key.
- Re-normalize anomalies/refs on import (same as `startAnalysis` step 3) so hand-edited demo files can't break invariants.

### Demo scenario files

Two checked-in JSON files (generated from seeds, see Spec 06) live in the repo for the pitch:

- `demo/day-1.json` — fresh anomalies, empty/short `decisionMemory`.
- `demo/day-14.json` — same anomaly recurs, `decisionMemory` contains the June-15 override so Agent 3 recalls it.

The stage flow: load Day 1, walk the loop, **Export**; then **Import** Day 14 to show compounding recall. Demo Mode (Spec 06) is the zero-dependency fallback if anything goes wrong live.

## 5. Persistence (optional, low-risk)

Optionally wrap the store with Zustand `persist` middleware (localStorage) keyed `energyops-v1`, persisting **only** domain slices + non-secret settings (same `stripSecrets`). This survives refreshes during the demo. Keep it optional and behind the same `PersistedState` projection so it can't diverge from Export/Import.

## 6. Concurrency & Guards

- `startAnalysis` is a no-op if `ui.analysisRunning` is already true (button disabled too).
- `explainAnomaly` is idempotent per anomaly while `isExplaining` is true.
- All async actions set/clear their loading flags in `finally` so a thrown agent error never leaves a stuck spinner.
