import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  History,
  Lightbulb,
  Pencil,
  X
} from 'lucide-react';
import type { InsightCardSpec, TopologySpec } from '@shared/types';
import { Badge, Button, Card, Textarea } from '@/components/ui';
import { ChartWidget } from './ChartWidget';
import { TopologyWidget } from './TopologyWidget';
import {
  postDecision,
  getSimilarDecisions,
  type Decision,
  type DecisionType
} from '@/lib/api';

const SEVERITY: Record<
  InsightCardSpec['severity'],
  { label: string; variant: 'outline' | 'warning' | 'danger'; bar: string }
> = {
  info: { label: 'Info', variant: 'outline', bar: 'var(--chart-2)' },
  watch: { label: 'Watch', variant: 'warning', bar: 'var(--chart-4)' },
  act: { label: 'Action', variant: 'danger', bar: 'var(--destructive)' }
};

const stop = (e: React.MouseEvent) => e.stopPropagation();

function DecisionButton({
  icon,
  title,
  desc,
  variant = 'default',
  onClick,
  disabled
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  variant?: 'default' | 'primary';
  onClick: () => void;
  disabled?: boolean;
}) {
  const styles =
    variant === 'primary'
      ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90'
      : 'border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:border-[var(--primary)]';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left transition disabled:opacity-50 ${styles}`}
    >
      <span className="flex items-center gap-1.5 text-[13px] font-medium">
        {icon}
        {title}
      </span>
      <span
        className={`text-[11px] ${variant === 'primary' ? 'opacity-90' : 'text-[var(--muted-foreground)]'}`}
      >
        {desc}
      </span>
    </button>
  );
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
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        Related topology
      </div>
      <div className="mt-1 overflow-hidden rounded-md">
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

export function InsightCard({
  id,
  spec,
  sessionId,
  selected,
  onSelect,
  decided,
  onDecided,
  onExplain,
  onOpenSession,
  topologies
}: {
  id: string;
  spec: InsightCardSpec;
  sessionId: string;
  selected?: boolean;
  onSelect?: () => void;
  decided?: Decision;
  onDecided?: () => void;
  onExplain?: (text: string) => void;
  onOpenSession?: (sessionId: string) => void;
  topologies?: TopologySpec[];
}) {
  const sev = SEVERITY[spec.severity];
  const [precedent, setPrecedent] = useState<Decision[]>([]);
  const [showChart, setShowChart] = useState(true);
  const [pending, setPending] = useState<null | 'override' | 'dismiss'>(null);
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const [activePrecedent, setActivePrecedent] = useState<Decision | null>(null);

  const explain = () => {
    setAsked(true);
    onExplain?.(
      `Explain the insight "${spec.title}" in more depth: the most likely root cause, what to verify next, and whether anything similar has happened before.`
    );
  };

  useEffect(() => {
    getSimilarDecisions(sessionId, spec.relatedNodeIds ?? [], spec.title)
      .then(rows => setPrecedent(rows.filter(d => d.insight_card_id !== id)))
      .catch(() => {});
  }, [sessionId, id, spec.relatedNodeIds, spec.title]);

  const submit = async (type: DecisionType, why?: string) => {
    setBusy(true);
    try {
      await postDecision(sessionId, {
        insightCardId: id,
        insightTitle: spec.title,
        decisionType: type,
        rationale: why,
        relatedNodeIds: spec.relatedNodeIds,
        impact: spec.impact?.value
      });
      onDecided?.();
      setPending(null);
      setRationale('');
    } finally {
      setBusy(false);
    }
  };

  const decidedBadge =
    decided &&
    (decided.decision_type === 'accept'
      ? { label: 'Accepted', variant: 'success' as const }
      : decided.decision_type === 'override'
        ? { label: 'Overridden', variant: 'warning' as const }
        : { label: 'Dismissed', variant: 'outline' as const });

  const decisionLabel = (type: DecisionType) =>
    type === 'accept' ? 'accepted' : type === 'override' ? 'overrode' : 'dismissed';

  const formatDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  return (
    <>
    <Card
      onClick={onSelect}
      className={`cursor-pointer overflow-hidden p-0 transition ${
        selected ? 'ring-2 ring-[var(--primary)]' : ''
      }`}
    >
      <div className="flex" style={{ borderLeft: `3px solid ${sev.bar}` }}>
        <div className="flex-1 p-4">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Lightbulb size={15} className="text-[var(--accent)]" />
            <span className="text-sm font-semibold text-[var(--foreground)]">
              {spec.title}
            </span>
            <Badge variant={sev.variant}>{sev.label}</Badge>
            {spec.impact && (
              <Badge variant="outline">
                est. {spec.impact.value.toLocaleString()}
                {spec.impact.unit ? ` ${spec.impact.unit}` : ''}
                {spec.impact.confidence ? ` · ${spec.impact.confidence}` : ''}
              </Badge>
            )}
          </div>

          <p className="text-[13px] leading-relaxed text-[var(--card-foreground)]">
            {spec.summary}
          </p>

          {spec.evidence && spec.evidence.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Evidence
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-[var(--muted-foreground)]">
                {spec.evidence.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {spec.recommendations && spec.recommendations.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Recommended
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-[var(--card-foreground)]">
                {spec.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Embedded curated chart */}
          {spec.chart && (
            <div className="mt-3">
              <button
                type="button"
                onClick={e => {
                  stop(e);
                  setShowChart(s => !s);
                }}
                className="flex items-center gap-1 text-[12px] font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                {showChart ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showChart ? 'Hide chart' : 'Show chart'}
              </button>
              {showChart && (
                <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--background)] p-2" onClick={stop}>
                  <ChartWidget spec={spec.chart} height={200} bare />
                </div>
              )}
            </div>
          )}

          {/* Precedent — "seen before" */}
          {precedent.length > 0 && (
            <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--secondary)] p-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                <History size={12} /> Seen before
              </div>
              <ul className="mt-1 space-y-1 text-[12px] text-[var(--card-foreground)]">
                {precedent.map(d => (
                  <li
                    key={d.id}
                    onClick={e => {
                      stop(e);
                      setActivePrecedent(d);
                    }}
                    className="cursor-pointer rounded-sm hover:text-[var(--accent)]"
                  >
                    <span className="font-medium">
                      You {decisionLabel(d.decision_type)}
                    </span>{' '}
                    {d.insight_title}
                    {d.rationale ? ` - ${d.rationale}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Decision */}
          <div className="mt-4 border-t border-[var(--border)] pt-3" onClick={stop}>
            {decidedBadge ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-[var(--muted-foreground)]">
                  Your decision:
                </span>
                <Badge variant={decidedBadge.variant}>{decidedBadge.label}</Badge>
                {decided?.rationale && (
                  <span className="text-[12px] text-[var(--muted-foreground)]">
                    — {decided.rationale}
                  </span>
                )}
                <span className="flex-1" />
                <button
                  onClick={explain}
                  className="text-[12px] text-[var(--accent)] hover:underline"
                >
                  {asked ? 'Asked ↗' : 'Explain ↗'}
                </button>
              </div>
            ) : pending ? (
              <div className="flex flex-col gap-2">
                <div className="text-[12px] text-[var(--muted-foreground)]">
                  {pending === 'override'
                    ? 'What is your call instead, and why? (saved as the decision)'
                    : 'Why is this not actionable? (false alarm, known, expected…)'}
                </div>
                <Textarea
                  autoFocus
                  rows={2}
                  value={rationale}
                  onChange={e => setRationale(e.target.value)}
                  placeholder={pending === 'override' ? 'Your reasoning…' : 'Reason…'}
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy || !rationale.trim()}
                    onClick={() => submit(pending, rationale.trim())}
                  >
                    Save decision
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-2 text-[12px] text-[var(--muted-foreground)]">
                  <span className="font-medium text-[var(--foreground)]">
                    Your call
                  </span>{' '}
                  — saved as a decision the copilot recalls next time.
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <DecisionButton
                    icon={<Check size={15} />}
                    title="Accept"
                    desc="Agree & act on it"
                    variant="primary"
                    disabled={busy}
                    onClick={() => submit('accept')}
                  />
                  <DecisionButton
                    icon={<Pencil size={15} />}
                    title="Override"
                    desc="My call differs"
                    onClick={() => setPending('override')}
                  />
                  <DecisionButton
                    icon={<X size={15} />}
                    title="Dismiss"
                    desc="Not an issue"
                    onClick={() => setPending('dismiss')}
                  />
                </div>
                <button
                  onClick={explain}
                  className="mt-2 text-[12px] text-[var(--accent)] hover:underline"
                >
                  {asked ? 'Asked the copilot ↗' : 'Explain in more depth ↗'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>

    {activePrecedent && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
        onClick={e => {
          stop(e);
          setActivePrecedent(null);
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`decision-${activePrecedent.id}-title`}
          className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--panel-strong)] p-4 shadow-[0_24px_90px_rgb(0_0_0/0.45)]"
          onClick={stop}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--secondary)] text-[var(--accent)]">
              <History size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                Past decision
              </div>
              <h3
                id={`decision-${activePrecedent.id}-title`}
                className="mt-1 text-sm font-semibold text-[var(--foreground)]"
              >
                You {decisionLabel(activePrecedent.decision_type)} &quot;
                {activePrecedent.insight_title}&quot;
              </h3>
              <div className="mt-1 text-[12px] text-[var(--muted-foreground)]">
                {formatDate(activePrecedent.created_at)}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setActivePrecedent(null)}
              aria-label="Close past decision"
            >
              <X />
            </Button>
          </div>

          <div className="mt-4 space-y-3 text-[13px]">
            {activePrecedent.rationale ? (
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  Rationale
                </div>
                <p className="mt-1 leading-relaxed text-[var(--card-foreground)]">
                  {activePrecedent.rationale}
                </p>
              </div>
            ) : null}
            <RelatedTopologyPreview
              topologies={topologies}
              relatedNodeIds={activePrecedent.related_node_ids}
            />
            {activePrecedent.related_node_ids.length ? (
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  Related nodes
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {activePrecedent.related_node_ids.map(nodeId => (
                    <Badge key={nodeId} variant="outline">
                      {nodeId}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {activePrecedent.impact != null ? (
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                  Recorded impact
                </div>
                <div className="mt-1 text-[var(--card-foreground)]">
                  {activePrecedent.impact.toLocaleString()}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setActivePrecedent(null)}>
              Close
            </Button>
            {activePrecedent.session_id && activePrecedent.session_id !== sessionId ? (
              <Button
                variant="primary"
                onClick={() => {
                  const targetSession = activePrecedent.session_id;
                  setActivePrecedent(null);
                  if (targetSession) onOpenSession?.(targetSession);
                }}
              >
                <ExternalLink size={14} />
                Open old session
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
