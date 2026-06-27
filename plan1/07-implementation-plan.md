# Spec 07: Implementation Plan

Ordered, milestone-based build plan. Each milestone is independently runnable and has an acceptance check. Build in this order — later milestones depend on earlier ones.

> Read `00`–`06` first. This file sequences them into work.

---

## Milestone 0 — Scaffold

**Goal:** a blank Vite + React + TS + Tailwind app that boots.

- [ ] `npm create vite@latest energyops-copilot -- --template react-ts`
- [ ] Install deps: `zustand reactflow @anthropic-ai/sdk openai lucide-react recharts`
- [ ] Install + init Tailwind: `tailwindcss postcss autoprefixer`; configure `tailwind.config.js` `content` globs; add directives to `src/index.css`.
- [ ] Create folder structure per `01 §2`.
- [ ] Add `.env.example` (`01 §5`); ensure app reads `import.meta.env` and runs with no `.env`.

**Acceptance:** `npm run dev` shows a placeholder, zero console errors.

---

## Milestone 1 — Types & Store skeleton

**Goal:** typed state with no UI.

- [ ] `src/types/index.ts` — all interfaces from `02`.
- [ ] `src/store/useAppStore.ts` — state shape (`03 §1`), initial state from env, empty action stubs.
- [ ] `src/lib/ids.ts`, `src/lib/impact.ts` (`04 §1`).
- [ ] `src/store/stateIO.ts` — `toPersisted`, `stripSecrets`, `validatePersisted` (`03 §4`) (logic only).

**Acceptance:** store compiles; `useAppStore.getState()` returns a valid initial `AppState` in a console probe.

---

## Milestone 2 — Seed data & deterministic helpers

**Goal:** the app has data to render without any AI.

- [ ] `data/rawSensors.ts` (~2,000 deterministic sensors, `06 §1`).
- [ ] `data/seedTopology.ts`, `data/seedTimeSeries.ts`, `data/seedAnomalies.ts` (incl. `DEMO_ANOMALY`), `data/demoMemory.ts` (`JUNE_15_DECISION`).
- [ ] Layout helper `getLayoutedPositions(topology)` (deterministic, `04 §3`).

**Acceptance:** importing seeds in a test logs valid `TopologyData`/`AnomalyData`; no random/date calls (run the `06 §5` checklist).

---

## Milestone 3 — Three-panel shell + Top Bar

**Goal:** the dashboard layout renders with seed data wired read-only.

- [ ] `App.tsx` grid shell (`04` ASCII) + `layout/TopBar.tsx` + `kpi/ImpactKPIs.tsx`.
- [ ] `layout/LeftPanel.tsx` with DataSource, DateRange, Start (stub), Import/Export (stub), Demo toggle (stub), gear (stub).
- [ ] `layout/CenterPanel.tsx` + `layout/RightPanel.tsx` placeholders.

**Acceptance:** 3 panels + top bar render responsively; KPIs show 0; no crashes.

---

## Milestone 4 — Topology canvas (Center)

**Goal:** ReactFlow renders rich nodes with sparklines from seed topology.

- [ ] `topology/TopologyCanvas.tsx` — ReactFlow, custom `rich` node, fit-view, controls.
- [ ] `topology/RichNode.tsx` — name, type, status chip, sparkline, edge handles.
- [ ] `topology/Sparkline.tsx` — SVG polyline from `TimeSeriesData.points`.
- [ ] Temporarily preload seed topology/timeSeries to see it; empty-state hint when null.

**Acceptance:** seven nodes with colored statuses + sparklines, edges connected, pan/zoom works.

---

## Milestone 5 — Anomaly list, badges, action loop (Right)

**Goal:** the core interaction works against seed anomalies (no AI yet).

- [ ] `insights/ConfidenceBadge.tsx` — blue rule-based vs orange inferred, with score (`04 §ConfidenceBadge`). Define color tokens.
- [ ] `insights/AnomalyCard.tsx` — header, description, Explain (stub), three action buttons.
- [ ] `insights/RationaleForm.tsx` — required textarea, commit disabled until non-empty.
- [ ] `insights/AnomalyList.tsx` — sorted list, resolved-collapse.
- [ ] Store actions: `acceptAnomaly`, `overrideAnomaly`, `dismissAnomaly` (`03 §3`) incl. rationale enforcement + `DecisionMemory` append.

**Acceptance:** both badge styles visible; Modify/Dismiss force a rationale; committing appends to `decisionMemory` and updates Top Bar KPIs; resolved cards collapse.

---

## Milestone 6 — Provider abstraction & Settings

**Goal:** swappable AI backend, configurable at runtime.

- [ ] `ai/providers/types.ts`, `anthropic.ts`, `openai.ts`, `demo.ts` (`05 §1`).
- [ ] `ai/providerRegistry.ts` — `getProvider()` reads fresh settings (`05 §1`).
- [ ] Store actions `setProvider`, `setProviderConfig`, `openSettings/closeSettings`.
- [ ] `config/SettingsModal.tsx` — provider radio, key+model inputs, security note, **Test connection** (`04 §SettingsModal`, `05 §6`).
- [ ] Key resolution from env + runtime (`05 §2`).

**Acceptance:** can switch Anthropic↔OpenAI↔Demo in Settings; Test connection succeeds with a valid key on each; no concrete SDK imported outside `ai/providers/*`.

---

## Milestone 7 — Agents, prompts, robust parsing

**Goal:** real LLM calls drive analysis and explanation, with bulletproof fallback.

- [ ] `ai/extractJSON.ts` (`05 §5`) + unit tests for fenced/prose/array/object cases.
- [ ] `ai/prompts.ts` — `buildAgent1/2/3Prompt` (`05 §4`).
- [ ] `ai/agents.ts` — `runUnderstandingAgent`, `runAnomalyAgent`, `runMemoryAgent` with try/catch → seed fallback + normalize (`05 §3`, `02 §10`).
- [ ] Store `startAnalysis` (Agents 1→2, stages, fallback) and `explainAnomaly` (Agent 3) — `03 §3`.

**Acceptance:** with a real key, Start Analysis produces a topology + anomalies from the LLM; Explain (AI) recalls from memory; with a bad/empty key or garbage output, the app falls back to seeds and shows a non-fatal banner — never crashes.

---

## Milestone 8 — Import / Export

**Goal:** lossless state round-trip for the Day-1/Day-14 demo.

- [ ] Wire `exportState` (download, `stripSecrets`) and `importState` (parse, validate, settings-merge, re-normalize) — `03 §4`.
- [ ] Optional `persist` middleware (`03 §5`).
- [ ] Produce `demo/day-1.json` and `demo/day-14.json` (`06 §4`).

**Acceptance:** Export → reload → Import reproduces topology, anomalies, and `decisionMemory` exactly; imported settings don't clobber a pasted key; importing day-14 makes Agent 3 recall the prior override.

---

## Milestone 9 — Demo Mode

**Goal:** the bulletproof stage path.

- [ ] `config/DemoModeToggle.tsx` (subtle) + `toggleDemoMode` side effects (`06 §2`).
- [ ] Short-circuit agents in Demo Mode (seed returns, deterministic Agent 3 recall).
- [ ] Force `DEMO_ANOMALY` first; preload `JUNE_15_DECISION`.

**Acceptance:** Demo Mode ON → Start Analysis instant → Explain (AI) on `anomaly-pump-p3` expands with the exact June-15 rationale, no network. Run the `06 §3 Path A` script end-to-end.

---

## Milestone 10 — Polish & hardening

- [ ] Error banner/toast for `ui.lastError`; ensure every async path clears loading flags in `finally`.
- [ ] Loading/stage labels (Start, Explain spinner, Test connection).
- [ ] Projector legibility pass: badge contrast, font sizes, status colors (`04 §5`).
- [ ] README: run instructions, env vars, **browser API-key security caveat** (`05 §2`), demo script.
- [ ] Final determinism checklist (`06 §5`); confirm both Path A and Path B demos.

**Acceptance:** Definition of Done in `00 §7` fully met.

---

## Risk Register

| Risk | Mitigation |
|---|---|
| LLM returns non-JSON / markdown | `extractJSON` + per-agent seed fallback (`05 §5`, `05 §3`). |
| LLM latency stalls the live pitch | Demo Mode bypasses the network entirely (`06`). |
| Browser CORS / key issues with a provider | `dangerouslyAllowBrowser`; "Test connection" surfaces failures early; Demo fallback. |
| Big `rawSensors` payload bloats Agent 1 request | Pre-trim/aggregate sensors client-side before the prompt; cap `maxTokens`; seed fallback. |
| Exported file leaks API keys | `stripSecrets` on export by default (`03 §4`). |
| Dangling node refs from model output | `normalize()` drops invalid refs on ingest (`02 §10`). |
| Non-deterministic demo | No `Math.random()`/`new Date()` in demo paths (`06 §5`). |

## Suggested Build Order Summary

`0 Scaffold → 1 Types/Store → 2 Seeds → 3 Shell → 4 Topology → 5 Action loop → 6 Providers/Settings → 7 Agents → 8 Import/Export → 9 Demo Mode → 10 Polish`

Milestones 3–5 give a fully clickable UI on seed data (demo-able even before any AI is wired), de-risking the pitch early.
