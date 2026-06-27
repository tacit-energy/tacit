import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import {
  AlertTriangle,
  ArrowUpRight,
  Brain,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  GitBranch,
  Hospital,
  Search,
} from "lucide-react";
import { DeviationChart } from "./components/DeviationChart";
import { EnergyFlowNode, EnergyNode } from "./components/EnergyNode";
import { ChartRange, SensorChart } from "./components/SensorChart";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { TabsList, TabsTrigger } from "./components/ui/tabs";
import {
  energyData,
  getDashboardState,
  getSensorHistory,
  getSensorNeighbors,
  getSensorStateAt,
  SensorState,
  Status,
} from "./data/energyData";
import { formatHour, formatNumber, formatPercent } from "./lib/utils";

const nodeTypes: NodeTypes = {
  meterNode: EnergyNode,
};

const statusLabel: Record<Status, string> = {
  normal: "Normal",
  watch: "Watch",
  anomaly: "Anomaly",
};

const statusBadge: Record<Status, "success" | "warning" | "destructive"> = {
  normal: "success",
  watch: "warning",
  anomaly: "destructive",
};

function getDefaultTimestampIndex() {
  const target = `${energyData.manifest.hero_day}T06:00:00Z`;
  const index = energyData.timestamps.indexOf(target);
  return index >= 0 ? index : Math.floor(energyData.timestamps.length * 0.75);
}

function insightCopy(state: ReturnType<typeof getDashboardState>) {
  if (!state.worst) {
    return [];
  }

  const north = state.branchHealth.find((branch) => branch.branch === "north");
  const south = state.branchHealth.find((branch) => branch.branch === "south");

  return [
    `${state.worst.sensor.name} is the strongest signal at ${formatPercent(
      state.worst.reading.deviation_pct,
    )}.`,
    north && south
      ? `North branch max deviation is ${formatNumber(
          north.maxDeviation,
        )}%, while south is ${formatNumber(south.maxDeviation)}%.`
      : "Branch comparison is available after enough sensors report.",
    state.activeEvent
      ? "The active event aligns with the known north-branch spike window."
      : "No scenario event is active at this timestamp.",
  ];
}

function StatusDot({ status }: { status: Status }) {
  return <span className={`status-dot status-dot-${status}`} />;
}

function KpiCard({
  title,
  value,
  description,
  icon,
  tone = "neutral",
}: {
  title: string;
  value: string;
  description: string;
  icon: JSX.Element;
  tone?: "neutral" | "warning" | "danger" | "success";
}) {
  return (
    <Card className={`kpi-card kpi-${tone}`}>
      <CardHeader>
        <div className="kpi-icon">{icon}</div>
        <CardDescription>{title}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="kpi-value">{value}</div>
        <p className="kpi-description">{description}</p>
      </CardContent>
    </Card>
  );
}

function SensorListItem({
  state,
  active,
  onClick,
}: {
  state: SensorState;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`sensor-list-item ${active ? "is-active" : ""}`} onClick={onClick}>
      <span className="sensor-list-main">
        <span className="sensor-list-title">{state.sensor.name}</span>
        <span className="sensor-list-meta">
          {state.sensor.branch} · {state.sensor.role}
        </span>
      </span>
      <span className="sensor-list-side">
        <StatusDot status={state.status} />
        <span>{formatPercent(state.reading.deviation_pct)}</span>
      </span>
    </button>
  );
}

function App() {
  const [timestampIndex, setTimestampIndex] = useState(getDefaultTimestampIndex);
  const timestamp = energyData.timestamps[timestampIndex];
  const dashboardState = useMemo(() => getDashboardState(timestamp), [timestamp]);
  const [selectedSensorId, setSelectedSensorId] = useState(
    dashboardState.worst?.sensor.sensor_id ?? energyData.sensors[0].sensor_id,
  );
  const [detailTab, setDetailTab] = useState<"trace" | "context">("trace");
  const [chartRange, setChartRange] = useState<ChartRange>("day");
  const [operatorNote, setOperatorNote] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem("energyops.operatorNote");
    if (stored) {
      setOperatorNote(stored);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("energyops.operatorNote", operatorNote);
  }, [operatorNote]);

  const selectedState = getSensorStateAt(selectedSensorId, timestamp) ?? dashboardState.worst;
  const selectedHistory = selectedState ? getSensorHistory(selectedState.sensor.sensor_id) : [];
  const selectedNeighbors = selectedState ? getSensorNeighbors(selectedState.sensor.sensor_id) : [];
  const selectedNeighborStates = selectedNeighbors
    .map((node) => getSensorStateAt(node.data.sensor_id, timestamp))
    .filter(Boolean) as SensorState[];
  const insights = insightCopy(dashboardState);

  const nodeStatusById = new Map(
    energyData.topology.nodes.map((node) => [
      node.id,
      dashboardState.sensors.find((item) => item.sensor.sensor_id === node.data.sensor_id)?.status ??
        "normal",
    ]),
  );

  const nodes: EnergyFlowNode[] = energyData.topology.nodes.map((node) => {
    const state =
      getSensorStateAt(node.data.sensor_id, timestamp) ??
      dashboardState.sensors.find((item) => item.sensor.sensor_id === node.data.sensor_id);

    return {
      id: node.id,
      type: "meterNode",
      position: node.position,
      data: {
        state: state!,
        selected: selectedSensorId === node.data.sensor_id,
      },
    };
  });

  const edges: Edge[] = energyData.topology.edges.map((edge) => {
    const sourceStatus = nodeStatusById.get(edge.source);
    const targetStatus = nodeStatusById.get(edge.target);
    const edgeStatus = sourceStatus === "anomaly" || targetStatus === "anomaly" ? "anomaly" : sourceStatus === "watch" || targetStatus === "watch" ? "watch" : "normal";

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: edgeStatus === "anomaly",
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: edgeStatus === "anomaly" ? "#dc2626" : edgeStatus === "watch" ? "#d97706" : "#64748b",
      },
      style: {
        strokeWidth: edgeStatus === "anomaly" ? 2.8 : 1.7,
        stroke: edgeStatus === "anomaly" ? "#dc2626" : edgeStatus === "watch" ? "#d97706" : "#94a3b8",
      },
    };
  });

  const selectedStatus = selectedState?.status ?? "normal";

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-mark">
            <Hospital size={22} />
          </div>
          <div>
            <h1>EnergyOPS Cooling Trace</h1>
            <p>Hospital energy topology · {formatHour(timestamp)} UTC</p>
          </div>
        </div>
        <div className="header-actions">
          <div className="search-box">
            <Search size={16} />
            <span>Cooling loop, north branch</span>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setTimestampIndex(getDefaultTimestampIndex());
            }}
          >
            <CalendarClock size={16} />
            Incident Window
          </Button>
        </div>
      </header>

      <section className="kpi-grid">
        <KpiCard
          title="Active anomalies"
          value={String(dashboardState.anomalyCount)}
          description={`${dashboardState.watchCount} sensors on watch`}
          icon={<AlertTriangle size={18} />}
          tone={dashboardState.anomalyCount ? "danger" : "success"}
        />
        <KpiCard
          title="Worst deviation"
          value={dashboardState.worst ? formatPercent(dashboardState.worst.reading.deviation_pct) : "0%"}
          description={dashboardState.worst?.sensor.name ?? "No sensor selected"}
          icon={<ArrowUpRight size={18} />}
          tone={dashboardState.anomalyCount ? "warning" : "neutral"}
        />
        <KpiCard
          title="Likely root cause"
          value={energyData.manifest.root_cause_sensor}
          description={energyData.manifest.primary_affected_sensor}
          icon={<Brain size={18} />}
          tone="neutral"
        />
        <KpiCard
          title="Topology"
          value={`${energyData.topology.nodes.length} nodes`}
          description={`${energyData.topology.edges.length} directed relationships`}
          icon={<GitBranch size={18} />}
          tone="success"
        />
      </section>

      <section className="dashboard-grid">
        <aside className="overview-panel">
          <Card className="overview-section">
            <CardHeader>
              <CardTitle>All Sensors</CardTitle>
              <CardDescription>Ranked by absolute deviation</CardDescription>
            </CardHeader>
            <CardContent className="sensor-list">
              {dashboardState.sortedByDeviation.map((state) => (
                <SensorListItem
                  key={state.sensor.sensor_id}
                  state={state}
                  active={state.sensor.sensor_id === selectedSensorId}
                  onClick={() => setSelectedSensorId(state.sensor.sensor_id)}
                />
              ))}
            </CardContent>
          </Card>

          <Card className="overview-section">
            <CardHeader>
              <CardTitle>Branch Health</CardTitle>
              <CardDescription>Current max deviation by branch</CardDescription>
            </CardHeader>
            <CardContent className="branch-list">
              {dashboardState.branchHealth.map((branch) => (
                <div className="branch-row" key={branch.branch}>
                  <span>
                    <StatusDot status={branch.status as Status} />
                    {branch.branch}
                  </span>
                  <strong>{formatNumber(branch.maxDeviation)}%</strong>
                </div>
              ))}
            </CardContent>
          </Card>
        </aside>

        <Card className="flow-panel">
          <CardHeader className="flow-header">
            <div>
              <CardTitle>Cooling Topology</CardTitle>
              <CardDescription>{energyData.manifest.narrative}</CardDescription>
            </div>
            <Badge variant={dashboardState.activeEvent ? "destructive" : "success"}>
              {dashboardState.activeEvent || "nominal"}
            </Badge>
          </CardHeader>
          <CardContent className="flow-content">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              minZoom={0.38}
              maxZoom={1.25}
              onNodeClick={(_, node) => {
                const state = node.data.state as SensorState | undefined;
                if (state) {
                  setSelectedSensorId(state.sensor.sensor_id);
                }
              }}
            >
              <Background color="#cbd5e1" gap={22} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(node) => {
                  const state = (node.data?.state as SensorState | undefined)?.status ?? "normal";
                  return state === "anomaly" ? "#dc2626" : state === "watch" ? "#d97706" : "#0f766e";
                }}
              />
              <Controls />
            </ReactFlow>
          </CardContent>
        </Card>

        <aside className="detail-panel">
          {selectedState ? (
            <>
              <Card>
                <CardHeader>
                  <div className="detail-title-row">
                    <div>
                      <CardTitle>{selectedState.sensor.name}</CardTitle>
                      <CardDescription>
                        {selectedState.sensor.branch} · {selectedState.sensor.role} · sensor{" "}
                        {selectedState.sensor.sensor_id}
                      </CardDescription>
                    </div>
                    <Badge variant={statusBadge[selectedStatus]}>{statusLabel[selectedStatus]}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="detail-stats">
                    <div>
                      <span>Actual</span>
                      <strong>
                        {formatNumber(selectedState.reading.value)} {selectedState.sensor.unit}
                      </strong>
                    </div>
                    <div>
                      <span>Expected</span>
                      <strong>
                        {formatNumber(selectedState.reading.expected_value)} {selectedState.sensor.unit}
                      </strong>
                    </div>
                    <div>
                      <span>Deviation</span>
                      <strong>{formatPercent(selectedState.reading.deviation_pct)}</strong>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="detail-card">
                <CardHeader>
                  <TabsList>
                    <TabsTrigger active={detailTab === "trace"} onClick={() => setDetailTab("trace")}>
                      Trace
                    </TabsTrigger>
                    <TabsTrigger
                      active={detailTab === "context"}
                      onClick={() => setDetailTab("context")}
                    >
                      Context
                    </TabsTrigger>
                  </TabsList>
                </CardHeader>
                <CardContent>
                  {detailTab === "trace" ? (
                    <div className="trace-stack">
                      <div className="chart-range-controls" aria-label="Chart range">
                        <button
                          className={chartRange === "day" ? "is-active" : ""}
                          onClick={() => setChartRange("day")}
                        >
                          1 day
                        </button>
                        <button
                          className={chartRange === "week" ? "is-active" : ""}
                          onClick={() => setChartRange("week")}
                        >
                          7 days
                        </button>
                        <button
                          className={chartRange === "all" ? "is-active" : ""}
                          onClick={() => setChartRange("all")}
                        >
                          All
                        </button>
                      </div>
                      <SensorChart
                        history={selectedHistory}
                        currentTimestamp={timestamp}
                        unit={selectedState.sensor.unit}
                        range={chartRange}
                      />
                      <div className="raw-row-card">
                        <div>
                          <span>CSV row key</span>
                          <strong>
                            {selectedState.sensor.sensor_id} · {selectedState.reading.timestamp}
                          </strong>
                        </div>
                        <div>
                          <span>Actual</span>
                          <strong>
                            {selectedState.reading.value} {selectedState.sensor.unit}
                          </strong>
                        </div>
                        <div>
                          <span>Expected</span>
                          <strong>
                            {selectedState.reading.expected_value} {selectedState.sensor.unit}
                          </strong>
                        </div>
                        <div>
                          <span>Deviation</span>
                          <strong>{selectedState.reading.deviation_pct}%</strong>
                        </div>
                        <div>
                          <span>Samples</span>
                          <strong>{selectedState.reading.sample_count}</strong>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="context-stack">
                      <p>{selectedState.sensor.description}</p>
                      <div className="neighbor-list">
                        {selectedNeighborStates.map((neighbor) => (
                          <button
                            key={neighbor.sensor.sensor_id}
                            className="neighbor-chip"
                            onClick={() => setSelectedSensorId(neighbor.sensor.sensor_id)}
                          >
                            <StatusDot status={neighbor.status} />
                            {neighbor.sensor.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Copilot Notes</CardTitle>
                  <CardDescription>Stored locally for the next review</CardDescription>
                </CardHeader>
                <CardContent>
                  <textarea
                    className="operator-note"
                    value={operatorNote}
                    onChange={(event) => setOperatorNote(event.target.value)}
                    placeholder="Manual override, maintenance note, known sensor issue..."
                  />
                </CardContent>
              </Card>
            </>
          ) : null}
        </aside>
      </section>

      <section className="bottom-grid">
        <Card>
          <CardHeader>
            <CardTitle>Deviation Overview</CardTitle>
            <CardDescription>Largest current deviations across the topology</CardDescription>
          </CardHeader>
          <CardContent>
            <DeviationChart states={dashboardState.sortedByDeviation} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Insight Cards</CardTitle>
            <CardDescription>Topology-aware interpretation</CardDescription>
          </CardHeader>
          <CardContent className="insight-list">
            {insights.map((insight) => (
              <div className="insight-row" key={insight}>
                <CircleDot size={16} />
                <span>{insight}</span>
              </div>
            ))}
            <div className="insight-row insight-action">
              <CheckCircle2 size={16} />
              <span>Suggested check: verify critical-zone schedule, valve state, and local override.</span>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="timeline-card">
        <div className="timeline-copy">
          <strong>{formatHour(timestamp)} UTC</strong>
          <span>
            {energyData.manifest.start_date} · {energyData.manifest.days} days · hourly readings
          </span>
        </div>
        <input
          aria-label="Timeline"
          type="range"
          min={0}
          max={energyData.timestamps.length - 1}
          value={timestampIndex}
          onChange={(event) => setTimestampIndex(Number(event.target.value))}
        />
      </section>
    </main>
  );
}

export default App;
