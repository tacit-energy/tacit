import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, FilePenLine, RotateCcw, StickyNote, X } from 'lucide-react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { ChartSpec, ChartType } from '@shared/types';
import { Button, Card, Textarea } from '@/components/ui';
import { postAnnotation, postDecision } from '@/lib/api';
import { formatChartTick, formatChartTooltip } from '@/lib/format';

const COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)'
];

type ChartSelectionTarget = {
  sessionId: string;
  targetId: string;
  relatedNodeIds?: string[];
  label?: string;
};

type RangeSelection = {
  from: string;
  to: string;
};

const activeLabel = (state: unknown) => {
  if (state && typeof state === 'object' && 'activeLabel' in state) {
    const label = (state as { activeLabel?: unknown }).activeLabel;
    return typeof label === 'string' ? label : undefined;
  }
  return undefined;
};

function orderedRange(x: string[], a: string, b: string): RangeSelection {
  const ia = x.indexOf(a);
  const ib = x.indexOf(b);
  if (ia < 0 || ib < 0) return { from: a, to: b };
  return ia <= ib ? { from: a, to: b } : { from: b, to: a };
}

function clampZoom(start: number, end: number, total: number): [number, number] {
  if (total <= 1) return [0, Math.max(0, total - 1)];
  const minSpan = Math.min(6, total - 1);
  let nextStart = Math.max(0, Math.min(start, total - 1));
  let nextEnd = Math.max(0, Math.min(end, total - 1));
  if (nextEnd < nextStart) [nextStart, nextEnd] = [nextEnd, nextStart];
  if (nextEnd - nextStart < minSpan) {
    const pad = minSpan - (nextEnd - nextStart);
    nextStart -= Math.floor(pad / 2);
    nextEnd += Math.ceil(pad / 2);
  }
  if (nextStart < 0) {
    nextEnd = Math.min(total - 1, nextEnd - nextStart);
    nextStart = 0;
  }
  if (nextEnd > total - 1) {
    nextStart = Math.max(0, nextStart - (nextEnd - (total - 1)));
    nextEnd = total - 1;
  }
  return [nextStart, nextEnd];
}

// Compute a y-axis domain that hugs the data instead of anchoring at 0.
// Padding scales with the data's spread (standard deviation) so flat series
// stay tight and volatile series get more breathing room.
function axisDomain(
  spec: ChartSpec,
  axisId: 'left' | 'right'
): [number, number] | undefined {
  const values: number[] = [];
  for (const s of spec.series) {
    if ((s.axis ?? 'left') !== axisId) continue;
    for (const v of s.data) if (typeof v === 'number' && isFinite(v)) values.push(v);
  }
  if (values.length === 0) return undefined;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);

  // Pad by a fraction of the spread; fall back to a sliver when the series is flat.
  const pad = std > 0 ? std * 0.4 : Math.max(Math.abs(max) * 0.02, 1);
  return [min - pad, max + pad];
}

function seriesElement(
  s: ChartSpec['series'][number],
  i: number,
  fallback: ChartType
) {
  const kind = s.kind ?? fallback;
  const color = COLORS[i % COLORS.length];
  const yAxisId = s.axis ?? 'left';
  const common = { dataKey: s.name, name: s.name, yAxisId };
  switch (kind) {
    case 'bar':
      return <Bar key={s.name} {...common} fill={color} radius={[3, 3, 0, 0]} />;
    case 'area':
      return (
        <Area
          key={s.name}
          {...common}
          type="monotone"
          stroke={color}
          fill={color}
          fillOpacity={0.18}
          strokeWidth={2}
          dot={false}
          connectNulls
        />
      );
    case 'scatter':
      return <Scatter key={s.name} {...common} fill={color} />;
    default:
      return (
        <Line
          key={s.name}
          {...common}
          type="monotone"
          stroke={color}
          strokeWidth={2}
          strokeDasharray={s.role === 'expected' ? '5 4' : undefined}
          dot={false}
          connectNulls
        />
      );
  }
}

export function ChartWidget({
  spec,
  height = 280,
  bare = false,
  selectionTarget
}: {
  spec: ChartSpec;
  height?: number;
  bare?: boolean;
  selectionTarget?: ChartSelectionTarget;
}) {
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragEnd, setDragEnd] = useState<string | null>(null);
  const [selection, setSelection] = useState<RangeSelection | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'annotation' | 'decision' | null>(null);
  const [saved, setSaved] = useState<'annotation' | 'decision' | null>(null);
  const [zoomWindow, setZoomWindow] = useState<[number, number] | null>(null);
  const chartShellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<RangeSelection | null>(null);

  useEffect(() => {
    setZoomWindow(null);
    setSelection(null);
    setDragStart(null);
    setDragEnd(null);
    dragRef.current = null;
  }, [spec]);

  const allData = useMemo(
    () =>
      spec.x.map((label, i) => {
        const row: Record<string, string | number | null> = { x: label };
        for (const s of spec.series) row[s.name] = s.data[i] ?? null;
        return row;
      }),
    [spec]
  );
  const visibleStart = zoomWindow?.[0] ?? 0;
  const visibleEnd = zoomWindow?.[1] ?? Math.max(0, allData.length - 1);
  const data = useMemo(
    () => allData.slice(visibleStart, visibleEnd + 1),
    [allData, visibleStart, visibleEnd]
  );
  const isZoomed = Boolean(zoomWindow);

  const fallback: ChartType = spec.chartType ?? 'line';
  const hasRight = spec.series.some(s => s.axis === 'right');
  const axisTick = { fill: 'var(--muted-foreground)', fontSize: 11 };
  const activeRange =
    selection ??
    (dragStart && dragEnd && dragStart !== dragEnd
      ? orderedRange(spec.x, dragStart, dragEnd)
      : null);
  const selectedMoment =
    selection && selection.from === selection.to ? selection.from : null;
  const activeMoment =
    selectedMoment ??
    (dragStart && dragEnd && dragStart === dragEnd ? dragStart : null);

  const labelAtClientX = (clientX: number) => {
    const el = chartShellRef.current;
    if (!selectionTarget || !el || data.length === 0) return undefined;
    const bounds = el.getBoundingClientRect();
    if (bounds.width <= 0) return undefined;
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    const index = Math.round(ratio * (data.length - 1));
    const label = data[index]?.x;
    return typeof label === 'string' ? label : undefined;
  };

  const updateDragSelection = (label: string) => {
    const drag = dragRef.current;
    if (!selectionTarget || !drag) return;
    dragRef.current = {
      from: drag.from,
      to: label
    };
    setDragEnd(label);
  };

  const zoomChartAt = (clientX: number, deltaY: number, bounds: DOMRect) => {
    if (!selectionTarget || spec.x.length < 3) return;
    const ratio =
      bounds.width > 0
        ? Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width))
        : 0.5;
    setZoomWindow(current => {
      const currentStart = current?.[0] ?? 0;
      const currentEnd = current?.[1] ?? spec.x.length - 1;
      const span = currentEnd - currentStart;
      const anchor = currentStart + Math.round(span * ratio);
      const direction = deltaY < 0 ? -1 : 1;
      const nextSpan =
        direction < 0
          ? Math.max(2, Math.floor(span * 0.75))
          : Math.min(spec.x.length - 1, Math.ceil(span * 1.35));
      const nextStart = anchor - Math.round(nextSpan * ratio);
      const nextEnd = nextStart + nextSpan;
      const next = clampZoom(nextStart, nextEnd, spec.x.length);
      return next[0] <= 0 && next[1] >= spec.x.length - 1 ? null : next;
    });
  };

  useEffect(() => {
    const el = chartShellRef.current;
    if (!selectionTarget || !el) return;
    const onWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      zoomChartAt(event.clientX, event.deltaY, el.getBoundingClientRect());
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [selectionTarget, spec.x.length]);

  const beginSelection = (state: unknown) => {
    if (!selectionTarget) return;
    const label = activeLabel(state);
    if (!label) return;
    dragRef.current = { from: label, to: label };
    setDragStart(label);
    setDragEnd(label);
    setSelection(null);
    setSaved(null);
  };

  const moveSelection = (state: unknown) => {
    const label = activeLabel(state);
    if (label) updateDragSelection(label);
  };

  const endSelection = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!selectionTarget || !drag) {
      setDragStart(null);
      setDragEnd(null);
      return;
    }
    setSelection(
      drag.from === drag.to
        ? { from: drag.from, to: drag.from }
        : orderedRange(spec.x, drag.from, drag.to)
    );
    setDragStart(null);
    setDragEnd(null);
  };

  const rangeText = (range: RangeSelection) =>
    range.from === range.to
      ? formatChartTooltip(range.from)
      : `${formatChartTooltip(range.from)} bis ${formatChartTooltip(range.to)}`;

  const saveAnnotation = async () => {
    if (!selectionTarget || !selection || !note.trim()) return;
    setBusy('annotation');
    try {
      await postAnnotation(selectionTarget.sessionId, {
        kind: 'widget',
        id: `${selectionTarget.targetId}:${selection.from}:${selection.to}`,
        text: [
          `Chart: ${spec.title}`,
          selectionTarget.label ? `Target: ${selectionTarget.label}` : null,
          selection.from === selection.to
            ? `Moment: ${selection.from}`
            : `Range: ${selection.from} to ${selection.to}`,
          note.trim()
        ]
          .filter(Boolean)
          .join('\n')
      });
      setSaved('annotation');
    } finally {
      setBusy(null);
    }
  };

  const saveDecision = async () => {
    if (!selectionTarget || !selection || !note.trim()) return;
    setBusy('decision');
    try {
      await postDecision(selectionTarget.sessionId, {
        insightTitle: `Chart range: ${spec.title} (${rangeText(selection)})`,
        decisionType: 'override',
        rationale: note.trim(),
        relatedNodeIds: selectionTarget.relatedNodeIds
      });
      setSaved('decision');
    } finally {
      setBusy(null);
    }
  };

  // Bar charts read best from a zero baseline; only tighten line/area/scatter.
  const leftDomain = fallback === 'bar' ? undefined : axisDomain(spec, 'left');
  const rightDomain = fallback === 'bar' ? undefined : axisDomain(spec, 'right');

  const chart = (
    <div
      ref={chartShellRef}
      className={selectionTarget ? 'select-none outline-none' : undefined}
      style={{ height }}
      tabIndex={selectionTarget ? -1 : undefined}
      onMouseDownCapture={event => {
        if (!selectionTarget) return;
        const label = labelAtClientX(event.clientX);
        if (!label) return;
        dragRef.current = { from: label, to: label };
        setDragStart(label);
        setDragEnd(label);
        setSelection(null);
        setSaved(null);
      }}
      onMouseMoveCapture={event => {
        const label = labelAtClientX(event.clientX);
        if (label) updateDragSelection(label);
      }}
      onMouseUpCapture={endSelection}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
          onMouseDown={beginSelection}
          onMouseMove={moveSelection}
          onMouseUp={endSelection}
          onMouseLeave={endSelection}
          style={
            selectionTarget
              ? {
                  cursor: 'crosshair',
                  outline: 'none',
                  userSelect: 'none',
                  WebkitUserSelect: 'none'
                }
              : undefined
          }
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="x"
            tickFormatter={value => formatChartTick(String(value))}
            tick={axisTick}
            minTickGap={32}
          />
          <YAxis
            yAxisId="left"
            tick={axisTick}
            width={48}
            domain={leftDomain ?? ['auto', 'auto']}
            allowDataOverflow={false}
          />
          {hasRight && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={axisTick}
              width={48}
              domain={rightDomain ?? ['auto', 'auto']}
              allowDataOverflow={false}
            />
          )}
          <Tooltip
            contentStyle={{
              background: 'var(--panel-strong)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12
            }}
            labelFormatter={label => formatChartTooltip(String(label))}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {spec.markBands?.map((b, i) => (
            <ReferenceArea
              key={`mb${i}`}
              x1={b.from}
              x2={b.to}
              yAxisId="left"
              fill="var(--accent)"
              fillOpacity={0.12}
              style={{ pointerEvents: 'none' }}
              label={{
                value: b.label,
                fill: 'var(--accent)',
                fontSize: 11,
                pointerEvents: 'none'
              }}
            />
          ))}
          {activeRange && (
            <ReferenceArea
              x1={activeRange.from}
              x2={activeRange.to}
              yAxisId="left"
              fill="var(--primary)"
              fillOpacity={0.16}
              stroke="var(--primary)"
              strokeOpacity={0.45}
              style={{ pointerEvents: 'none' }}
            />
          )}
          {activeMoment && (
            <ReferenceLine
              x={activeMoment}
              yAxisId="left"
              stroke="var(--primary)"
              strokeWidth={2}
              style={{ pointerEvents: 'none' }}
              label={{
                value: formatChartTick(activeMoment),
                fill: 'var(--primary)',
                fontSize: 10,
                pointerEvents: 'none'
              }}
            />
          )}
          {spec.referenceLines?.map((r, i) => (
            <ReferenceLine
              key={`rl${i}`}
              y={r.value}
              yAxisId={r.axis ?? 'left'}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              style={{ pointerEvents: 'none' }}
              label={{
                value: r.label,
                fill: 'var(--muted-foreground)',
                fontSize: 10,
                pointerEvents: 'none'
              }}
            />
          ))}
          {spec.series.map((s, i) => seriesElement(s, i, fallback))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );

  const selectionPanel = selectionTarget && selection ? (
    <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--panel-strong)] p-2.5">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--foreground)]">
          {selection.from === selection.to ? 'Moment: ' : 'Range: '}
          {rangeText(selection)}
        </div>
        <button
          type="button"
          onClick={() => {
            setSelection(null);
            setNote('');
            setSaved(null);
          }}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          aria-label="Clear selected chart range"
        >
          <X size={14} />
        </button>
      </div>
      <Textarea
        value={note}
        onChange={e => {
          setNote(e.target.value);
          setSaved(null);
        }}
        rows={2}
        placeholder="Operator context or planned action"
        className="min-h-[54px] text-[12px]"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-h-5 text-[12px] text-[var(--muted-foreground)]">
          {saved === 'annotation' ? (
            <span className="inline-flex items-center gap-1 text-[var(--accent)]">
              <Check size={13} /> Annotation saved
            </span>
          ) : saved === 'decision' ? (
            <span className="inline-flex items-center gap-1 text-[var(--accent)]">
              <Check size={13} /> Decision recorded
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={saveAnnotation}
            disabled={!!busy || !note.trim()}
          >
            <StickyNote size={14} />
            Save note
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={saveDecision}
            disabled={!!busy || !note.trim()}
          >
            <FilePenLine size={14} />
            Record decision
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  const zoomControls = selectionTarget && isZoomed ? (
    <div className="mt-1 flex justify-end">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setZoomWindow(null)}
        className="h-7 px-2 text-[12px]"
      >
        <RotateCcw size={13} />
        Reset zoom
      </Button>
    </div>
  ) : null;

  if (bare) {
    return (
      <div>
        <div className="mb-1 text-[12px] font-medium text-[var(--foreground)]">
          {spec.title}
          {spec.unit ? (
            <span className="ml-2 font-normal text-[var(--muted-foreground)]">
              ({spec.unit})
            </span>
          ) : null}
        </div>
        {chart}
        {zoomControls}
        {selectionPanel}
      </div>
    );
  }

  return (
    <Card className="p-4">
      <div className="mb-2 text-sm font-semibold text-[var(--foreground)]">
        {spec.title}
        {spec.unit ? (
          <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
            ({spec.unit})
          </span>
        ) : null}
      </div>
      {chart}
      {zoomControls}
      {selectionPanel}
    </Card>
  );
}
