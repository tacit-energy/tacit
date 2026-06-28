const LOCALE = 'de-DE';
const TIME_ZONE = 'Europe/Berlin';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_WITHOUT_ZONE = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function parseDisplayDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (DATE_ONLY.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  const normalized = DATE_TIME_WITHOUT_ZONE.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

export function isDateLike(value: unknown): value is string {
  return typeof value === 'string' && DATE_LIKE.test(value.trim());
}

export function formatDate(value: string): string {
  const date = parseDisplayDate(value);
  if (!date) return value;

  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: DATE_ONLY.test(value.trim()) ? undefined : TIME_ZONE
  }).format(date);
}

export function formatDateTime(value: string): string {
  const date = parseDisplayDate(value);
  if (!date) return value;

  if (DATE_ONLY.test(value.trim())) return formatDate(value);

  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIME_ZONE,
    timeZoneName: 'short'
  })
    .format(date)
    .replace(/\s(MESZ|MEZ)$/, ' Uhr $1');
}

export function formatChartTick(value: string): string {
  const date = parseDisplayDate(value);
  if (!date) return value;

  if (DATE_ONLY.test(value.trim())) {
    return new Intl.DateTimeFormat(LOCALE, {
      day: '2-digit',
      month: '2-digit'
    }).format(date);
  }

  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIME_ZONE
  }).format(date);
}

export function formatChartTooltip(value: string): string {
  return formatDateTime(value);
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(LOCALE, options).format(value);
}

export function formatChartValue(
  value: unknown,
  maximumFractionDigits = 2
): string {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return value == null ? '' : String(value);

  return formatNumber(number, {
    maximumFractionDigits
  });
}

export function formatTableCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'string' && isDateLike(value)) {
    return value.trim().length === 10 ? formatDate(value) : formatDateTime(value);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
