import { AlertTriangle, CheckCircle2, Coins, Lightbulb } from 'lucide-react';
import type { Widget } from '@shared/types';
import type { Decision } from '@/lib/api';
import { formatNumber } from '@/lib/format';

const CONF_RANK: Record<string, number> = { low: 0, med: 1, high: 2 };
const CONF_LABEL = ['low', 'med', 'high'];

function Stat({
  icon,
  label,
  value
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <span className="text-[var(--muted-foreground)]">{icon}</span>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold text-[var(--foreground)]">
          {value}
        </div>
        <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
          {label}
        </div>
      </div>
    </div>
  );
}

export function WorkspaceKpiStrip({
  widgets,
  decisions,
  chatInset = 0
}: {
  widgets: Widget[];
  decisions: Decision[];
  chatInset?: number;
}) {
  const insightWidgets = widgets.filter(w => w.type === 'insight_card');
  const decidedIds = new Set(
    decisions.map(d => d.insight_card_id).filter(Boolean) as string[]
  );
  const open = insightWidgets.filter(w => !decidedIds.has(w.id)).length;

  const dqIssues = widgets.reduce(
    (n, w) => (w.type === 'data_quality' ? n + w.spec.issues.length : n),
    0
  );

  // Est. impact: sum over accepted decisions that carried an impact value;
  // confidence = weakest among the matching insight widgets (if still present).
  const accepted = decisions.filter(
    d => d.decision_type === 'accept' && d.impact != null
  );
  const impactTotal = accepted.reduce((sum, d) => sum + (d.impact ?? 0), 0);
  let unit = '';
  let confRank = 99;
  for (const d of accepted) {
    const w = insightWidgets.find(iw => iw.id === d.insight_card_id);
    if (w?.type === 'insight_card' && w.spec.impact) {
      unit = unit || w.spec.impact.unit || '';
      if (w.spec.impact.confidence) {
        confRank = Math.min(confRank, CONF_RANK[w.spec.impact.confidence] ?? 99);
      }
    }
  }
  const conf = confRank < 99 ? ` · ${CONF_LABEL[confRank]} conf` : '';

  return (
    <div
      className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] bg-[var(--panel)] px-2 transition-[padding] duration-300 ease-out"
      style={{ paddingLeft: chatInset ? chatInset + 8 : undefined }}
    >
      <Stat icon={<Lightbulb size={16} />} label="Open insights" value={String(open)} />
      <Stat
        icon={<CheckCircle2 size={16} />}
        label="Resolved"
        value={String(decisions.length)}
      />
      <Stat
        icon={<AlertTriangle size={16} />}
        label="Data-quality issues"
        value={String(dqIssues)}
      />
      {accepted.length > 0 && (
        <Stat
          icon={<Coins size={16} />}
          label="Est. impact"
          value={`${formatNumber(impactTotal)}${unit ? ` ${unit}` : ''}${conf}`}
        />
      )}
    </div>
  );
}
