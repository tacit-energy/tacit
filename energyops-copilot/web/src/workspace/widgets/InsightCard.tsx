import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileDown,
  History as HistoryIcon,
  Lightbulb,
  Pencil,
  X
} from 'lucide-react';
import type { ChartSpec, InsightCardSpec, TopologySpec } from '@shared/types';
import { Badge, Button, Card, Textarea } from '@/components/ui';
import { ChartWidget } from './ChartWidget';
import { DecisionDetailsModal } from './DecisionDetailsModal';
import {
  postDecision,
  getSimilarDecisions,
  type Decision,
  type DecisionType
} from '@/lib/api';
import { downloadInsightHtmlReport } from '@/lib/insight-report-html';
import { formatDateTime, formatNumber } from '@/lib/format';

const SEVERITY: Record<
  InsightCardSpec['severity'],
  { label: string; variant: 'outline' | 'warning' | 'danger'; bar: string }
> = {
  info: { label: 'Info', variant: 'outline', bar: 'var(--chart-2)' },
  watch: { label: 'Watch', variant: 'warning', bar: 'var(--chart-4)' },
  act: { label: 'Action', variant: 'danger', bar: 'var(--destructive)' }
};

const stop = (e: React.MouseEvent) => e.stopPropagation();
type TimeframeRange = NonNullable<ChartSpec['markBands']>[number];

type TextPart =
  | { type: 'text'; text: string }
  | { type: 'timeframe'; text: string; range: TimeframeRange };

function parseTimeframeText(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const re = /<timeframe\s+from="([^"]+)"\s+to="([^"]+)">([\s\S]*?)<\/timeframe>/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ type: 'text', text: text.slice(last, index) });
    parts.push({
      type: 'timeframe',
      text: match[3],
      range: { from: match[1], to: match[2] }
    });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}

function TimeframeText({
  text,
  onTimeframeSelect
}: {
  text: string;
  onTimeframeSelect?: (range: TimeframeRange) => void;
}) {
  const parts = parseTimeframeText(text);
  return (
    <>
      {parts.map((part, i) =>
        part.type === 'text' ? (
          <span key={i}>{part.text}</span>
        ) : (
          <button
            key={i}
            type="button"
            onClick={e => {
              stop(e);
              onTimeframeSelect?.(part.range);
            }}
            className="inline rounded-sm bg-[var(--primary)]/15 px-1 font-medium text-[var(--primary)] underline decoration-[var(--primary)]/40 underline-offset-2 hover:bg-[var(--primary)]/25"
            title="Highlight this timeframe in related topology sparklines"
          >
            {part.text}
          </button>
        )
      )}
    </>
  );
}

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

export function InsightCard({
  id,
  spec,
  sessionId,
  selected,
  onSelect,
  decided,
  onDecided,
  onExplain,
  onTimeframeSelect,
  explainDisabled = false,
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
  onTimeframeSelect?: (range: TimeframeRange) => void;
  explainDisabled?: boolean;
  topologies?: TopologySpec[];
}) {
  const sev = SEVERITY[spec.severity];
  const [precedent, setPrecedent] = useState<Decision[]>([]);
  const [showChart, setShowChart] = useState(true);
  const [pending, setPending] = useState<DecisionType | null>(null);
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [activePrecedent, setActivePrecedent] = useState<Decision | null>(null);
  const [precedentClosing, setPrecedentClosing] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const explain = () => {
    if (explainDisabled) return;
    setAsked(true);
    onExplain?.(
      `Explain the insight "${spec.title}" in more depth: the most likely root cause, what to verify next, and whether anything similar has happened before.`
    );
  };

  const exportPdf = async (e: React.MouseEvent) => {
    stop(e);
    setExportError(null);
    try {
      downloadInsightHtmlReport({
        insightCardId: id,
        insight: spec,
        relatedDecisions: precedent.map(d => ({
          decision_type: d.decision_type,
          rationale: d.rationale,
          created_at: d.created_at
        }))
      });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not export report');
    }
  };

  useEffect(() => {
    getSimilarDecisions(sessionId, spec.relatedNodeIds ?? [], spec.title)
      .then(rows => setPrecedent(rows.filter(d => d.insight_card_id !== id)))
      .catch(() => {});
  }, [sessionId, id, spec.relatedNodeIds, spec.title]);

  useEffect(
    () => () => {
      if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    },
    []
  );

  const openPrecedent = (decision: Decision) => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setPrecedentClosing(false);
    setActivePrecedent(decision);
  };

  const closePrecedent = () => {
    if (!activePrecedent || precedentClosing) return;
    setPrecedentClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setActivePrecedent(null);
      setPrecedentClosing(false);
      closeTimer.current = null;
    }, 160);
  };

  const submit = async (type: DecisionType, why?: string) => {
    setBusy(true);
    try {
      await postDecision(sessionId, {
        insightCardId: id,
        insightTitle: spec.title,
        decisionType: type,
        rationale: why,
        relatedNodeIds: spec.relatedNodeIds,
        insightSnapshot: {
          severity: spec.severity,
          summary: spec.summary,
          evidence: spec.evidence,
          recommendations: spec.recommendations,
          impact: spec.impact,
          chart: spec.chart
        },
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

  const exportButton = (
    <button
      type="button"
      onClick={exportPdf}
      className="inline-flex items-center gap-1 text-[12px] text-[var(--accent)] hover:underline"
    >
      <FileDown size={13} />
      Export HTML
    </button>
  );

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
                est. {formatNumber(spec.impact.value)}
                {spec.impact.unit ? ` ${spec.impact.unit}` : ''}
                {spec.impact.confidence ? ` · ${spec.impact.confidence}` : ''}
              </Badge>
            )}
          </div>

          <p className="text-[13px] leading-relaxed text-[var(--card-foreground)]">
            <TimeframeText text={spec.summary} onTimeframeSelect={onTimeframeSelect} />
          </p>

          {spec.evidence && spec.evidence.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Evidence
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-[var(--muted-foreground)]">
                {spec.evidence.map((e, i) => (
                  <li key={i}>
                    <TimeframeText text={e} onTimeframeSelect={onTimeframeSelect} />
                  </li>
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
                  <li key={i}>
                    <TimeframeText text={r} onTimeframeSelect={onTimeframeSelect} />
                  </li>
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
                <HistoryIcon size={12} /> Related
              </div>
              <ul className="mt-2 space-y-1.5 text-[12px] text-[var(--card-foreground)]">
                {precedent.map(d => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={e => {
                        stop(e);
                        openPrecedent(d);
                      }}
                      className="group flex w-full items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-2 text-left transition hover:border-[var(--accent)] hover:bg-[var(--panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      aria-label={`Open past decision from ${formatDateTime(d.created_at)}`}
                    >
                      <HistoryIcon
                        size={13}
                        className="mt-0.5 shrink-0 text-[var(--muted-foreground)] group-hover:text-[var(--accent)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <span className="font-medium">
                            You {decisionLabel(d.decision_type)}
                          </span>
                          <span className="text-[11px] text-[var(--muted-foreground)]">
                            {formatDateTime(d.created_at)}
                          </span>
                        </span>
                        <span className="mt-0.5 block leading-snug">
                          {d.insight_title}
                          {d.rationale ? ` - ${d.rationale}` : ''}
                        </span>
                      </span>
                      <ChevronRight
                        size={14}
                        className="mt-0.5 shrink-0 text-[var(--muted-foreground)] transition group-hover:translate-x-0.5 group-hover:text-[var(--accent)]"
                      />
                    </button>
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
                <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={explain}
                  disabled={explainDisabled}
                  className="text-[12px] text-[var(--accent)] hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
                >
                  {asked ? 'Asked ↗' : 'Explain ↗'}
                </button>
                  {exportButton}
                </div>
              </div>
            ) : pending ? (
              <div className="flex flex-col gap-2">
                <div className="text-[12px] text-[var(--muted-foreground)]">
                  {pending === 'override'
                    ? 'What is your call instead, and why? (saved as the decision)'
                    : pending === 'dismiss'
                      ? 'Why is this not actionable? (false alarm, known, expected...)'
                      : 'What will you act on from this? (optional)'}
                </div>
                <Textarea
                  autoFocus
                  rows={2}
                  value={rationale}
                  onChange={e => setRationale(e.target.value)}
                  placeholder={
                    pending === 'override'
                      ? 'Your reasoning...'
                      : pending === 'dismiss'
                        ? 'Reason...'
                        : 'Next action, owner, or follow-up...'
                  }
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setPending(null);
                      setRationale('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={
                      busy ||
                      ((pending === 'override' || pending === 'dismiss') &&
                        !rationale.trim())
                    }
                    onClick={() => submit(pending, rationale.trim() || undefined)}
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
                    onClick={() => setPending('accept')}
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
                <div className="mt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={explain}
                  disabled={explainDisabled}
                  className="text-[12px] text-[var(--accent)] hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
                >
                  {asked ? 'Asked the copilot ↗' : 'Explain in more depth ↗'}
                </button>
                  {exportButton}
                </div>
              </>
            )}
            {exportError && (
              <div className="mt-2 text-[12px] text-[var(--destructive)]">
                {exportError}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>

    {activePrecedent && (
      <DecisionDetailsModal
        decision={activePrecedent}
        topologies={topologies}
        currentSessionId={sessionId}
        closing={precedentClosing}
        onClose={closePrecedent}
      />
    )}
    </>
  );
}
