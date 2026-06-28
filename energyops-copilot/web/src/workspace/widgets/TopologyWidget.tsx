import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MarkerType,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type Viewport
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from '@dagrejs/dagre';
import { Flame } from 'lucide-react';
import type { NodeStatus, TopologySpec } from '@shared/types';
import { Card } from '@/components/ui';

const STATUS_BG: Record<NodeStatus, string> = {
  ok: '#10b98122',
  warn: '#f59e0b22',
  alert: '#ef444433',
  stale: '#6b728022',
  inferred: '#0ea5e922',
  missing: '#d946ef22'
};
const STATUS_BORDER: Record<NodeStatus, string> = {
  ok: '#10b981',
  warn: '#f59e0b',
  alert: '#ef4444',
  stale: '#6b7280',
  inferred: '#0ea5e9',
  missing: '#d946ef'
};

const ENERGY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  cold: { bg: 'rgb(14 165 233 / 0.2)', border: '#0ea5e9', text: '#bae6fd' },
  cooling: { bg: 'rgb(14 165 233 / 0.2)', border: '#0ea5e9', text: '#bae6fd' },
  chilled: { bg: 'rgb(14 165 233 / 0.2)', border: '#0ea5e9', text: '#bae6fd' },
  electricity: { bg: 'rgb(250 204 21 / 0.2)', border: '#facc15', text: '#fef3c7' },
  electric: { bg: 'rgb(250 204 21 / 0.2)', border: '#facc15', text: '#fef3c7' },
  heating: { bg: 'rgb(249 115 22 / 0.22)', border: '#f97316', text: '#fed7aa' },
  heat: { bg: 'rgb(249 115 22 / 0.22)', border: '#f97316', text: '#fed7aa' },
  gas: { bg: 'rgb(168 85 247 / 0.2)', border: '#a855f7', text: '#e9d5ff' },
  water: { bg: 'rgb(20 184 166 / 0.2)', border: '#14b8a6', text: '#ccfbf1' },
  steam: { bg: 'rgb(148 163 184 / 0.22)', border: '#94a3b8', text: '#e2e8f0' }
};
const GENERATED_ENERGY_COLORS = [
  { bg: 'rgb(59 130 246 / 0.2)', border: '#3b82f6', text: '#bfdbfe' },
  { bg: 'rgb(34 197 94 / 0.2)', border: '#22c55e', text: '#bbf7d0' },
  { bg: 'rgb(236 72 153 / 0.2)', border: '#ec4899', text: '#fbcfe8' },
  { bg: 'rgb(245 158 11 / 0.22)', border: '#f59e0b', text: '#fde68a' },
  { bg: 'rgb(99 102 241 / 0.2)', border: '#6366f1', text: '#c7d2fe' },
  { bg: 'rgb(6 182 212 / 0.2)', border: '#06b6d4', text: '#cffafe' },
  { bg: 'rgb(132 204 22 / 0.2)', border: '#84cc16', text: '#ecfccb' },
  { bg: 'rgb(244 63 94 / 0.2)', border: '#f43f5e', text: '#ffe4e6' }
];
const FALLBACK_ENERGY_COLOR = {
  bg: 'var(--secondary)',
  border: 'var(--border)',
  text: 'var(--muted-foreground)'
};

const NODE_W = 180;
const NODE_H = 92;
const NODE_PAD = 6;
const NODE_SPARK_W = NODE_W - NODE_PAD * 2 - 10;
const NODE_SPARK_H = 42;
const TOPOLOGY_MIN_ZOOM = 0.01;
const TOPOLOGY_GLOW_RADIUS = 120;
const STATUS_LABELS: Record<NodeStatus, string> = {
  ok: 'OK',
  warn: 'Warning',
  alert: 'Alert',
  stale: 'Stale',
  inferred: 'Inferred',
  missing: 'Missing'
};
type SparklineHighlightRange = { from: string; to: string };
type SparklineScale = { min: number; max: number };

function energyColors(energyType?: string | null) {
  if (!energyType) return FALLBACK_ENERGY_COLOR;
  const normalized = energyType.toLowerCase().replace(/[_-]/g, ' ');
  return (
    ENERGY_COLORS[normalized] ??
    Object.entries(ENERGY_COLORS).find(([key]) => normalized.includes(key))?.[1] ??
    generatedEnergyColor(normalized)
  );
}

function generatedEnergyColor(energyType: string) {
  let hash = 0;
  for (const char of energyType) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return GENERATED_ENERGY_COLORS[hash % GENERATED_ENERGY_COLORS.length];
}

function canvasGlowColor(n?: TopologySpec['nodes'][number]) {
  if (n?.status) return STATUS_BORDER[n.status];
  const border = energyColors(n?.energyType).border;
  return border.startsWith('#') ? border : '#64748b';
}

function labelEnergyType(energyType: string) {
  return energyType
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function sparklineBars(
  points: NonNullable<TopologySpec['nodes'][number]['sparkline']>['points'],
  width: number,
  height: number,
  scale?: SparklineScale,
  highlightRanges?: SparklineHighlightRange[]
) {
  const values = points
    .map((point, index) => ({ index, value: point.value }))
    .filter((point): point is { index: number; value: number } =>
      typeof point.value === 'number' && Number.isFinite(point.value)
    );
  if (values.length < 1) return [];
  const min = Math.min(...values.map(point => point.value));
  const max = Math.max(...values.map(point => point.value));
  const scaleMin = scale?.min ?? min;
  const scaleMax = scale?.max ?? max;
  const hasNegative = scaleMin < 0;
  const hasPositive = scaleMax > 0;
  const positiveSpan = Math.max(hasPositive ? scaleMax : 0, 1);
  const negativeSpan = Math.max(hasNegative ? Math.abs(scaleMin) : 0, 1);
  const negativeBand = hasNegative ? Math.max(5, Math.min(height * 0.32, height * 0.22)) : 0;
  const baselineY = hasNegative && hasPositive ? height - negativeBand : hasNegative ? 0 : height;
  const count = Math.max(1, points.length);
  const gap = count > 24 ? 0.5 : 1;
  const barW = Math.max(1, (width - gap * (count - 1)) / count);
  return values
    .map(point => {
      const valueY =
        point.value < 0
          ? baselineY + (Math.abs(point.value) / negativeSpan) * (height - baselineY)
          : baselineY - (point.value / positiveSpan) * baselineY;
      const barH = Math.max(1, Math.abs(baselineY - valueY));
      return {
        x: point.index * (barW + gap),
        y: Math.min(valueY, baselineY),
        width: barW,
        height: barH,
        highlighted: sparklinePointOverlapsRanges(points[point.index].date, highlightRanges)
      };
    });
}

function parseTime(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function sparklinePointOverlapsRanges(date: string, ranges?: SparklineHighlightRange[]) {
  if (!ranges?.length) return false;
  const dayStart = parseTime(date);
  if (dayStart === undefined) return false;
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  return ranges.some(range => {
    const from = parseTime(range.from);
    const to = parseTime(range.to);
    if (from === undefined || to === undefined) return false;
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    return start === end
      ? start >= dayStart && start < dayEnd
      : start < dayEnd && end >= dayStart;
  });
}

function Sparkline({
  sparkline,
  color,
  scale,
  highlightRanges
}: {
  sparkline: NonNullable<TopologySpec['nodes'][number]['sparkline']>;
  color: string;
  scale?: SparklineScale;
  highlightRanges?: SparklineHighlightRange[];
}) {
  const bars = sparklineBars(
    sparkline.points,
    NODE_SPARK_W,
    NODE_SPARK_H,
    scale,
    highlightRanges
  );
  if (!bars.length) return null;
  const hasHighlights = bars.some(bar => bar.highlighted);
  return (
    <svg
      viewBox={`0 0 ${NODE_SPARK_W} ${NODE_SPARK_H}`}
      width={NODE_SPARK_W}
      height={NODE_SPARK_H}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: 'block', overflow: 'hidden' }}
    >
      {bars.map((bar, index) => (
        <rect
          key={index}
          x={bar.x.toFixed(1)}
          y={bar.y.toFixed(1)}
          width={bar.width.toFixed(1)}
          height={bar.height.toFixed(1)}
          rx="0.8"
          fill={bar.highlighted ? 'var(--primary)' : color}
          opacity={hasHighlights ? (bar.highlighted ? '1' : '0.28') : '0.82'}
          stroke={bar.highlighted ? 'var(--primary-foreground)' : undefined}
          strokeWidth={bar.highlighted ? '0.7' : undefined}
        />
      ))}
    </svg>
  );
}

function topologySparklineScale(spec: TopologySpec): SparklineScale | undefined {
  const values = spec.nodes
    .flatMap(node => node.sparkline?.points ?? [])
    .map(point => point.value)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return undefined;
  return { min: Math.min(...values), max: Math.max(...values) };
}

function layout(
  spec: TopologySpec,
  sparklineHighlightNodeIds?: Set<string>,
  sparklineHighlightRanges?: SparklineHighlightRange[]
): Node[] {
  const sparklineScale = topologySparklineScale(spec);
  const hasPositions = spec.nodes.every(n => n.position);
  if (hasPositions) {
    return spec.nodes.map(n =>
      toNode(
        n,
        undefined,
        sparklineScale,
        sparklineHighlightNodeIds?.has(n.id) ? sparklineHighlightRanges : undefined
      )
    );
  }
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of spec.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of spec.edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return spec.nodes.map(n => {
    const p = g.node(n.id);
    return toNode(
      n,
      p ? { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } : undefined,
      sparklineScale,
      sparklineHighlightNodeIds?.has(n.id) ? sparklineHighlightRanges : undefined
    );
  });
}

function toNode(
  n: TopologySpec['nodes'][number],
  pos?: { x: number; y: number },
  sparklineScale?: SparklineScale,
  sparklineHighlightRanges?: SparklineHighlightRange[]
): Node {
  const highlighted = false;
  const status = n.status;
  const energy = energyColors(n.energyType);
  const statusShadow = highlighted
    ? '0 0 0 2px var(--accent)'
    : status
      ? `inset 0 0 0 1px ${STATUS_BORDER[status]}, 0 0 0 3px ${STATUS_BG[status]}`
      : undefined;
  return {
    id: n.id,
    position: pos ?? n.position ?? { x: 0, y: 0 },
    data: {
      label: (
        <div
          title={n.annotation ?? undefined}
          style={{
            position: 'relative',
            height: '100%',
            lineHeight: 1.2,
            textAlign: 'center'
          }}
        >
          <div style={{ minWidth: 0, width: '100%', paddingBottom: n.sparkline ? NODE_SPARK_H + 3 : 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {n.label}
            </div>
            {n.value !== undefined && (
              <div style={{ fontSize: 11, opacity: 0.7 }}>
                {n.value}
                {n.unit ? ` ${n.unit}` : ''}
              </div>
            )}
            {n.energyType && (
              <div style={{ color: energy.text, fontSize: 10, fontWeight: 600, marginTop: 2 }}>
                {n.energyType}
              </div>
            )}
            {n.annotation && (
              <div style={{ fontSize: 10, color: 'var(--accent)' }}>note</div>
            )}
          </div>
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              width: '100%',
              height: NODE_SPARK_H
            }}
          >
            {n.sparkline && (
              <Sparkline
                sparkline={n.sparkline}
                color={energy.border}
                scale={sparklineScale}
                highlightRanges={sparklineHighlightRanges}
              />
            )}
          </div>
        </div>
      )
    },
    style: {
      width: NODE_W,
      height: NODE_H,
      background: energy.bg,
      color: 'var(--foreground)',
      border: `1px solid ${energy.border}`,
      borderRadius: 8,
      padding: `${NODE_PAD}px ${NODE_PAD}px 3px`,
      boxShadow: statusShadow
    },
    sourcePosition: 'right' as never,
    targetPosition: 'left' as never
  };
}

function FitViewWhenReady({ fitKey }: { fitKey: string }) {
  const reactFlow = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  useEffect(() => {
    if (!nodesInitialized) return;
    let frame = window.requestAnimationFrame(() => {
      void reactFlow.fitView({ padding: 0.14, duration: 120 });
    });
    const timeout = window.setTimeout(() => {
      void reactFlow.fitView({ padding: 0.14, duration: 120 });
    }, 120);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [fitKey, nodesInitialized, reactFlow]);

  return null;
}

export function TopologyWidget({
  spec,
  onNodeClick,
  selectionHighlight,
  sparklineHighlightRanges,
  fill = false,
  scrollZoom = false,
  height = 360
}: {
  spec: TopologySpec;
  onNodeClick?: (nodeId: string) => void;
  selectionHighlight?: string[];
  sparklineHighlightRanges?: SparklineHighlightRange[];
  fill?: boolean;
  scrollZoom?: boolean;
  height?: number;
}) {
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const glowCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const glowFrameRef = useRef<number | null>(null);
  const { nodes, edges } = useMemo(() => {
    const highlight = new Set(spec.highlight ?? []);
    const selected = new Set(selectionHighlight ?? []);
    const sparklineHighlightNodeIds = new Set([...highlight, ...selected]);
    const clickable = !!onNodeClick;
    const ns = layout(spec, sparklineHighlightNodeIds, sparklineHighlightRanges).map(node => {
      const ring = selected.has(node.id)
        ? '0 0 0 3px var(--background), 0 0 0 6px var(--primary), 0 0 22px var(--primary)'
        : highlight.has(node.id)
          ? '0 0 0 3px var(--background), 0 0 0 6px var(--accent), 0 0 22px var(--accent)'
          : undefined;
      const baseShadow =
        typeof node.style?.boxShadow === 'string' ? node.style.boxShadow : undefined;
      return {
        ...node,
        style: {
          ...node.style,
          boxShadow: [baseShadow, ring].filter(Boolean).join(', ') || undefined,
          cursor: clickable ? 'pointer' : 'default'
        }
      };
    });
    const nodeById = new Map(spec.nodes.map(n => [n.id, n]));
    const es: Edge[] = spec.edges.map((e, i) => ({
      id: `e${i}`,
      source: e.source,
      target: e.target,
      label: e.label,
      type: 'smoothstep',
      animated: e.animated ?? e.emphasis ?? true,
      style: {
        stroke:
          e.emphasis
            ? 'var(--accent)'
            : energyColors(nodeById.get(e.source)?.energyType).border,
        strokeWidth: e.emphasis ? 2.5 : 2
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color:
          e.emphasis
            ? 'var(--accent)'
            : energyColors(nodeById.get(e.source)?.energyType).border
      },
      labelStyle: { fill: 'var(--muted-foreground)', fontSize: 10 }
    }));
    return { nodes: ns, edges: es };
  }, [spec, selectionHighlight, sparklineHighlightRanges, onNodeClick]);
  const fitKey = useMemo(
    () => `${spec.title}:${nodes.map(n => n.id).join(',')}:${edges.length}`,
    [spec.title, nodes, edges.length]
  );
  const glowNodes = useMemo(() => {
    const specNodeById = new Map(spec.nodes.map(n => [n.id, n]));
    return nodes.map(node => {
      const specNode = specNodeById.get(node.id);
      const color = canvasGlowColor(specNode);
      const intensity =
        specNode?.status === 'alert' ? 0.86 : specNode?.status === 'warn' ? 0.7 : 0.5;
      return {
        x: node.position.x + NODE_W / 2,
        y: node.position.y + NODE_H / 2,
        color,
        intensity
      };
    });
  }, [nodes, spec.nodes]);
  const legendEntries = useMemo(() => {
    const entries: { key: string; label: string; color: string; kind: 'status' | 'energy' }[] = [];
    const seen = new Set<string>();

    for (const node of spec.nodes) {
      if (node.status && !seen.has(`status:${node.status}`)) {
        seen.add(`status:${node.status}`);
        entries.push({
          key: `status:${node.status}`,
          label: STATUS_LABELS[node.status],
          color: STATUS_BORDER[node.status],
          kind: 'status'
        });
      }
    }

    for (const node of spec.nodes) {
      if (!node.energyType) continue;
      const label = labelEnergyType(node.energyType);
      const color = canvasGlowColor({ ...node, status: undefined });
      const key = `energy:${label.toLowerCase()}:${color}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ key, label, color, kind: 'energy' });
    }

    if (entries.length === 0) {
      entries.push({
        key: 'energy:node',
        label: 'Node',
        color: '#64748b',
        kind: 'energy'
      });
    }

    return entries;
  }, [spec.nodes]);

  const drawGlow = useCallback((viewport = viewportRef.current) => {
    viewportRef.current = viewport;
    if (glowFrameRef.current !== null) return;
    glowFrameRef.current = window.requestAnimationFrame(() => {
      glowFrameRef.current = null;
      const canvas = glowCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.globalCompositeOperation = 'screen';

      for (const node of glowNodes) {
        const x = node.x * viewport.zoom + viewport.x;
        const y = node.y * viewport.zoom + viewport.y;
        const radius = TOPOLOGY_GLOW_RADIUS * node.intensity;
        if (
          x < -radius ||
          y < -radius ||
          x > rect.width + radius ||
          y > rect.height + radius
        ) {
          continue;
        }
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, `${node.color}cc`);
        glow.addColorStop(0.28, `${node.color}66`);
        glow.addColorStop(0.62, `${node.color}24`);
        glow.addColorStop(1, `${node.color}00`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }, [glowNodes]);

  useEffect(() => {
    drawGlow();
    const canvas = glowCanvasRef.current;
    if (!canvas) return;
    const resizeObserver = new ResizeObserver(() => drawGlow());
    resizeObserver.observe(canvas);
    return () => {
      resizeObserver.disconnect();
      if (glowFrameRef.current !== null) {
        window.cancelAnimationFrame(glowFrameRef.current);
        glowFrameRef.current = null;
      }
    };
  }, [drawGlow]);

  return (
    <Card className={`flex flex-col overflow-hidden p-0 ${fill ? 'h-full' : ''}`}>
      <div className="border-b border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)]">
        {spec.title}
      </div>
      <div
        className={`relative ${fill ? 'min-h-0 flex-1' : ''}`}
        style={fill ? undefined : { height }}
      >
        <ReactFlow
          className="relative z-10"
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.14 }}
          minZoom={TOPOLOGY_MIN_ZOOM}
          maxZoom={Infinity}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={scrollZoom}
          panOnScroll={false}
          preventScrolling={scrollZoom}
          onInit={instance => drawGlow(instance.toObject().viewport)}
          onMove={(_, viewport) => drawGlow(viewport)}
          onNodeClick={(_, n) => onNodeClick?.(n.id)}
        >
          <Background color="var(--border)" gap={18} />
          <Controls showInteractive={false}>
            <ControlButton
              onClick={() => setHeatmapEnabled(enabled => !enabled)}
              aria-pressed={heatmapEnabled}
              aria-label={heatmapEnabled ? 'Disable topology heatmap' : 'Enable topology heatmap'}
              title={heatmapEnabled ? 'Disable heatmap' : 'Enable heatmap'}
              style={{
                color: heatmapEnabled ? 'var(--primary)' : 'var(--muted-foreground)'
              }}
            >
              <Flame size={15} />
            </ControlButton>
          </Controls>
          <FitViewWhenReady fitKey={fitKey} />
        </ReactFlow>
        <canvas
          ref={glowCanvasRef}
          className={`pointer-events-none absolute inset-0 z-0 h-full w-full transition-opacity duration-300 ${
            heatmapEnabled ? 'opacity-80' : 'opacity-0'
          }`}
        />
        <div className="pointer-events-none absolute right-3 bottom-3 z-20 max-w-[220px] rounded-md border border-[var(--border)] bg-[var(--popover)]/90 px-2.5 py-2 text-[11px] text-[var(--popover-foreground)] shadow-lg backdrop-blur">
          <div className="mb-1.5 text-[10px] font-semibold uppercase text-[var(--muted-foreground)]">
            Colors
          </div>
          <div className="grid gap-1.5">
            {legendEntries.map(entry => (
              <div key={entry.key} className="flex min-w-0 items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: entry.color,
                    boxShadow: `0 0 10px ${entry.color}99`
                  }}
                />
                <span className="truncate">{entry.label}</span>
                {entry.kind === 'status' && (
                  <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">
                    status
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
