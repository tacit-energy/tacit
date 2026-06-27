import { LayoutDashboard, Settings } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { TopologyWidget } from './widgets/TopologyWidget';
import { ChartWidget } from './widgets/ChartWidget';
import { InsightCard } from './widgets/InsightCard';
import { DataQualityWidget } from './widgets/DataQualityWidget';
import { WidgetFrame } from './WidgetFrame';
import type {
  NodeStatus,
  StateSummarySpec,
  Widget
} from '@shared/types';

type InsightAction = (
  action: 'accept' | 'reject',
  id: string,
  title: string
) => void;

const STATUS_COLOR: Record<NodeStatus, string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  alert: 'text-red-400',
  stale: 'text-[var(--muted-foreground)]',
  inferred: 'text-sky-400',
  missing: 'text-fuchsia-400'
};

function StateSummaryWidget({ spec }: { spec: StateSummarySpec }) {
  return (
    <Card className="p-4">
      <div className="mb-3 text-sm font-semibold text-[var(--foreground)]">
        {spec.title}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {spec.items.map((it, i) => (
          <div
            key={i}
            className="rounded-[calc(var(--radius)*0.8)] border border-[var(--border)] bg-[var(--background)] p-3 [border-style:var(--border-style)]"
          >
            <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
              {it.label}
            </div>
            <div
              className={`mt-1 text-lg font-semibold ${
                it.status ? STATUS_COLOR[it.status] : 'text-[var(--foreground)]'
              }`}
            >
              {it.value}
              {it.unit ? (
                <span className="ml-1 text-xs text-[var(--muted-foreground)]">
                  {it.unit}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function WidgetView({
  widget,
  onInsightAction
}: {
  widget: Widget;
  onInsightAction?: InsightAction;
}) {
  switch (widget.type) {
    case 'state_summary':
      return <StateSummaryWidget spec={widget.spec} />;
    case 'topology':
      return <TopologyWidget spec={widget.spec} />;
    case 'chart':
      return <ChartWidget spec={widget.spec} />;
    case 'data_quality':
      return <DataQualityWidget spec={widget.spec} />;
    case 'insight_card':
      return (
        <InsightCard id={widget.id} spec={widget.spec} onAction={onInsightAction} />
      );
  }
}

export function Workspace({
  widgets,
  sessionId,
  onOpenSettings,
  onInsightAction
}: {
  widgets: Widget[];
  sessionId: string;
  onOpenSettings: () => void;
  onInsightAction?: InsightAction;
}) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[image:var(--workspace-background)]">
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <LayoutDashboard size={15} className="text-[var(--muted-foreground)]" />
        <span className="text-[14px] font-medium text-[var(--foreground)]">
          Workspace
        </span>
        <span className="text-[12px] text-[var(--muted-foreground)]">
          {widgets.length} widget{widgets.length === 1 ? '' : 's'}
        </span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          aria-label="Open settings"
        >
          <Settings />
        </Button>
      </header>

      {widgets.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto overscroll-contain p-8 text-center text-sm text-[var(--muted-foreground)]">
          Widgets the copilot assembles - topology, charts, insights - appear
          here.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4">
          {widgets.map(w => (
            <WidgetFrame key={w.id} widgetId={w.id} sessionId={sessionId}>
              <WidgetView widget={w} onInsightAction={onInsightAction} />
            </WidgetFrame>
          ))}
        </div>
      )}
    </div>
  );
}
