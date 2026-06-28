import { AlertTriangle } from 'lucide-react';
import type { DataQualitySpec } from '@shared/types';
import { Badge, Card } from '@/components/ui';

type DataQualityIssue = DataQualitySpec['issues'][number];

const SEV_VARIANT: Record<
  DataQualityIssue['severity'],
  'outline' | 'warning' | 'danger'
> = {
  low: 'outline',
  med: 'warning',
  high: 'danger'
};

const TYPE_LABEL: Record<DataQualityIssue['type'], string> = {
  gap: 'Gap',
  stale: 'Stale',
  unit_mismatch: 'Unit',
  inconsistent: 'Inconsistent'
};

export function DataQualityWidget({
  spec,
  onIssueClick,
  canOpenIssue
}: {
  spec: DataQualitySpec;
  onIssueClick?: (issue: DataQualityIssue, title: string) => void;
  canOpenIssue?: (issue: DataQualityIssue, title: string) => boolean;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
        <AlertTriangle size={15} className="text-[var(--chart-4)]" />
        {spec.title}
        <span className="text-[12px] font-normal text-[var(--muted-foreground)]">
          {spec.issues.length} issue{spec.issues.length === 1 ? '' : 's'}
        </span>
      </div>

      {spec.issues.length === 0 ? (
        <div className="rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[12px] text-[var(--muted-foreground)]">
          No data-quality issues found in this scope.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {spec.issues.map((issue, i) => {
            const canOpen = Boolean(onIssueClick && canOpenIssue?.(issue, spec.title));
            return (
              <button
                key={i}
                type="button"
                disabled={!canOpen}
                onClick={() => onIssueClick?.(issue, spec.title)}
                title={
                  canOpen
                    ? 'Open sensor chart'
                    : 'No sensor id or matching topology node stored for this issue'
                }
                className="flex w-full items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] p-2.5 text-left transition hover:border-[var(--primary)] disabled:cursor-default disabled:opacity-100 disabled:hover:border-[var(--border)]"
              >
                <Badge variant={SEV_VARIANT[issue.severity]}>
                  {TYPE_LABEL[issue.type]}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-[var(--card-foreground)]">
                    {issue.sensor || 'Unmapped issue'}
                  </div>
                  <div className="text-[12px] text-[var(--muted-foreground)]">
                    {issue.detail}
                  </div>
                  {!canOpen ? (
                    <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                      No linked sensor chart
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
