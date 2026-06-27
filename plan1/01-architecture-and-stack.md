# Spec 01: Architecture & Stack

## 1. Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Build tool | **Vite** | Fast dev server, `import.meta.env` for env vars. |
| Language | **TypeScript** | All data structures are typed (see `02-data-models.md`). |
| UI | **React 18** | Function components + hooks. |
| Styling | **Tailwind CSS** | Utility-first; the confidence badges rely on distinct color tokens. |
| Graph | **ReactFlow** (`reactflow`) | Topology canvas with custom "Rich Nodes". |
| State | **Zustand** | Single store, simple actions, easy JSON snapshot for Export/Import. |
| Charts | **Recharts** (sparklines) | Tiny `<LineChart>` inside each node. Lightweight; alternatively a hand-rolled SVG sparkline (see `04`). |
| LLM SDKs | **`@anthropic-ai/sdk`** (default), **`openai`** (optional) | Both called from the browser with the explicit browser-escape flag. See `05`. |
| Icons | **lucide-react** | Gear icon, badges, buttons. |

> **Why Zustand over Context:** the brief allows either. Zustand gives us a single `getState()` snapshot that maps 1:1 to the Export JSON, and selective subscriptions so the ReactFlow canvas doesn't re-render on every keystroke in a rationale textarea.

## 2. Project Structure

```
energyops-copilot/
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
├── .env.example                  # documents VITE_* vars; never commit real keys
├── specs/                        # this planning directory
└── src/
    ├── main.tsx
    ├── App.tsx                   # 3-panel layout shell + Top Bar
    ├── index.css                 # Tailwind directives + badge color tokens
    │
    ├── types/
    │   └── index.ts              # all TypeScript interfaces (Spec 02)
    │
    ├── store/
    │   ├── useAppStore.ts        # Zustand store + actions (Spec 03)
    │   └── stateIO.ts            # export/import JSON helpers (Spec 03)
    │
    ├── ai/
    │   ├── providers/
    │   │   ├── types.ts          # LLMProvider interface (Spec 05)
    │   │   ├── anthropic.ts      # Claude provider
    │   │   ├── openai.ts         # OpenAI provider
    │   │   └── demo.ts           # Demo/echo provider (no network)
    │   ├── providerRegistry.ts   # selects provider from settings at runtime
    │   ├── prompts.ts            # buildAgent1/2/3Prompt() (Spec 05)
    │   ├── agents.ts             # runUnderstandingAgent / runAnomalyAgent / runMemoryAgent
    │   └── extractJSON.ts        # robust JSON extraction + fallback (Spec 05)
    │
    ├── data/
    │   ├── rawSensors.ts         # dummy 2,000-ish raw sensors (Spec 06)
    │   ├── seedTopology.ts       # fallback simplified topology (Spec 06)
    │   ├── seedTimeSeries.ts     # dummy time-series per node (Spec 06)
    │   ├── seedAnomalies.ts      # fallback anomalies incl. demo anomaly (Spec 06)
    │   └── demoMemory.ts         # hardcoded June-15 decision (Spec 06)
    │
    ├── components/
    │   ├── layout/
    │   │   ├── LeftPanel.tsx
    │   │   ├── CenterPanel.tsx
    │   │   ├── RightPanel.tsx
    │   │   └── TopBar.tsx
    │   ├── config/
    │   │   ├── DataSourceSelector.tsx
    │   │   ├── DateRangePicker.tsx
    │   │   ├── DemoModeToggle.tsx
    │   │   ├── StateIOButtons.tsx     # Import / Export
    │   │   └── SettingsModal.tsx      # gear icon → API key + provider
    │   ├── topology/
    │   │   ├── TopologyCanvas.tsx     # ReactFlow wrapper
    │   │   ├── RichNode.tsx           # custom node: name + status + sparkline
    │   │   └── Sparkline.tsx
    │   ├── insights/
    │   │   ├── AnomalyList.tsx
    │   │   ├── AnomalyCard.tsx        # the heart of the action loop
    │   │   ├── ConfidenceBadge.tsx    # CRITICAL UI
    │   │   └── RationaleForm.tsx      # required textarea on Modify/Dismiss
    │   └── kpi/
    │       └── ImpactKPIs.tsx
    │
    └── lib/
        ├── ids.ts                # id() helper (no Math.random in critical paths if avoidable)
        └── impact.ts             # CO2/€ estimation from resolved anomalies
```

## 3. Data Flow

```
                    ┌─────────────────────────────────────────────┐
                    │                Zustand store                 │
                    │  rawSensors  topology  timeSeries            │
                    │  anomalies   decisionMemory  settings  ui    │
                    └───────▲───────────────┬─────────────────────┘
                            │               │
           (writes)        │               │ (reads, selectors)
                            │               ▼
   ┌───────────┐     ┌──────┴───────┐   ┌──────────────────────────────┐
   │ AI agents │────▶│   actions    │   │  UI components (3 panels)     │
   │ 1 / 2 / 3 │     │  in store    │   │  Left · Center · Right · Top  │
   └─────▲─────┘     └──────────────┘   └───────────────┬──────────────┘
         │                                               │
         │  buildPrompt(state) → provider.complete() ────┘ (user clicks)
         │                                  │
         │                                  ▼
         │                         ┌──────────────────┐
         └─────────────────────────│ providerRegistry │ → Anthropic | OpenAI | Demo
            extractJSON(response)  └──────────────────┘
```

### Decision-cycle sequence (the core loop)

1. **Start Analysis** (Left Panel) →
   - Agent 1 simplifies `rawSensors` → `topology` (or seed fallback).
   - Agent 2 reads `topology` + `timeSeries` → `anomalies`.
2. Anomalies render in the Right Panel with confidence badges.
3. Operator clicks **Explain (AI)** on a card → Agent 3 runs **for that one anomaly** against the **entire `decisionMemory`**.
   - If related, the card expands: *"Related to previous incident. Past human rationale: …"*.
4. Operator clicks **Accept / Modify / Dismiss**. Modify/Dismiss require a rationale → a new `DecisionMemory` entry is appended.
5. Resolved anomalies feed the **Impact KPIs**.
6. Next cycle (or after Import of "Day 14" state), Agent 3 now has richer memory → better recall.

## 4. Build & Run

```bash
npm install
cp .env.example .env        # optional: paste VITE_ANTHROPIC_API_KEY / VITE_OPENAI_API_KEY
npm run dev                 # Vite dev server
npm run build && npm run preview
```

The app must run **with no `.env`** — keys can be pasted at runtime via the Settings modal, and with no key it operates in Demo/fallback mode.

## 5. Environment Variables (`.env.example`)

```
# All optional — the Settings modal can supply these at runtime.
VITE_LLM_PROVIDER=anthropic          # anthropic | openai | demo
VITE_ANTHROPIC_API_KEY=
VITE_ANTHROPIC_MODEL=claude-opus-4-8
VITE_OPENAI_API_KEY=
VITE_OPENAI_MODEL=gpt-4o
```

See `05-ai-agents-and-providers.md` for how these resolve at runtime and the browser-key caveat.

## 6. Cross-Cutting Principles

- **Never crash on AI output.** Every agent call goes through `extractJSON` with a try/catch and a deterministic seed-data fallback (Spec 05/06).
- **State is the single source of truth.** Anything shown on screen or sent to an agent is derived from the Zustand store, so Export/Import is lossless.
- **AI backend is swappable at runtime.** UI and agents never import a concrete SDK directly — they go through `providerRegistry` → `LLMProvider` (Spec 05).
- **Determinism for the demo.** Demo Mode bypasses the network entirely (Spec 06), and we avoid `Math.random()` in any path that must be reproducible across Export/Import.
