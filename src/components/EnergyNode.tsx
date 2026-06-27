import { Handle, Node, NodeProps, Position } from "@xyflow/react";
import { Activity, Gauge, Thermometer, Zap } from "lucide-react";
import { SensorState } from "../data/energyData";
import { formatNumber, formatPercent } from "../lib/utils";
import { Badge } from "./ui/badge";

export type EnergyNodeData = {
  state: SensorState;
  selected: boolean;
};

export type EnergyFlowNode = Node<EnergyNodeData, "meterNode">;

function iconFor(state: SensorState) {
  if (state.sensor.unit === "°C") {
    return <Thermometer size={16} />;
  }
  if (state.sensor.energy_type === "electricity") {
    return <Zap size={16} />;
  }
  if (state.sensor.role === "reference") {
    return <Gauge size={16} />;
  }
  return <Activity size={16} />;
}

export function EnergyNode({ data }: NodeProps<EnergyFlowNode>) {
  const { state, selected } = data;
  const badgeVariant =
    state.status === "anomaly" ? "destructive" : state.status === "watch" ? "warning" : "success";

  return (
    <div className={`energy-node energy-node-${state.status} ${selected ? "is-selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <div className="energy-node-top">
        <span className="node-icon">{iconFor(state)}</span>
        <Badge variant={badgeVariant}>{formatPercent(state.reading.deviation_pct)}</Badge>
      </div>
      <div className="energy-node-title">{state.sensor.name}</div>
      <div className="energy-node-meta">
        <span>
          {formatNumber(state.reading.value)} {state.sensor.unit}
        </span>
        <span>expected {formatNumber(state.reading.expected_value)}</span>
      </div>
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </div>
  );
}
