// Shared protocol between server and web. The web app imports these types so the
// widget contract stays in one place. Keep this file dependency-free (types only).

// ---------------------------------------------------------------------------
// Widgets — the structured views the agent assembles in the workspace
// ---------------------------------------------------------------------------

export type NodeStatus =
  | 'ok'
  | 'warn'
  | 'alert'
  | 'stale'
  | 'inferred'
  | 'missing';

export interface TopologySpec {
  title: string;
  nodes: {
    id: string;
    label: string;
    sensorId?: number;
    energyType?: string | null;
    role?: string;
    branch?: string;
    group?: string;
    status?: NodeStatus;
    value?: number;
    unit?: string;
    annotation?: string; // operator-added description, shown + editable on the node
    position?: { x: number; y: number }; // curated layout; web auto-lays-out if absent
  }[];
  edges: {
    source: string;
    target: string;
    label?: string;
    emphasis?: boolean;
    animated?: boolean;
  }[];
  highlight?: string[]; // node ids to spotlight
  collapsedGroups?: string[]; // group keys rendered as one node (simplification)
}

export type ChartType = 'line' | 'area' | 'bar' | 'scatter';

export interface ChartSpec {
  title: string;
  x: string[]; // x labels (ISO timestamps for time series, or categories for bar/scatter)
  series: {
    name: string;
    data: (number | null)[];
    role?: 'actual' | 'expected' | 'deviation';
    kind?: ChartType; // per-series form override (for mixed charts); falls back to chartType
    axis?: 'left' | 'right'; // dual-axis support
  }[];
  unit?: string;
  chartType?: ChartType; // default chart form (default: line)
  referenceLines?: { value: number; label?: string; axis?: 'left' | 'right' }[];
  markBands?: { from: string; to: string; label?: string }[];
}

export interface StateSummarySpec {
  title: string;
  items: {
    label: string;
    value: string | number;
    unit?: string;
    status?: NodeStatus;
    delta?: number;
  }[];
}

export interface DataQualitySpec {
  title: string;
  issues: {
    sensor: string;
    type: 'gap' | 'stale' | 'unit_mismatch' | 'inconsistent';
    severity: 'low' | 'med' | 'high';
    detail: string;
  }[];
}

export interface InsightCardSpec {
  title: string;
  severity: 'info' | 'watch' | 'act';
  summary: string;
  evidence?: string[];
  recommendations?: string[];
  question?: string;
  relatedDecisions?: { id: string; summary: string }[];
  relatedNodeIds?: string[]; // topology node ids this insight concerns (cross-panel linking)
  impact?: { value: number; unit?: string; confidence?: 'low' | 'med' | 'high' }; // grounded estimate only
  chart?: ChartSpec; // agent-curated chart embedded in the card (built server-side from SQL)
}

export type Widget =
  | { id: string; type: 'topology'; spec: TopologySpec }
  | { id: string; type: 'chart'; spec: ChartSpec }
  | { id: string; type: 'state_summary'; spec: StateSummarySpec }
  | { id: string; type: 'data_quality'; spec: DataQualitySpec }
  | { id: string; type: 'insight_card'; spec: InsightCardSpec };

export type WidgetType = Widget['type'];

// ---------------------------------------------------------------------------
// Server -> browser events (sent over SSE)
// ---------------------------------------------------------------------------

export interface PermissionRequest {
  kind: 'permission_request';
  id: string;
  toolName: string;
  input: unknown;
  suggestions: unknown[];
}

export type AgentEvent =
  | { type: 'meta'; provider: 'claude' | 'openrouter' | 'azure'; model?: string; sessionId?: string }
  | { type: 'user_message'; text: string }
  | { type: 'assistant_delta'; text: string }
  | { type: 'assistant_message'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; result: string; isError?: boolean }
  | { type: 'turn_complete'; duration_ms?: number; total_cost_usd?: number };

export type ServerEvent =
  | { kind: 'sdk'; message: unknown }
  | { kind: 'agent'; event: AgentEvent }
  | { kind: 'widget'; widget: Widget }
  | { kind: 'widget_update'; id: string; patch: Partial<Widget> }
  | { kind: 'widget_remove'; id: string } // id === 'all' clears the workspace
  | PermissionRequest
  | { kind: 'permission_resolved'; id: string; behavior: 'allow' | 'deny' }
  | { kind: 'credential_needed'; provider: 'openrouter' | 'azure'; message: string }
  | { kind: 'error'; error: string };
