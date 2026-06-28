// Human-friendly names for the agent's tools, shared by the chat feed and the
// analyzing overlay so both read the same way.

export const TOOL_LABELS: Record<string, string> = {
  mcp__eo__describe_dataset: 'Reading the dataset',
  mcp__eo__query_data: 'Querying the data',
  mcp__eo__scan_anomalies: 'Scanning for anomalies',
  mcp__eo__scan_data_quality: 'Checking data quality',
  mcp__eo__get_topology: 'Mapping the topology',
  mcp__eo__get_neighbors: 'Tracing the flow',
  mcp__eo__get_annotations: 'Recalling operator notes',
  mcp__eo__render_topology: 'Drawing the system',
  mcp__eo__render_chart: 'Plotting a chart',
  mcp__eo__render_chart_from_query: 'Plotting a chart',
  mcp__eo__render_state_summary: 'Summarising state',
  mcp__eo__render_data_quality: 'Flagging data issues',
  mcp__eo__render_insight_card: 'Forming an insight',
  mcp__eo__set_annotation: 'Saving a note',
  mcp__eo__remove_widget: 'Removing a widget'
};

export const AGENT_TOOLS = [
  {
    name: 'mcp__eo__describe_dataset',
    group: 'Discovery',
    purpose: 'Inspect tables, columns, row counts, time ranges, and topology diagrams.'
  },
  {
    name: 'mcp__eo__query_data',
    group: 'Discovery',
    purpose: 'Run capped read-only DuckDB SQL for inspection, aggregation, and ranking.'
  },
  {
    name: 'mcp__eo__scan_anomalies',
    group: 'Discovery',
    purpose: 'Rank unusual behavior across sensors and time ranges without scenario hints.'
  },
  {
    name: 'mcp__eo__scan_data_quality',
    group: 'Discovery',
    purpose: 'Find gaps, stale sensors, and other signal-quality issues.'
  },
  {
    name: 'mcp__eo__get_topology',
    group: 'Topology',
    purpose: 'Load dataset topology diagrams with nodes, edges, positions, and metadata.'
  },
  {
    name: 'mcp__eo__get_neighbors',
    group: 'Topology',
    purpose: 'Trace upstream and downstream neighbors around a selected topology node.'
  },
  {
    name: 'mcp__eo__render_topology',
    group: 'Workspace',
    purpose: 'Draw a full or focused topology graph in the workspace.'
  },
  {
    name: 'mcp__eo__render_chart',
    group: 'Workspace',
    purpose: 'Render a chart from values the agent already has in context.'
  },
  {
    name: 'mcp__eo__render_chart_from_query',
    group: 'Workspace',
    purpose: 'Run SQL server-side and plot longer series without returning all rows to the agent.'
  },
  {
    name: 'mcp__eo__render_state_summary',
    group: 'Workspace',
    purpose: 'Create a current operating snapshot with verdicts, grouped values, and context.'
  },
  {
    name: 'mcp__eo__render_data_quality',
    group: 'Workspace',
    purpose: 'Show data-quality findings as an operator-facing panel.'
  },
  {
    name: 'mcp__eo__render_insight_card',
    group: 'Workspace',
    purpose: 'Create a reviewable operational insight with evidence, actions, and optional chart.'
  },
  {
    name: 'mcp__eo__remove_widget',
    group: 'Workspace',
    purpose: 'Remove one workspace widget or clear the workspace.'
  },
  {
    name: 'mcp__eo__get_annotations',
    group: 'Memory',
    purpose: 'Read operator-supplied descriptions pinned to dataset entities.',
    conditional: 'Available when previous knowledge is enabled.'
  },
  {
    name: 'mcp__eo__set_annotation',
    group: 'Memory',
    purpose: 'Pin or update durable operator descriptions on sensors, nodes, widgets, or datasets.',
    conditional: 'Available when previous knowledge is enabled.'
  }
];

/** A readable label for a tool, falling back to a de-prefixed, spaced name. */
export const labelFor = (name: string): string =>
  TOOL_LABELS[name] ?? name.replace(/^mcp__eo__/, '').replace(/_/g, ' ');
