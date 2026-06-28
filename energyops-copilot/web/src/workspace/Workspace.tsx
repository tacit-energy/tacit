import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, LayoutDashboard, Settings, X } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { TopologyWidget } from './widgets/TopologyWidget';
import { ChartWidget } from './widgets/ChartWidget';
import { InsightCard } from './widgets/InsightCard';
import { DataQualityWidget } from './widgets/DataQualityWidget';
import { WidgetFrame } from './WidgetFrame';
import { WorkspaceKpiStrip } from './WorkspaceKpiStrip';
import { useDecisions } from '@/lib/useDecisions';
import { getSeries, type Decision } from '@/lib/api';
import type {
  ChartSpec,
  NodeStatus,
  StateSummaryItem,
  StateSummarySpec,
  Widget
} from '@shared/types';

type TopoWidget = Extract<Widget, { type: 'topology' }>;
type InsightWidget = Extract<Widget, { type: 'insight_card' }>;
type DetailWidget = Extract<
  Widget,
  { type: 'chart' | 'data_quality' | 'state_summary' }
>;

const STATUS_COLOR: Record<NodeStatus, string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  alert: 'text-red-400',
  stale: 'text-[var(--muted-foreground)]',
  inferred: 'text-sky-400',
  missing: 'text-fuchsia-400'
};

const STATUS_DOT: Record<NodeStatus, string> = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  alert: 'bg-red-400',
  stale: 'bg-[var(--muted-foreground)]',
  inferred: 'bg-sky-400',
  missing: 'bg-fuchsia-400'
};

function formatObservedAt(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short'
  }).format(new Date(timestamp));
}

function StateMetric({ item }: { item: StateSummaryItem }) {
  return (
    <div className="min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2.5">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
          {item.label}
        </div>
        {item.status ? (
          <span
            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[item.status]}`}
            aria-label={item.status}
            title={item.status}
          />
        ) : null}
      </div>
      <div
        className={`mt-1 truncate text-lg font-semibold ${
          item.status ? STATUS_COLOR[item.status] : 'text-[var(--foreground)]'
        }`}
      >
        {item.value}
        {item.unit ? (
          <span className="ml-1 text-xs font-normal text-[var(--muted-foreground)]">
            {item.unit}
          </span>
        ) : null}
      </div>
      {item.comparison ? (
        <div className="mt-0.5 text-[12px] text-[var(--card-foreground)]">
          {item.comparison}
        </div>
      ) : null}
      {item.note ? (
        <div className="mt-1 text-[12px] leading-snug text-[var(--muted-foreground)]">
          {item.note}
        </div>
      ) : null}
    </div>
  );
}

function StateSummaryWidget({ spec }: { spec: StateSummarySpec }) {
  const sections =
    spec.sections && spec.sections.length > 0
      ? spec.sections
      : spec.items?.length > 0
        ? [{ title: 'Key values', items: spec.items }]
        : [];

  return (
    <Card className="p-4">
      <div className="mb-3 flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--foreground)]">
            {spec.title}
          </div>
          {spec.observedAt ? (
            <div className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">
              {formatObservedAt(spec.observedAt)}
            </div>
          ) : null}
        </div>
      </div>

      {spec.verdict ? (
        <div className="mb-4 rounded-md border border-[var(--border)] bg-[var(--secondary)] px-3 py-2.5">
          <div className="flex items-start gap-2">
            {spec.verdict.status ? (
              <span
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[spec.verdict.status]}`}
              />
            ) : null}
            <div className="min-w-0">
              <div
                className="text-[13px] font-semibold text-[var(--foreground)]"
              >
                {spec.verdict.label}
              </div>
              {spec.verdict.detail ? (
                <div className="mt-1 text-[12px] leading-relaxed text-[var(--muted-foreground)]">
                  {spec.verdict.detail}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        {sections.map((section, i) => (
          <section key={`${section.title}-${i}`} className="min-w-0">
            <div className="mb-2 flex min-w-0 items-baseline justify-between gap-2">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {section.title}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {section.items.map((it, idx) => (
                <StateMetric key={`${it.label}-${idx}`} item={it} />
              ))}
            </div>
            {section.interpretation ? (
              <div className="mt-2 text-[12px] leading-relaxed text-[var(--card-foreground)]">
                {section.interpretation}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </Card>
  );
}

function DetailWidgetView({ widget }: { widget: DetailWidget }) {
  switch (widget.type) {
    case 'chart':
      return <ChartWidget spec={widget.spec} />;
    case 'data_quality':
      return <DataQualityWidget spec={widget.spec} />;
    case 'state_summary':
      return <StateSummaryWidget spec={widget.spec} />;
  }
}

export function Workspace({
  widgets,
  sessionId,
  onBack,
  onNodeChartOpenChange,
  onExplainInsight,
  onOpenSettings,
  onOpenSession,
  chatInset = 0
}: {
  widgets: Widget[];
  sessionId: string;
  onBack?: () => void;
  onNodeChartOpenChange?: (open: boolean) => void;
  onExplainInsight?: (text: string) => void;
  onOpenSettings: () => void;
  onOpenSession?: (sessionId: string) => void;
  chatInset?: number;
}) {
  const { decisions, refetch } = useDecisions(sessionId);

  const topologyWidgets = useMemo(
    () => widgets.filter((w): w is TopoWidget => w.type === 'topology'),
    [widgets]
  );
  const insightWidgets = useMemo(
    () => widgets.filter((w): w is InsightWidget => w.type === 'insight_card'),
    [widgets]
  );
  const detailWidgets = useMemo(
    () =>
      widgets.filter(
        (w): w is DetailWidget =>
          w.type === 'chart' ||
          w.type === 'data_quality' ||
          w.type === 'state_summary'
      ),
    [widgets]
  );

  const decidedByCard = useMemo(() => {
    const m = new Map<string, Decision>();
    for (const d of decisions) {
      if (d.insight_card_id && !m.has(d.insight_card_id)) m.set(d.insight_card_id, d);
    }
    return m;
  }, [decisions]);

  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [activeTopo, setActiveTopo] = useState(0);
  const [drawer, setDrawer] = useState<{
    spec: ChartSpec;
    nodeId: string;
    nodeLabel: string;
  } | null>(null);

  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    onNodeChartOpenChange?.(Boolean(drawer));
  }, [drawer, onNodeChartOpenChange]);

  const activeIdx = Math.min(activeTopo, Math.max(0, topologyWidgets.length - 1));
  const activeTopology: TopoWidget | undefined = topologyWidgets[activeIdx];

  const topoIndexForNodes = (nodeIds: string[]) => {
    if (!nodeIds.length) return activeIdx;
    const idx = topologyWidgets.findIndex(w =>
      w.spec.nodes.some(n => nodeIds.includes(n.id))
    );
    return idx >= 0 ? idx : activeIdx;
  };

  const selectInsight = (w: InsightWidget) => {
    setSelectedInsightId(w.id);
    const nodes = w.spec.relatedNodeIds ?? [];
    setSelectedNodeIds(nodes);
    setActiveTopo(topoIndexForNodes(nodes));
  };

  const selectNode = async (nodeId: string) => {
    setSelectedNodeIds([nodeId]);
    const insight = insightWidgets.find(w =>
      (w.spec.relatedNodeIds ?? []).includes(nodeId)
    );
    if (insight) {
      setSelectedInsightId(insight.id);
      cardRefs.current
        .get(insight.id)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    const node = activeTopology?.spec.nodes.find(n => n.id === nodeId);
    if (node?.sensorId != null) {
      const spec = await getSeries(sessionId, node.sensorId).catch(() => null);
      setDrawer(
        spec
          ? {
              spec,
              nodeId,
              nodeLabel: node.label
            }
          : null
      );
    }
  };

  const empty = widgets.length === 0;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[image:var(--workspace-background)]">
      <header
        className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5 transition-[padding] duration-300 ease-out"
        style={{ paddingLeft: chatInset ? chatInset + 16 : undefined }}
      >
        {onBack && (
          <Button variant="ghost" onClick={onBack} aria-label="Back to dataset" className="px-2">
            <ArrowLeft />
            Dataset
          </Button>
        )}
        <LayoutDashboard size={15} className="text-[var(--muted-foreground)]" />
        <span className="text-[14px] font-medium text-[var(--foreground)]">
          Workspace
        </span>
        <span className="flex-1" />
        <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="Open settings">
          <Settings />
        </Button>
      </header>

      <WorkspaceKpiStrip
        widgets={widgets}
        decisions={decisions}
        chatInset={chatInset}
      />

      {empty ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-[var(--muted-foreground)]">
          The copilot assembles topology, charts, and insights here as it works.
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_510px] overflow-hidden">
          {/* CENTER: tabbed topology sections + node drill-down drawer */}
          <div
            className="flex min-h-0 flex-col overflow-hidden border-r border-[var(--border)] transition-[padding] duration-300 ease-out"
            style={{ paddingLeft: chatInset }}
          >
            {topologyWidgets.length > 0 && (
              <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-2">
                {topologyWidgets.map((w, i) => (
                  <button
                    key={w.id}
                    onClick={() => setActiveTopo(i)}
                    className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] ${
                      i === activeIdx
                        ? 'border-[var(--primary)] text-[var(--foreground)]'
                        : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    {w.spec.title}
                  </button>
                ))}
              </div>
            )}

            <div className="min-h-0 flex-1 p-3">
              {activeTopology ? (
                <TopologyWidget
                  key={activeTopology.id}
                  spec={activeTopology.spec}
                  onNodeClick={selectNode}
                  selectionHighlight={selectedNodeIds}
                  scrollZoom
                  fill
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-[var(--muted-foreground)]">
                  No topology yet — ask the copilot to map the system.
                </div>
              )}
            </div>

            {drawer && (
              <div className="border-t border-[var(--border)] bg-[var(--panel)] p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[12px] font-medium text-[var(--muted-foreground)]">
                    Sensor series
                  </span>
                  <Button variant="ghost" size="icon" onClick={() => setDrawer(null)} aria-label="Close">
                    <X />
                  </Button>
                </div>
                <ChartWidget
                  spec={drawer.spec}
                  height={180}
                  bare
                  selectionTarget={{
                    sessionId,
                    targetId: `node-chart:${drawer.nodeId}`,
                    relatedNodeIds: [drawer.nodeId],
                    label: drawer.nodeLabel
                  }}
                />
              </div>
            )}
          </div>

          {/* RIGHT: insights rail + detail widgets */}
          <aside className="flex min-h-0 flex-col overflow-hidden">
            <div className="px-3 py-2 text-[12px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Insights
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3">
              {insightWidgets.length === 0 && (
                <div className="text-[13px] text-[var(--muted-foreground)]">
                  Insights the copilot surfaces appear here.
                </div>
              )}
              {insightWidgets.map(w => (
                <div
                  key={w.id}
                  ref={el => {
                    if (el) cardRefs.current.set(w.id, el);
                    else cardRefs.current.delete(w.id);
                  }}
                >
                  <InsightCard
                    id={w.id}
                    spec={w.spec}
                    sessionId={sessionId}
                    selected={selectedInsightId === w.id}
                    onSelect={() => selectInsight(w)}
                    decided={decidedByCard.get(w.id)}
                    onDecided={refetch}
                    onExplain={onExplainInsight}
                    onOpenSession={onOpenSession}
                    topologies={topologyWidgets.map(t => t.spec)}
                  />
                </div>
              ))}

              {detailWidgets.map(w => (
                <WidgetFrame key={w.id} widgetId={w.id} sessionId={sessionId}>
                  <DetailWidgetView widget={w} />
                </WidgetFrame>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
