# EnergyOps Copilot — Build Plan

A topology-aware AI copilot for operators of complex energy systems. Self-contained
prototype. The agent explores sensor data and
topology freely, assembles **widgets** that make the system understandable, surfaces
**insights**, and **learns from operator decisions** over time.

See `EnergyOPS Context.md` for the product brief.

## Decisions locked

| Layer | Choice | Why |
|---|---|---|
| Server | **Hono** (TypeScript) | Lightweight modern framework; clean routes + SSE vs. raw `node:http`. |
| Agent runtime | **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) over subscription OAuth token | Proven in `spike-agent-sdk/ts`; streaming, tool-calls, widgets, no API key. |
| Agent structure | **One conversational agent** + a declared **`subsystem-analyst` subagent** for big sweeps | Simple to build/demo; subagent gives isolated context for scale (pillar #3). |
| Data access | Agent-driven **`query_data` (read-only SQL)** + topology helpers, **bounded responses** | Agent decides where to look — no pre-aggregation, misses nothing. |
| Data store | **DuckDB** over the CSVs | Reads CSVs directly (zero ETL), fast analytical aggregation, scales to ~2,000 sensors. |
| Memory store | **better-sqlite3** (`notes`, `decisions`) | Real SQL for "find similar past decisions" retrieval. |
| Widgets | Typed **SSE protocol** → React renderers | React Flow (topology), Recharts (charts), shadcn cards. |
| Frontend | **Vite + React + TS + Tailwind + shadcn/ui** | Self-contained, fast, clean component model. |

### Priorities (from product owner)
1. **Understanding + widgets** (baseline, must be excellent)
2. **Decision memory / learning** (the differentiator vs "chat with data")
3. **Scale to real data** (~2,000-sensor anonymized dataset, via subagent sweeps)

Refinement agent = nice-to-have (P4), only if time allows.

## Dataset-agnostic by design (hard constraint)

The sample is a stand-in. We will swap in a **real anonymized dataset** with ~2,000 sensors,
multiple concurrent events, missing/stale data, inconsistent units, and possibly no
`expected_value` at all. So **nothing scenario-specific may live in the prompt or tools:**

- **No planted knowledge in the system prompt.** It describes the *data structure* (the table
  schema below) and the *operator's goal* (understand the system, find what's unusual, explain it).
  It never mentions "north branch," a hero date, an expected anomaly, or how many events exist.
- **The agent discovers, we don't tell it.** Anomaly time, location, and root cause are *findings*,
  not inputs. The agent ranks deviations / data-quality issues across the whole range with generic
  tools and decides what's notable. Mark-bands, highlights, and insight text are derived from what
  it found — never hardcoded dates or sensor ids.
- **Tools are generic and schema-driven.** `describe_dataset` reflects whatever is actually loaded
  (which columns exist, whether `expected_value` is populated, real time range, sensor count). Tools
  must work when `expected_value` is absent (fall back to statistical baselines / peer comparison /
  data-quality signals) and degrade gracefully on gaps and stale streams.
- **Works on any dataset following our structure** (sensors + hourly values + attributes + topology),
  not just this one. Acceptance test for every tool: "would this still make sense on a different
  campus with different sensors and three overlapping faults?"

## Operator knowledge layers (three distinct stores)

The copilot accumulates operator knowledge in three deliberately separate forms:

1. **Annotations** — *descriptive, entity-attached.* Optional free-text the operator (or agent)
   pins to a **sensor, node, edge, subsystem, or the dataset as a whole**: "P3 is a summer-only
   backup pump," "this meter was recalibrated in March," "treat 900112 as derived, not measured."
   This is persistent *documentation* that enriches understanding. The agent **always loads relevant
   annotations** when reasoning about an entity, and `describe_dataset` / `get_topology` merge them in.
2. **Notes** — *contextual, event/time-oriented.* "Critical zone ran a cooling test this morning,"
   "switching to summer mode next week." Carried into subsequent analysis as memory.
3. **Decisions** — *choices + rationale + outcome,* linked to the sensor/topology state at the time,
   for precedent retrieval. The learning loop.

All three persist in the same SQLite file but in separate tables with different shapes and different
retrieval patterns. Annotations are the new addition vs. the earlier plan.

## Repository layout

```
energyops-copilot/
├─ server/
│  ├─ src/
│  │  ├─ index.ts            # Hono app: /events (SSE), /message, /permission, /interrupt
│  │  ├─ agent.ts            # Claude Agent SDK query() session + system prompt + agents{} (subagent)
│  │  ├─ bus.ts              # SSE broadcast + event history (ported from spike server.ts)
│  │  ├─ tools/
│  │  │  ├─ data.ts          # query_data, describe_dataset, get_topology, get_neighbors
│  │  │  ├─ widgets.ts       # render_topology / render_chart / render_state_summary /
│  │  │  │                   #   render_data_quality / render_insight_card / update_widget
│  │  │  ├─ memory.ts        # add_note, record_decision, find_similar_decisions, list_memory
│  │  │  └─ annotations.ts    # set_annotation, get_annotations (descriptive layer on entities)
│  │  ├─ db/
│  │  │  ├─ duck.ts          # DuckDB: load CSVs as views, run bounded read-only SQL
│  │  │  └─ memory.ts        # better-sqlite3: schema + queries for notes/decisions/annotations
│  │  └─ types.ts            # shared widget + event types (also imported by web via path alias)
│  ├─ data/ -> ../../energyops_copilot_sample_dataset   # symlink or configurable path
│  └─ package.json
└─ web/
   ├─ src/
   │  ├─ App.tsx             # layout: Chat panel (left) + Workspace canvas (right)
   │  ├─ lib/sse.ts          # EventSource client → typed events
   │  ├─ chat/               # streaming bubbles, tool-call cards, thinking, permission UI
   │  │                      #   (ported from spike public/index.html, componentized)
   │  ├─ widgets/
   │  │  ├─ TopologyWidget.tsx     # React Flow
   │  │  ├─ ChartWidget.tsx        # Recharts (actual / expected / deviation, mark bands)
   │  │  ├─ StateSummaryWidget.tsx # shadcn Card grid of KPIs
   │  │  ├─ DataQualityWidget.tsx  # gaps/stale/unit issues
   │  │  └─ InsightCard.tsx        # severity, evidence, recommendations, accept/reject → memory
   │  ├─ memory/             # operator note input + decision/precedent panel
   │  ├─ annotations/        # inline edit of node/sensor descriptions + dataset-level info panel
   │  └─ store.ts            # widget registry keyed by widget id (for updates/refinement)
   └─ package.json
```

## Widget protocol (the core contract)

Server → browser over SSE. Every widget carries a stable `id` so refinement can target it.
Defined once in `server/src/types.ts`, imported by both sides.

```ts
type ServerEvent =
  | { kind: 'sdk'; message: unknown }               // raw SDK message (stream/assistant/result)
  | { kind: 'widget'; widget: Widget }              // new widget
  | { kind: 'widget_update'; id: string; patch: Partial<Widget> }  // refinement (P4)
  | { kind: 'permission_request'; /* ...as spike... */ }
  | { kind: 'permission_resolved'; id: string; behavior: 'allow' | 'deny' }
  | { kind: 'error'; error: string };

type Widget =
  | { id: string; type: 'topology';      spec: TopologySpec }
  | { id: string; type: 'chart';         spec: ChartSpec }
  | { id: string; type: 'state_summary'; spec: StateSummarySpec }
  | { id: string; type: 'data_quality';  spec: DataQualitySpec }
  | { id: string; type: 'insight_card';  spec: InsightCardSpec };

type NodeStatus = 'ok' | 'warn' | 'alert' | 'stale' | 'inferred' | 'missing';

interface TopologySpec {
  title: string;
  nodes: { id: string; label: string; sensorId?: number; role?: string; branch?: string;
           group?: string; status?: NodeStatus; value?: number; unit?: string;
           annotation?: string }[];   // operator-added description, shown + editable on the node
  edges: { source: string; target: string; label?: string; emphasis?: boolean }[];
  highlight?: string[];          // node ids to spotlight
  collapsedGroups?: string[];    // group keys rendered as one node (simplification)
}

interface ChartSpec {
  title: string;
  x: string[];                                   // ISO timestamps
  series: { name: string; data: (number | null)[];
            role?: 'actual' | 'expected' | 'deviation' }[];
  unit?: string;
  markBands?: { from: string; to: string; label?: string }[];   // e.g. hero window
}

interface StateSummarySpec {
  title: string;
  items: { label: string; value: string | number; unit?: string;
           status?: NodeStatus; delta?: number }[];
}

interface DataQualitySpec {
  title: string;
  issues: { sensor: string; type: 'gap' | 'stale' | 'unit_mismatch' | 'inconsistent';
            severity: 'low' | 'med' | 'high'; detail: string }[];
}

interface InsightCardSpec {
  title: string;
  severity: 'info' | 'watch' | 'act';
  summary: string;
  evidence?: string[];
  recommendations?: string[];
  question?: string;                              // "have we seen this before?"
  relatedDecisions?: { id: string; summary: string }[];   // from memory
}
```

## Agent tools (in-process MCP server)

Exploration is **agent-driven and composable** — we provide primitives, the agent picks the queries.

All data tools are **schema-driven and scenario-blind** — none reference specific sensors, dates,
or the known anomaly. `query_data` is the general primitive; the rest are ergonomic wrappers over
common analytical patterns so the agent doesn't have to re-derive them, but they take the time range
and scope as *arguments the agent chooses* (defaulting to the full dataset), never hardcoded.

**Data (read-only, bounded):**
- `describe_dataset()` → tables/views, columns *actually present* and how populated (e.g. is
  `expected_value` non-null?), sensor catalog, real time range, row counts. Agent calls this first
  to learn the shape of *this* dataset. Fully dynamic — reflects whatever CSVs are loaded.
- `query_data(sql)` → read-only SQL on DuckDB over the loaded data. Hard `LIMIT`/row cap + timeout.
  The agent writes its own filters, aggregations, rankings. This is the escape hatch that keeps us
  flexible: any analysis we didn't pre-build, the agent expresses as SQL.
- `scan_anomalies({from?, to?, scope?, method?})` → generic ranking of "where is this dataset
  behaving unusually." Methods, used in order of what the data supports: (1) deviation from
  `expected_value`/`deviation_pct` *if present*; (2) statistical outliers vs each sensor's own rolling
  baseline (z-score); (3) divergence from peer sensors on the same role/branch. Returns a ranked
  shortlist of (sensor, window, magnitude, method) — **no scenario assumptions**, works on any range.
- `scan_data_quality({from?, to?, scope?})` → generic gaps, flatlines/stale streams, out-of-range
  values, unit inconsistencies. Real-data-first: this is expected to fire a lot on the real dataset.
- `get_topology(diagram_id?)` → nodes + edges graph (whatever topology ships with the dataset).
- `get_neighbors(node_id, depth, direction)` → upstream/downstream traversal for tracing flow.

**Widgets (push to UI):**
- `render_topology(spec)` / `render_chart(spec)` / `render_state_summary(spec)` / `render_data_quality(spec)` / `render_insight_card(spec)` — each returns the new widget `id`.
- `update_widget(id, patch)` — refinement (P4).

**Annotations (descriptive knowledge layer):**
- `set_annotation({target, text})` → pin/update a description on an entity. `target` =
  `{kind: 'sensor'|'node'|'edge'|'subsystem'|'dataset', id}`. Agent calls this when the operator
  states a fact about a component; the UI also writes directly (see below).
- `get_annotations({target?})` → annotations for an entity, a subsystem, or all. The agent calls this
  (or gets them merged into `describe_dataset`/`get_topology`) so its explanations reflect operator
  knowledge instead of re-guessing.

**Memory:**
- `add_note(text, context?)` → operator knowledge → SQLite.
- `record_decision({situation, choice, rationale, context})` → SQLite.
- `find_similar_decisions(context)` → retrieval (SQL filter on branch/anomaly type/sensors now; embeddings later).
- `list_memory()` → notes + decisions for the current session/subsystem.

**Subagent (declared in `agents{}`):**
- `subsystem-analyst` — `description` triggers it for big sweeps; `tools: ['mcp__data__query_data','mcp__data__describe_dataset','mcp__data__get_topology']` (read-only, no widget/memory tools). Runs in isolated context, returns a ranked summary of anomalies/notable sensors. Add `"Agent"` to `allowedTools` so the main agent can dispatch it.

## Hero demo script (rehearse this)

The sample happens to contain a planted event (`north_branch_spike`, 2026-06-24 05:00–08:00,
critical-zone-driven, south branch clean) — but **the agent is told none of that**. The demo works
because the agent *finds* it with generic tools. The same flow must hold when we swap the dataset.

1. App opens on the topology that ships with the dataset (React Flow from its diagram JSON).
2. Operator: *"Something feels off this week — help me understand what's going on."* (Deliberately
   vague: no branch, no date. The agent locates the problem itself.)
3. Agent calls `describe_dataset` → `scan_anomalies` (full range) → `get_neighbors` to trace flow
   around the top finding. Renders: simplified **topology** (the implicated nodes highlighted),
   **charts** (the flagged sensor vs its peer/expected, deviation, with the *discovered* window
   mark-banded — derived from the scan result, not hardcoded), a **state summary**.
4. Agent emits an **insight card** from its findings: *<sensor> rose ~X% above its expected/peer
   profile over <window it found>, driven by <upstream node it traced>; comparison branch normal →
   likely a real demand event, not a sensor fault. Check: …*
5. Operator note: *"Critical zone ran a server-room cooling test that morning."* → `add_note`.
6. Operator accepts the insight → `record_decision`. Next anomaly / re-ask →
   `find_similar_decisions` surfaces the prior note + decision → agent reasons differently.
7. (Stretch) Refinement: *"show only the north loop with return temps"* → `update_widget`.
8. (Stretch / scale) Point at the ~2,000-sensor dataset → *"scan the whole campus for anomalies"*
   → main agent dispatches `subsystem-analyst` → returns a ranked shortlist → renders the top finding.

## Phases

- **P0 — Scaffold & stream. ✅ DONE.** Monorepo; spike server ported → Hono (`/events`, `/message`,
  `/permission`, `/interrupt`) on :3460; Vite+React+Tailwind+shadcn-style shell on :5173 with dev
  proxy; chat streaming + tool cards + permission UI + widget pipeline (state_summary) verified
  end-to-end in the browser. Shared `types.ts` protocol imported by both sides via `@shared` alias.
- **P1 — Data + core widgets. ✅ DONE.** DuckDB layer auto-discovers every CSV as a view; agent-facing
  `query_data` is read-only + row-capped (trusted `raw` path for internal DESCRIBE). Tools:
  `describe_dataset` (dynamic schema + populated% + time range), `query_data`, `get_topology`,
  `get_neighbors`; annotations store (better-sqlite3) + `get_annotations`/`set_annotation`, merged onto
  topology nodes by sensorId. Widget tools `render_topology`/`render_chart`/`render_state_summary`.
  Web renderers: TopologyWidget (React Flow + dagre fallback, status colours, highlight, annotation
  badges) + ChartWidget (Recharts, actual/expected/deviation, mark-bands). **Browser-verified: from the
  vague prompt "something feels off this week," the agent discovered the system and the planted June-24
  anomaly with zero scenario hints, and rendered topology + charts + summary.**
- **P2 — Anomaly + insights (HERO).** `scan_anomalies`, `scan_data_quality`, `render_state_summary`,
  `render_data_quality`, `render_insight_card`. System prompt describes *structure + goal only* — no
  scenario hints. *Done = from the vague prompt in step 2, with zero scenario knowledge, the agent
  locates the event, explains it, and produces an insight card. Sanity check: temporarily point it at
  a hand-edited copy with a different injected anomaly and confirm it finds that one instead.*
- **P3 — Knowledge & decision memory.** SQLite schema; `add_note`, `record_decision`,
  `find_similar_decisions`, `set_annotation`; operator note input + accept/reject on insight cards +
  precedent panel; **inline annotation editing on nodes + a dataset-level info panel** (UI write path
  for the descriptive layer). *Done = steps 5–6 land, and an operator can pin a description to a
  component and the agent uses it next turn.*
- **P4 — Refinement (stretch).** `update_widget`; "edit this widget" affordance; topology group
  collapse/expand for simplification.
- **P5 — Scale.** Point DuckDB at the ~2,000-sensor anonymized dataset; declare `subsystem-analyst`
  subagent; subsystem selection; verify bounded responses keep main context clean. *Done = step 8 lands.*

## Workspace pillar — multi-dataset, resumable sessions (in progress)

Reshapes the app from a single ephemeral chat into a workspace product.

**Decisions:** sessions are **resumable** (SDK `resume: sessionId`; the SDK auto-persists
transcripts to `~/.claude/projects/<encoded-cwd>/<id>.jsonl`, so reopen-after-restart works
when cwd is stable). Datasets are **auto-discovered** from a `datasets/` folder (each subfolder
with `sensors.csv` = a dataset). Build order: **dataset home + switching first**, then sessions.

**Hierarchy:** Home (datasets grid + import-by-folder) → Dataset (tabs: Sessions · Topologies ·
Data) → Session (chat + workspace). Selecting a dataset shows a centered **"Start analysis"**
launcher: an optional prompt field + button (blank = general analysis) that creates a session.

**Entities (SQLite):** `sessions` (id, dataset_id, name, sdk_session_id, timestamps), `widgets`
per session; `dataset_id` added to annotations/notes/decisions. Datasets are discovered, not stored.

**Core refactor — SessionManager:** replace the one global `query()` + global tools + global
DuckDB with per-session agents. `createSession(datasetId, prompt?)` builds dataset-bound MCP tools,
starts `query()`, captures the SDK session id, gives the session its own SSE stream;
`resumeSession(id)` re-attaches with `resume:` and re-supplies that dataset's tools. Routes become
`/datasets`, `/datasets/:id/sessions`, `/sessions/:id/events|message`. Data/widget/annotation tools
become a per-session factory bound to the dataset + a session-local widget bus.

**Status:** ✅ dataset registry + `GET /datasets` + `datasets/cooling-sample`. ✅ **SessionManager** —
per-session agents (`Session` class: own streaming `query()`, own `Bus`, own permissions, dataset-bound
tool factory), resumable via SDK `resume` (sdk_session_id persisted). Per-dataset DuckDB/topology/scan;
annotations dataset-scoped; `sessions` table. Routes: `/datasets/:id/sessions`,
`/sessions/:id/{events,message,permission,interrupt,annotation(s)}`; legacy `/events|/message|…` bridged
to a default session so the current frontend keeps working. Verified end-to-end in-process. ✅ **Frontend
routing** — App view-router (home/dataset/session/settings); HomePage (datasets grid), DatasetPage (tabs:
Sessions + "Start analysis" launcher, Topologies, Data), SessionPage (chat+workspace via `useAgentStream(sessionId)`
on `/sessions/:id/*`); `WidgetFrame` annotations session-scoped; `GET /datasets/:id/{topologies,tables}` endpoints.

## Open items / decisions deferred
- Exact subagent model (`opus` for the sweep vs `inherit`) — tune in P5.
- Semantic (embedding) similarity for `find_similar_decisions` — only if keyword/SQL retrieval feels weak.
- Auth/session handling — single-session for the demo; multi-session only if needed.
