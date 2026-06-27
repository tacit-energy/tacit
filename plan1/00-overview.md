# EnergyOps Copilot — Spec 00: Overview & Vision

> **Project codename:** EnergyOps Copilot
> **Context:** AI hackathon — "Decision Intelligence", motto *"Don't outsource the thinking."*
> **Source brief:** `../PROMPT.md`
> **Status:** Planning. This `specs/` directory is the authoritative build plan. Read `07-implementation-plan.md` last — it sequences everything.

---

## 1. The "Why"

Modern energy systems (factories, campuses, district heating) are monitored by thousands of IoT sensors. Pure AI anomaly detection fails because it lacks **real-world business context**:

- *"The cooling is off because of scheduled maintenance."*
- *"We're running a critical pharma batch — ignore energy prices."*

Operators override AI suggestions using experience, but that rationale evaporates when a shift ends or a senior operator retires (the **"Brain Drain"**).

## 2. The Product Thesis

EnergyOps Copilot puts the **human in the loop** and then **compounds** their judgment:

1. The system detects an anomaly.
2. The human takes an action and **explains why**.
3. The rationale is saved to a `DecisionMemory`.
4. In the next decision cycle (e.g. two weeks later), the AI **recalls** that historical human context and produces a better, contextualized recommendation.

This compounds institutional knowledge, raises energy efficiency / decarbonization, and lowers the entry barrier for junior operators.

The single most important visual idea in the product: **distinguishing rule-based confidence from confidence inferred from past human decisions.** That distinction is rendered as highly contrasting confidence badges and is the core of the demo.

## 3. What We Are Building

A **client-only React prototype** (no backend database) that:

- Visualizes a system topology with rich nodes + sparklines (ReactFlow).
- Lists detected anomalies with prominent **confidence badges**.
- Provides an explicit **"Explain (AI)"** button per anomaly (the Memory Agent is never called automatically).
- Forces the operator to enter a **rationale** when they Modify or Dismiss — capturing it into `DecisionMemory`.
- Shows **Impact KPIs** (CO₂ / € saved) at the top.
- Supports **Export / Import State** as JSON to stage "Day 1" vs "Day 14" demo scenarios.
- Calls real LLMs via a **swappable AI backend** (Claude default, OpenAI optional), with a runtime **Settings** modal for API keys.
- Has a **Demo Mode** safety fallback that guarantees the learning loop fires on stage without LLM latency/parsing risk.

## 4. Non-Goals (Prototype Scope)

- No backend, no database, no auth, no multi-user sync. State lives in the browser and is portable via JSON.
- No real IoT ingestion — we ship dummy raw-sensor + time-series datasets.
- No production-grade security for API keys (they live in browser memory / `.env`). This is explicitly a prototype; see `05-ai-agents-and-providers.md` §Security.
- Not a polished design system — Tailwind utility classes, clean but minimal.

## 5. The Three AI Agents (at a glance)

| Agent | Role | Input | Output |
|---|---|---|---|
| **Agent 1 — Understanding** | Topology simplifier | Raw 2,000-sensor JSON | ReactFlow `{nodes, edges}` |
| **Agent 2 — Anomaly** | Anomaly detector | Simplified topology + recent time-series | `AnomalyData[]` with `confidenceScore` + `confidenceType` |
| **Agent 3 — Compounding Memory** | The core innovation | One anomaly + entire `DecisionMemory` | `{isRelated, pastRationale, suggestedAction}` |

Full prompts, provider abstraction, and robust JSON parsing in `05-ai-agents-and-providers.md`.

## 6. Spec Map

| File | Contents |
|---|---|
| `00-overview.md` | This document — vision, scope, agent summary. |
| `01-architecture-and-stack.md` | Tech stack, project structure, data flow, build/run. |
| `02-data-models.md` | TypeScript types for every data structure. |
| `03-state-management.md` | Zustand store, actions, Import/Export, persistence. |
| `04-ui-layout.md` | Three-panel layout + Top Bar, every component, interaction flows. |
| `05-ai-agents-and-providers.md` | Provider abstraction, prompts, `extractJSON`, API key handling. |
| `06-demo-mode-and-seed-data.md` | Demo Mode behavior + hardcoded seed datasets and scenarios. |
| `07-implementation-plan.md` | Ordered, checklist-driven build plan with milestones & acceptance. |

## 7. Definition of Done (Prototype)

- `npm run dev` boots a 3-panel dashboard with seed data, no console errors.
- Operator can run analysis, see anomalies with contrasting confidence badges, click **Explain (AI)**, and complete the Accept / Modify / Dismiss loop (rationale enforced).
- Decisions persist in state and visibly feed Agent 3 on the next cycle.
- Top-bar KPIs update from resolved anomalies.
- Export → reload → Import round-trips the full state.
- Demo Mode ON guarantees the June-15 maintenance recall scenario fires deterministically.
- AI backend can be switched between Claude and OpenAI at runtime via Settings; with no key or on parse failure, the app falls back to demo data and never crashes.
