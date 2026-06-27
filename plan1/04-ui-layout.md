# Spec 04: User Interface & Layout

A modern, responsive dashboard (Tailwind). Shell = **Top Bar** + **three panels**.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TOP BAR — EnergyOps Copilot · Impact: 🌱 X t CO₂ saved · 💶 €Y saved      │
├───────────────┬────────────────────────────────┬───────────────────────────┤
│  LEFT          │  CENTER                        │  RIGHT                     │
│  Config &      │  Topology (ReactFlow)          │  Insight & Action Loop    │
│  State         │  Rich nodes + sparklines       │  Anomaly cards            │
│                │                                │                           │
│  • Data source │   ┌─────┐      ┌─────┐         │  ┌──────────────────────┐ │
│  • Date range  │   │Chill│─────▶│ HX  │         │  │ Anomaly + badge      │ │
│  • Start       │   │ ⟂⟂⟂ │      │ ⟂⟂⟂ │         │  │ [Explain (AI)]       │ │
│  • Import      │   └─────┘      └─────┘         │  │ Accept|Modify|Dismiss│ │
│  • Export      │                                │  └──────────────────────┘ │
│  • Demo toggle │                                │  ...                      │
│  • ⚙ Settings  │                                │                           │
└───────────────┴────────────────────────────────┴───────────────────────────┘
```

Layout: `App.tsx` uses a CSS grid — `grid-cols-[320px_1fr_400px]` on large screens, collapsing to stacked panels under `lg`. Top Bar is a fixed-height header above the grid.

---

## 1. Top Bar — Impact KPIs

Component: `kpi/ImpactKPIs.tsx` inside `layout/TopBar.tsx`.

- Title/logo on the left.
- Right side: two pill widgets — **"X t CO₂ saved"** and **"€Y saved"** — plus a small "N anomalies resolved" counter.
- Values from `computeImpact(anomalies, decisionMemory)` (`src/lib/impact.ts`).

### Impact estimation (`src/lib/impact.ts`)

Heuristic, transparent, prototype-grade:

```ts
// Per resolved anomaly, attribute a savings based on confidence + action.
const BASE_KWH = 1200;                 // assumed avoidable energy per resolved event
const CO2_PER_KWH = 0.0004;            // tons CO2 per kWh (~0.4 kg/kWh)
const EUR_PER_KWH = 0.18;              // € per kWh

function impactForDecision(d: DecisionMemory): { co2: number; eur: number } {
  // accepted/overridden actions "save"; dismissed (false alarm) saves nothing.
  const factor = d.actionTaken === 'dismiss' ? 0 : 1;
  const kwh = BASE_KWH * factor;
  return { co2: kwh * CO2_PER_KWH, eur: kwh * EUR_PER_KWH };
}
```

`computeImpact` sums over `decisionMemory`, rounds CO₂ to 1 decimal and € to whole euros. The exact numbers are illustrative — the point is that resolving anomalies visibly moves the KPIs.

---

## 2. Left Panel — Configuration & State

Component: `layout/LeftPanel.tsx`. Vertically stacked cards:

1. **Data Source selector** (`config/DataSourceSelector.tsx`) — dropdown: `"Factory — Plant Room B"`, `"Campus District Heating"`, etc. (cosmetic for the prototype; selects which seed set to use; updates `ui.dataSource`).
2. **Date Range** (`config/DateRangePicker.tsx`) — two date inputs bound to `ui.dateRange`. Cosmetic/contextual; passed into Agent 2's prompt as the analysis window.
3. **Start Analysis** button — calls `startAnalysis()`. Disabled while `ui.analysisRunning`; shows a stage label ("Understanding topology…", "Detecting anomalies…").
4. **State row** (`config/StateIOButtons.tsx`) — **Import State** (`<input type=file>` hidden behind a button) and **Export State** (download). Optional "include API keys" checkbox (default off).
5. **Demo Mode toggle** (`config/DemoModeToggle.tsx`) — visually subtle ("hidden" per brief: small switch in the panel footer, or revealed via a keyboard shortcut / triple-click on the logo). Calls `toggleDemoMode()`. See Spec 06.
6. **⚙ Settings** — gear icon button opens `SettingsModal`.

### Settings Modal (`config/SettingsModal.tsx`)

- Opened via gear icon; backdrop + centered card; close on Esc / backdrop click.
- **Provider selector** (radio/segmented): `Anthropic (Claude)` · `OpenAI` · `Demo (offline)`. Bound to `settings.provider` via `setProvider`.
- Per-provider fields (show the active provider's fields, or all in an accordion):
  - **API key** (password input) → `setProviderConfig(id, { apiKey })`.
  - **Model** (text input with default placeholder, e.g. `claude-opus-4-8`, `gpt-4o`).
- A note: *"Keys are kept in browser memory only and are stripped from exported state."* (Spec 05 §Security.)
- A live status line: which provider is active, whether a key is present, and a **"Test connection"** button that fires a trivial prompt and shows ✅/❌.

---

## 3. Center Panel — Topology (System Understanding)

Component: `topology/TopologyCanvas.tsx` wrapping `<ReactFlow>`.

- Registers a custom node type `rich` → `topology/RichNode.tsx`.
- Maps `store.topology` → ReactFlow nodes/edges. Positions: if Agent 1 didn't return coordinates, apply a deterministic layered layout (`getLayoutedPositions(topology)` — simple left-to-right rank by edge depth, or a fixed grid). No `Math.random()` so the layout is stable across re-renders/imports.
- Controls: `<Background>`, `<Controls>`, fit-view on load. Pan/zoom enabled.
- Empty state (no topology yet): centered hint "Run analysis to build the system map."

### Rich Node (`topology/RichNode.tsx`)

Each node card shows:
- **Name** (bold) + a small **type** label/icon.
- **Status chip**: `ok` = green, `warning` = amber, `critical` = red. Border/glow tinted by status.
- **Sparkline** (`topology/Sparkline.tsx`) of that node's primary `TimeSeriesData.points`.
- Source/target handles for edges.
- If the node is referenced by an `open` anomaly, add a subtle pulsing ring to draw attention (ties the canvas to the right panel).

### Sparkline (`topology/Sparkline.tsx`)

- Tiny inline chart, ~120×32px. Either Recharts `<LineChart>` (no axes/legend) or a hand-rolled SVG `<polyline>` computed from min/max of `points`. Hand-rolled SVG is preferred to keep nodes cheap to render at scale.
- Color follows node status.

---

## 4. Right Panel — Insight & Action Loop

Component: `insights/AnomalyList.tsx` → scrollable column of `insights/AnomalyCard.tsx`. Sorted: `open` first, then by `confidenceScore` desc.

### Confidence Badge (`insights/ConfidenceBadge.tsx`) — CRITICAL UI

The product's signature visual. Two **highly contrasting** badge styles:

| `confidenceType` | Label | Style (Tailwind tokens) |
|---|---|---|
| `rule_based_data` | **Rule-based Data** | solid blue — `bg-blue-600 text-white` |
| `ai_inferred` | **Inferred from Past Decision** | vibrant orange — `bg-orange-500 text-white` |

- Badge also shows the numeric `confidenceScore` (e.g. a small `92%` pill or a thin progress bar).
- Use bold weight, rounded-full, clear iconography (e.g. a ruler icon for rule-based, a brain/history icon for inferred). The two must be unmistakable at a glance from across a room (it's a stage demo).
- Define the color tokens once in `index.css`/Tailwind config so they're consistent and themeable.

### Anomaly Card (`insights/AnomalyCard.tsx`)

Layout top→bottom:
1. **Header:** confidence badge + timestamp + related node names (chips).
2. **Description.**
3. **Explain (AI) button** — *not auto-run*. On click → `explainAnomaly(id)`; shows a spinner while `isExplaining`.
   - When `explanation.isRelated` → the card **expands** to a highlighted block:
     > *"🔁 Related to previous incident. Past human rationale: "{pastRationale}". Suggested action: {suggestedAction}."*
   - When `isRelated === false` → small muted note: *"No related past decision found."*
4. **Action Area** — three distinct buttons:
   - **[Accept AI Action]** → `acceptAnomaly(id)`.
   - **[Modify / Override]** → reveals `RationaleForm` (required) → `overrideAnomaly(id, rationale)`.
   - **[Dismiss Alert]** → reveals `RationaleForm` (required) → `dismissAnomaly(id, rationale)`.
5. **Resolved state:** once status ≠ `open`, the card collapses to a compact resolved row (status chip + action + truncated rationale), still visible for context and KPI traceability.

### Rationale Form (`insights/RationaleForm.tsx`)

- Appears inline when **Modify** or **Dismiss** is clicked.
- Label: **"Provide Rationale (Required)"**, a `<textarea>`, and a **Commit Decision** button.
- **Commit is disabled until the trimmed textarea is non-empty.** Attempting to commit empty shows inline validation. (The store action also enforces this — Spec 03 §3.)
- A Cancel link reverts the card to its action buttons without committing.

---

## 5. Global UX

- **Error surfacing:** `ui.lastError` renders as a dismissible banner/toast (top of the right panel), never an unhandled exception. Used for AI/parse/import failures and "falling back to demo data" notices.
- **Loading:** stage label on Start Analysis; per-card spinner on Explain; "Test connection" spinner in Settings.
- **Responsiveness:** panels stack vertically under `lg`; the topology canvas keeps a min-height so it's usable on a laptop projector.
- **Accessibility / demo legibility:** large fonts in Top Bar and badges; high-contrast status colors; focus states on all buttons. The demo is judged on a projector — favor size and contrast.
- **Theme:** light theme by default with a clean neutral background; the badge colors (blue/orange) and status colors (green/amber/red) are the only saturated accents so they pop.

## 6. Component → Action Map (quick reference)

| Component | Reads | Calls |
|---|---|---|
| `TopBar/ImpactKPIs` | `anomalies`, `decisionMemory` | — |
| `LeftPanel` | `ui`, `settings` | `startAnalysis`, `exportState`, `importState`, `toggleDemoMode`, `openSettings` |
| `SettingsModal` | `settings` | `setProvider`, `setProviderConfig`, test connection |
| `TopologyCanvas`/`RichNode` | `topology`, `timeSeries`, `anomalies` | — |
| `AnomalyCard` | one `anomaly` | `explainAnomaly`, `acceptAnomaly`, `overrideAnomaly`, `dismissAnomaly` |
| `RationaleForm` | local input | (passes rationale up to the card's override/dismiss) |
