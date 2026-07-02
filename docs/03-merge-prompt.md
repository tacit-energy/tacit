# Two EnergyOps Copilots — Architecture & UI Comparison

Two independent takes on the same brief exist in `hackathon/`:

- **`all-in-one/`** (Alexander Melde) — a polished, client-only **dashboard**: fixed 3-panel
  layout, three one-shot LLM prompts, seed data, a tight decision-memory loop.
- **`frontend/`** (ours) — a client **+ server** **agentic** app: a real
  Claude Agent SDK tool-loop over live DuckDB data, a chat + dynamic widget workspace,
  multi-dataset / multi-session / resumable.

They are less "two versions of the same thing" than **two different bets** — a reliable
demo-grade dashboard vs. an open-ended, real-data exploration engine. They're largely
complementary.

---

## TL;DR

| | **all-in-one** (theirs) | **energyops-copilot** (ours) |
|---|---|---|
| Shape | 100% client-side SPA | Client + Hono backend |
| LLM access | Browser-direct API keys (Anthropic/OpenAI/Demo, `dangerouslyAllowBrowser`) | Server-side subscription OAuth token (no key in browser) |
| "Agents" | 3 stateless **one-shot prompts** returning JSON | One **agentic tool-loop** (the model picks actions) |
| Data | Static seed JS arrays, **no DB** | **DuckDB SQL** over CSVs, dataset-agnostic |
| UI | Fixed **3-panel dashboard** (controls · topology · incidents) | **Chat + streaming widget workspace** |
| Topology | One ReactFlow canvas, fixed per run | Agent-rendered, full **or** simplified, multi-diagram |
| Incidents | First-class **right rail**, cross-panel linked | Insight **cards** in the widget feed |
| Decision memory | **Done & polished** (Accept/Override/Dismiss + recall) | Storage in place; loop UI in progress (P3) |
| Persistence | In-memory + manual JSON export/import | SQLite + SDK transcript **resume** |
| Multi-dataset/session | No (single, cosmetic data-source dropdown) | Yes (registry, sessions, resume) |

---

## 1. The defining difference: pipeline vs. agent

**Theirs — three one-shot prompts, orchestrated imperatively.** `ai/agents.ts` exposes three
stateless functions, each a single `provider.complete()` call that returns text the app
JSON-parses (`extractJSON.ts`). No tool calling, no loop, no follow-ups:

1. `runUnderstandingAgent(rawSensors)` → a `TopologyData` graph,
2. `runAnomalyAgent(topology, timeSeries, range, focusHint)` → `AnomalyData[]`,
3. `runMemoryAgent(anomaly, decisionMemory)` → a recall verdict (fired lazily per anomaly).

The store drives the sequence (`startAnalysis`: Agent 1 → Agent 2). Every agent **falls back to
seed data on any error**, so the demo never breaks. Predictable, cheap-ish, robust — but the model
can't *explore*; it's fed fixed inputs and must return fixed-shape outputs, and there's no
conversational "now check the pumps."

**Ours — one agentic conversation with tools.** A single streaming `query()` with an in-process
MCP toolset (`describe_dataset`, `query_data` = read-only SQL, `scan_anomalies`,
`get_topology`/`get_neighbors`, `render_*`, `set_annotation`). The agent decides what to look at,
**writes its own SQL**, and assembles arbitrary widgets; the operator can ask follow-ups and the
agent drills in. More open-ended and real, but less deterministic, needs guardrails, and costs more
tokens.

> This is the deepest fork: **a scripted analysis** vs. **an agent that investigates**.

## 2. Data: seed arrays vs. live SQL

- **Theirs** is fully static. `data/` holds deterministic generators and hardcoded seeds
  (`rawSensors` ~2,400 generated objects, `seedTopology` 7 nodes, `seedTimeSeries` with a planted
  pump-P3 spike, `seedAnomalies`, `demoMemory`). No SQL, no fetch. The **Data Source dropdown and
  date-range picker are cosmetic** — they don't change what's loaded (date range is only injected
  into the Agent 2 prompt text). Even in live mode the time-series fed to anomaly detection is always
  the seed.
- **Ours** loads real CSVs into **DuckDB** per dataset and lets the agent query them with arbitrary
  read-only SQL; `describe_dataset` reflects the actual schema; new datasets are auto-discovered by
  dropping a folder in `datasets/`. The anomaly scan even has a no-`expected_value` statistical
  fallback for real data.

Consequence: their demo is instant and unbreakable; ours is general and truthful to real data.

## 3. UI / layout (the thing you flagged)

**Theirs — a "single pane of glass" SCADA dashboard** (`App.tsx`: `TopBar` + 3-panel row):

- **Top bar:** brand + **Impact KPIs** (CO₂ saved / € saved / resolved count).
- **Left (300px):** controls — data-source, date-range, an **AI focus-hint** textarea,
  **Start Analysis**, settings, import/export, demo toggle.
- **Center (flex-1):** exactly **one** ReactFlow topology — `RichNode`s with status rings, a
  metric value + hand-rolled SVG **sparkline**; custom BFS layered layout.
- **Right (380px):** the **incident list** — `AnomalyCard`s with confidence badges and actions.

Everything is **spatially stable and always visible**. The newest commit
(`35c908d`, "bidirectional incident-topology linking") adds a `selectedAnomalyId` to the store and
makes the two output panels a **coordinated view of one state**: click an incident → its related
nodes get a sky highlight ring + "Selected" badge; click a node that has an open anomaly → that
incident selects. That cross-panel linking is the signature strength of the fixed layout — it turns
"a list" and "a graph" into one navigable model.

**Ours — conversational + a dynamic widget canvas.** A chat panel (left) drives a workspace (right)
into which the agent **streams typed widgets** (topology, charts, state summary, data-quality,
insight cards) over SSE. Far more flexible — the agent composes whatever views the question needs,
updates them in place (`replaceId`), removes them — but the workspace is a **scrolling feed of
cards**, not persistent linked panels. There's no fixed "incidents rail," and a widget isn't a
stable, selectable object tied to the topology.

> Theirs optimizes for **at-a-glance monitoring**; ours optimizes for **investigative dialogue**.

## 4. Incidents & the decision loop

This is where **theirs is materially ahead in finished UX**. Anomalies are first-class: each
`AnomalyCard` shows a `ConfidenceBadge` (rule-based vs AI-inferred), related-node chips, and an
action row — **Accept / Override / Dismiss**, the latter two requiring a typed **rationale**
(`RationaleForm`). Each resolution flips status **and appends a `DecisionMemory` record** (with a
denormalized anomaly snapshot). **Explain (AI)** then runs Agent 3 to recall whether a past decision
matches, surfacing the prior rationale + suggested action. That's the full "learn from decisions"
loop, working today, including the offline pump-P3 → "June 15 maintenance override" recall.

**Ours** has insight cards with Accept/Dismiss wired to the agent, dataset-scoped annotations, and
the SQLite tables, but the **record-decision / find-similar-precedent loop is still P3 (in
progress)**. We have the storage spine; they have the shipped loop.

## 5. Robustness, persistence, security

- **Robustness:** theirs degrades to seeds on every failure (great for a live demo); ours surfaces
  real tool errors and the agent self-corrects (great for real use, riskier on stage).
- **Persistence:** theirs is in-memory (refresh = reset) with **manual JSON export/import**
  (`stateIO.ts`, strips API keys); ours persists sessions in SQLite and **resumes** conversations via
  the SDK transcript.
- **Security:** theirs ships **API keys in the browser** (`dangerouslyAllowBrowser`, explicitly
  flagged as prototype-only); ours keeps the token server-side.

---

## 6. What each should borrow

**From them → us (high value):**
1. **Persistent, linked panels.** A stable topology pane + a standing **incidents/insights rail**
   with **cross-panel selection** (select an insight → highlight its nodes, and back). This is the
   single biggest UX win our chat+scroll-feed lacks. We could keep the agent driving content but pin
   the topology and an insights list as durable, selectable surfaces.
2. **An impact-KPI strip** (savings / resolved count) for instant "so what."
3. **The decision card UX** — Accept/Override/Dismiss + required rationale + recall — as the concrete
   target for our P3 loop.
4. The **demo-reliability mindset** (a deterministic offline path that always lands).

**From us → them:**
1. **Real data via SQL** instead of cosmetic data-source/date controls.
2. A genuine **agentic loop** so the operator can ask follow-ups and the model explores.
3. **Multi-dataset / multi-session / resume** and a backend that doesn't expose keys.

## 7. Recommendation

They're complementary halves: **their dashboard UX layer over our agentic + real-data backend.**
The convergence worth pursuing is to give our workspace a **"pinned" layout mode** — a persistent
topology + an incidents/insights rail with their cross-panel linking — while the agent keeps
populating and updating those surfaces from live DuckDB data. Keep the chat as the driver/console,
but stop treating every output as an ephemeral card. That gets us their scannable "single pane of
glass" without giving up our exploration, real data, or multi-dataset structure.
