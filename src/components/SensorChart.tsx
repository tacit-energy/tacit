import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SensorReading } from "../data/energyData";
import { formatDay, formatNumber } from "../lib/utils";

export type ChartRange = "day" | "week" | "all";

function sameUtcDay(left: string, right: string) {
  return left.slice(0, 10) === right.slice(0, 10);
}

function filterReadings(history: SensorReading[], currentTimestamp: string, range: ChartRange) {
  if (range === "all") {
    return history;
  }

  if (range === "day") {
    return history.filter((reading) => sameUtcDay(reading.timestamp, currentTimestamp));
  }

  const currentTime = new Date(currentTimestamp).getTime();
  const halfWindow = 3.5 * 24 * 60 * 60 * 1000;
  return history.filter((reading) => {
    const readingTime = new Date(reading.timestamp).getTime();
    return Math.abs(readingTime - currentTime) <= halfWindow;
  });
}

function getValueDomain(data: SensorReading[]) {
  const values = data.flatMap((reading) => [reading.value, reading.expected_value]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, Math.abs(max) * 0.05, 1);
  const padding = span * 0.12;

  return [min - padding, max + padding] as [number, number];
}

export function SensorChart({
  history,
  currentTimestamp,
  unit,
  range,
}: {
  history: SensorReading[];
  currentTimestamp: string;
  unit: string;
  range: ChartRange;
}) {
  const data = filterReadings(history, currentTimestamp, range);
  const currentIndex = history.findIndex((reading) => reading.timestamp === currentTimestamp);
  const current = history[currentIndex];
  const valueDomain = getValueDomain(data);

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 23, 42, 0.09)" />
          <XAxis
            dataKey="timestamp"
            minTickGap={36}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickFormatter={(value) => (range === "day" ? String(value).slice(11, 16) : formatDay(String(value)))}
          />
          <YAxis
            domain={valueDomain}
            allowDataOverflow={false}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#64748b" }}
            tickFormatter={(value) => formatNumber(Number(value), unit === "°C" ? 1 : 0)}
          />
          <Tooltip
            contentStyle={{
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              boxShadow: "0 16px 40px rgba(15, 23, 42, 0.14)",
            }}
            formatter={(value: number, name) => [
              `${formatNumber(Number(value), 2)} ${name === "deviation_pct" ? "%" : unit}`,
              name === "value"
                ? "Actual"
                : name === "expected_value"
                  ? "Expected"
                  : "Deviation",
            ]}
            labelFormatter={(label) => String(label)}
          />
          {current ? (
            <ReferenceArea
              x1={current.timestamp}
              x2={current.timestamp}
              stroke="#0f766e"
              strokeOpacity={0.9}
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="expected_value"
            stroke="#94a3b8"
            strokeWidth={2}
            dot={range === "day" ? { r: 2.4, fill: "#94a3b8" } : false}
            activeDot={{ r: 5 }}
            strokeDasharray="5 5"
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#0f766e"
            strokeWidth={2.4}
            dot={range === "day" ? { r: 2.8, fill: "#0f766e" } : false}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
