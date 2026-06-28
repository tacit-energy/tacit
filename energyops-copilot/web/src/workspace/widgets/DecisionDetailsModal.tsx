import { ExternalLink, History as HistoryIcon, X } from 'lucide-react';
import type { InsightCardSpec, TopologySpec } from '@shared/types';
import { Badge, Button } from '@/components/ui';
import type { Decision } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/format';
import { sessionPath } from '@/lib/routes';
import { ChartWidget } from './ChartWidget';
import { TopologyWidget } from './TopologyWidget';

const stop = (e: React.MouseEvent) => e.stopPropagation();

function decisionLabel(type: Decision['decision_type']) {
  return type === 'accept' ? 'accepted' : type === 'override' ? 'overrode' : 'dismissed';
}

function severityVariant(
  severity?: InsightCardSpec['severity']
): 'outline' | 'warning' | 'danger' {
  if (severity === 'act') return 'danger';
  if (severity === 'watch') return 'warning';
  return 'outline';
}

function RelatedTopologyPreview({
  topologies,
  relatedNodeIds
}: {
  topologies?: TopologySpec[];
  relatedNodeIds: string[];
}) {
  const related = new Set(relatedNodeIds);
  const source = topologies?.find(t => t.nodes.some(n => related.has(n.id)));
  if (!source || related.size === 0) return null;

  const included = new Set(related);
  for (const edge of source.edges) {
    if (related.has(edge.source)) included.add(edge.target);
    if (related.has(edge.target)) included.add(edge.source);
  }

  const nodes = source.nodes.filter(n => included.has(n.id));
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = source.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  if (!nodes.length) return null;

  const previewSpec: TopologySpec = {
    title: 'Related topology',
    nodes: nodes.map(node =>
      related.has(node.id)
        ? {
            ...node,
            status: node.status ?? 'inferred'
          }
        : node
    ),
    edges,
    highlight: relatedNodeIds
  };

  return (
    <div>
      <div className="overflow-hidden rounded-md">
        <TopologyWidget
          spec={previewSpec}
          selectionHighlight={relatedNodeIds}
          height={240}
          scrollZoom={false}
        />
      </div>
    </div>
  );
}

export function DecisionDetailsModal({
  decision,
  topologies,
  currentSessionId,
  closing,
  onClose
}: {
  decision: Decision;
  topologies?: TopologySpec[];
  currentSessionId?: string;
  closing?: boolean;
  onClose: () => void;
}) {
  const snapshot = decision.insight_snapshot;
  const showOldSession =
    decision.session_id && (!currentSessionId || decision.session_id !== currentSessionId);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 ${
        closing ? 'eo-modal-overlay-out' : 'eo-modal-overlay-in'
      }`}
      onClick={e => {
        stop(e);
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`decision-${decision.id}-title`}
        className={`max-h-[calc(100vh-32px)] w-full max-w-2xl overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--panel-strong)] p-4 shadow-[0_24px_90px_rgb(0_0_0/0.45)] ${
          closing ? 'eo-modal-panel-out' : 'eo-modal-panel-in'
        }`}
        onClick={stop}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--secondary)] text-[var(--accent)]">
            <HistoryIcon size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Past decision
            </div>
            <h3
              id={`decision-${decision.id}-title`}
              className="mt-1 text-sm font-semibold text-[var(--foreground)]"
            >
              You {decisionLabel(decision.decision_type)} &quot;{decision.insight_title}&quot;
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
              <span>{formatDateTime(decision.created_at)}</span>
              {snapshot?.severity ? (
                <Badge variant={severityVariant(snapshot.severity)}>
                  {snapshot.severity}
                </Badge>
              ) : null}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close past decision"
          >
            <X />
          </Button>
        </div>

        <div className="mt-4 space-y-4 text-[13px]">
          {decision.rationale ? (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Rationale
              </div>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed text-[var(--card-foreground)]">
                {decision.rationale}
              </p>
            </div>
          ) : null}

          {snapshot?.summary ? (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Original insight
              </div>
              <p className="mt-1 leading-relaxed text-[var(--card-foreground)]">
                {snapshot.summary}
              </p>
            </div>
          ) : null}

          {snapshot?.evidence?.length ? (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Evidence
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-[var(--muted-foreground)]">
                {snapshot.evidence.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {snapshot?.recommendations?.length ? (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Recommended
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-[var(--card-foreground)]">
                {snapshot.recommendations.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {snapshot?.chart ? (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Supporting chart
              </div>
              <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--background)] p-2">
                <ChartWidget spec={snapshot.chart} height={240} bare />
              </div>
            </div>
          ) : null}

          <RelatedTopologyPreview
            topologies={topologies}
            relatedNodeIds={decision.related_node_ids}
          />

          {decision.related_node_ids.length ? (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Related nodes
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {decision.related_node_ids.map(nodeId => (
                  <Badge key={nodeId} variant="outline">
                    {nodeId}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {decision.impact != null || snapshot?.impact ? (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Recorded impact
              </div>
              <div className="mt-1 text-[var(--card-foreground)]">
                {snapshot?.impact
                  ? `${formatNumber(snapshot.impact.value)}${
                      snapshot.impact.unit ? ` ${snapshot.impact.unit}` : ''
                    }${
                      snapshot.impact.confidence
                        ? ` - ${snapshot.impact.confidence}`
                        : ''
                    }`
                  : formatNumber(decision.impact ?? 0)}
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {showOldSession ? (
            <Button asChild variant="primary">
              <a
                href={sessionPath(decision.dataset_id, decision.session_id!)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={14} />
                Open old session
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
