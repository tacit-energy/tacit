import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from '@dagrejs/dagre';
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
const FALLBACK_ENERGY_COLOR = {
  bg: 'var(--secondary)',
  border: 'var(--border)',
  text: 'var(--muted-foreground)'
};

const NODE_W = 180;
const NODE_H = 66;

function energyColors(energyType?: string | null) {
  if (!energyType) return FALLBACK_ENERGY_COLOR;
  return ENERGY_COLORS[energyType.toLowerCase()] ?? FALLBACK_ENERGY_COLOR;
}

function layout(spec: TopologySpec): Node[] {
  const hasPositions = spec.nodes.every(n => n.position);
  if (hasPositions) {
    return spec.nodes.map(n => toNode(n));
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
      p ? { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } : undefined
    );
  });
}

function toNode(
  n: TopologySpec['nodes'][number],
  pos?: { x: number; y: number }
): Node {
  const highlighted = false;
  const status = n.status;
  const energy = energyColors(n.energyType);
  return {
    id: n.id,
    position: pos ?? n.position ?? { x: 0, y: 0 },
    data: {
      label: (
        <div title={n.annotation ?? undefined} style={{ lineHeight: 1.2 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{n.label}</div>
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
      )
    },
    style: {
      width: NODE_W,
      background: energy.bg,
      color: 'var(--foreground)',
      border: `1px solid ${energy.border}`,
      borderRadius: 8,
      padding: 6,
      boxShadow: highlighted
        ? '0 0 0 2px var(--accent)'
        : status
          ? `inset 0 0 0 1px ${STATUS_BORDER[status]}, 0 0 0 3px ${STATUS_BG[status]}`
          : undefined
    },
    sourcePosition: 'right' as never,
    targetPosition: 'left' as never
  };
}

export function TopologyWidget({
  spec,
  onNodeClick,
  selectionHighlight,
  fill = false
}: {
  spec: TopologySpec;
  onNodeClick?: (nodeId: string) => void;
  selectionHighlight?: string[];
  fill?: boolean;
}) {
  const { nodes, edges } = useMemo(() => {
    const highlight = new Set(spec.highlight ?? []);
    const selected = new Set(selectionHighlight ?? []);
    const clickable = !!onNodeClick;
    const ns = layout(spec).map(node => {
      const ring = selected.has(node.id)
        ? '0 0 0 2px var(--primary)'
        : highlight.has(node.id)
          ? '0 0 0 2px var(--accent)'
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
  }, [spec, selectionHighlight, onNodeClick]);

  return (
    <Card className={`flex flex-col overflow-hidden p-0 ${fill ? 'h-full' : ''}`}>
      <div className="border-b border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)]">
        {spec.title}
      </div>
      <div className={fill ? 'min-h-0 flex-1' : ''} style={fill ? undefined : { height: 360 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          maxZoom={Infinity}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          panOnScroll={false}
          preventScrolling={false}
          onNodeClick={(_, n) => onNodeClick?.(n.id)}
        >
          <Background color="var(--border)" gap={18} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </Card>
  );
}
