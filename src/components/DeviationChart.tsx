import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SensorState } from "../data/energyData";
import { formatNumber } from "../lib/utils";

export function DeviationChart({ states }: { states: SensorState[] }) {
  const data = states
    .slice(0, 8)
    .reverse()
    .map((state) => ({
      name: state.sensor.name.replace(" chilled water ", " "),
      deviation: Math.abs(state.reading.deviation_pct),
    }));

  return (
    <div className="overview-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} layout="vertical" margin={{ top: 6, right: 10, bottom: 6, left: 4 }}>
          <defs>
            <linearGradient id="deviationFill" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#f97316" stopOpacity={0.42} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(15, 23, 42, 0.09)" />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickFormatter={(value) => `${formatNumber(Number(value), 0)}%`}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={112}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#475569" }}
          />
          <Tooltip
            formatter={(value: number) => [`${formatNumber(value, 1)}%`, "Deviation"]}
            contentStyle={{
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              boxShadow: "0 16px 40px rgba(15, 23, 42, 0.14)",
            }}
          />
          <Area
            dataKey="deviation"
            type="monotone"
            stroke="#0f766e"
            fill="url(#deviationFill)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
