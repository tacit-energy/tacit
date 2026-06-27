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

const NODE_W = 180;
const NODE_H = 52;

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
          {n.annotation && (
            <div style={{ fontSize: 10, color: 'var(--accent)' }}>note</div>
          )}
        </div>
      )
    },
    style: {
      width: NODE_W,
      background: status ? STATUS_BG[status] : 'var(--secondary)',
      color: 'var(--foreground)',
      border: `1px solid ${status ? STATUS_BORDER[status] : 'var(--border)'}`,
      borderRadius: 8,
      padding: 6,
      boxShadow: highlighted ? '0 0 0 2px var(--accent)' : undefined
    },
    sourcePosition: 'right' as never,
    targetPosition: 'left' as never
  };
}

export function TopologyWidget({ spec }: { spec: TopologySpec }) {
  const { nodes, edges } = useMemo(() => {
    const highlight = new Set(spec.highlight ?? []);
    const ns = layout(spec).map(node =>
      highlight.has(node.id)
        ? {
            ...node,
            style: { ...node.style, boxShadow: '0 0 0 2px var(--accent)' }
          }
        : node
    );
    const es: Edge[] = spec.edges.map((e, i) => ({
      id: `e${i}`,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: e.emphasis,
      style: {
        stroke: e.emphasis ? 'var(--accent)' : 'var(--muted-foreground)'
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: 'var(--muted-foreground)'
      },
      labelStyle: { fill: 'var(--muted-foreground)', fontSize: 10 }
    }));
    return { nodes: ns, edges: es };
  }, [spec]);

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)]">
        {spec.title}
      </div>
      <div style={{ height: 360 }}>
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
        >
          <Background color="var(--border)" gap={18} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </Card>
  );
}
