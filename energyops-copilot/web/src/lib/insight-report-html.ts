import type { InsightCardSpec } from '@shared/types';
import type { Decision } from './api';

const COLORS = ['#2563eb', '#d97706', '#dc2626', '#059669'];

export function downloadInsightHtmlReport({
  insightCardId,
  insight,
  relatedDecisions
}: {
  insightCardId?: string;
  insight: InsightCardSpec;
  relatedDecisions?: Pick<Decision, 'decision_type' | 'rationale' | 'created_at'>[];
}) {
  const filename = `${slug(insight.title) || insightCardId || 'insight-report'}.html`;
  const html = buildInsightHtml(insight, relatedDecisions ?? []);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildInsightHtml(
  insight: InsightCardSpec,
  relatedDecisions: Pick<Decision, 'decision_type' | 'rationale' | 'created_at'>[]
) {
  const severity = insight.severity === 'act' ? 'Action' : insight.severity === 'watch' ? 'Watch' : 'Info';
  const impact = insight.impact
    ? `${formatNumber(insight.impact.value)}${insight.impact.unit ? ` ${escapeHtml(insight.impact.unit)}` : ''}${
        insight.impact.confidence ? ` (${insight.impact.confidence} confidence)` : ''
      }`
    : 'Not quantified';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(insight.title)}</title>
  <style>
    :root { color-scheme: light; --text:#111827; --muted:#4b5563; --line:#d1d5db; --panel:#f8fafc; --blue:#2563eb; --warn:#d97706; --danger:#dc2626; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #e5e7eb; color: var(--text); font-family: Inter, IBM Plex Sans, Segoe UI, Arial, sans-serif; }
    main { width: min(900px, calc(100vw - 32px)); margin: 32px auto; background: white; border: 1px solid var(--line); border-radius: 10px; padding: 34px; box-shadow: 0 16px 44px rgba(15, 23, 42, 0.12); }
    header { border-bottom: 2px solid var(--text); padding-bottom: 16px; margin-bottom: 22px; }
    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.15; letter-spacing: 0; }
    h2 { margin: 24px 0 8px; font-size: 15px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
    p { font-size: 14px; line-height: 1.65; margin: 0; }
    ul { margin: 8px 0 0; padding-left: 20px; }
    li { margin: 5px 0; font-size: 13px; line-height: 1.45; }
    .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 18px 0 8px; }
    .cell { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; background: var(--panel); }
    .label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 4px; }
    .value { font-size: 14px; font-weight: 700; }
    .sev-info { color: var(--blue); } .sev-watch { color: var(--warn); } .sev-act { color: var(--danger); }
    .chart { margin-top: 10px; border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
    .chart-title { font-size: 13px; font-weight: 700; margin-bottom: 10px; }
    .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; color: var(--muted); font-size: 12px; }
    .legend span::before { content: ""; display: inline-block; width: 18px; height: 3px; margin-right: 6px; vertical-align: middle; background: var(--legend-color); }
    .foot { margin-top: 28px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }
    @media print { body { background: white; } main { width: auto; margin: 0; border: 0; border-radius: 0; box-shadow: none; } .no-print { display:none; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(insight.title)}</h1>
      <p>EnergyOps insight report - generated ${escapeHtml(new Date().toLocaleString())}</p>
    </header>
    <section class="meta">
      <div class="cell"><span class="label">Severity</span><span class="value sev-${insight.severity}">${severity}</span></div>
      <div class="cell"><span class="label">Impact</span><span class="value">${impact}</span></div>
      <div class="cell"><span class="label">Related nodes</span><span class="value">${escapeHtml(insight.relatedNodeIds?.join(', ') || 'None')}</span></div>
    </section>
    <h2>Summary</h2>
    <p>${escapeHtml(insight.summary)}</p>
    ${listSection('Evidence', insight.evidence)}
    ${listSection('Recommended actions', insight.recommendations)}
    ${chartSection(insight)}
    ${decisionsSection(relatedDecisions)}
    <div class="foot">Use your browser print dialog to save this report as PDF.</div>
  </main>
</body>
</html>`;
}

function listSection(title: string, items?: string[]) {
  if (!items?.length) return '';
  return `<h2>${escapeHtml(title)}</h2><ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function decisionsSection(rows: Pick<Decision, 'decision_type' | 'rationale' | 'created_at'>[]) {
  if (!rows.length) return '';
  return `<h2>Related prior decisions</h2><ul>${rows
    .slice(0, 4)
    .map(row => `<li>${escapeHtml([row.created_at, row.decision_type, row.rationale].filter(Boolean).join(' - '))}</li>`)
    .join('')}</ul>`;
}

function chartSection(insight: InsightCardSpec) {
  const chart = insight.chart;
  if (!chart?.x.length || !chart.series.length) return '';
  const width = 760;
  const height = 280;
  const pad = { left: 52, right: 18, top: 16, bottom: 42 };
  const values = chart.series.flatMap(s => s.data).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const xFor = (index: number) => pad.left + (index / Math.max(1, chart.x.length - 1)) * (width - pad.left - pad.right);
  const yFor = (value: number) => pad.top + ((max - value) / range) * (height - pad.top - pad.bottom);
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(t => {
      const y = pad.top + t * (height - pad.top - pad.bottom);
      const value = max - t * range;
      return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e5e7eb"/><text x="8" y="${y + 4}" font-size="11" fill="#6b7280">${escapeHtml(formatNumber(value))}</text>`;
    })
    .join('');
  const lines = chart.series
    .slice(0, 4)
    .map((series, seriesIndex) => {
      const points = series.data
        .map((value, index) => (typeof value === 'number' && Number.isFinite(value) ? `${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}` : ''))
        .filter(Boolean)
        .join(' ');
      if (!points) return '';
      const dash = series.role === 'expected' ? ' stroke-dasharray="6 5"' : '';
      return `<polyline points="${points}" fill="none" stroke="${COLORS[seriesIndex % COLORS.length]}" stroke-width="2.4"${dash}/>`;
    })
    .join('');
  const legend = chart.series
    .slice(0, 4)
    .map((series, index) => `<span style="--legend-color:${COLORS[index % COLORS.length]}">${escapeHtml(series.name)}</span>`)
    .join('');
  return `<h2>Supporting chart</h2><div class="chart"><div class="chart-title">${escapeHtml(chart.title)}${chart.unit ? ` (${escapeHtml(chart.unit)})` : ''}</div><svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${escapeHtml(chart.title)}">${grid}<line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#9ca3af"/><line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="#9ca3af"/>${lines}</svg><div class="legend">${legend}</div></div>`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
