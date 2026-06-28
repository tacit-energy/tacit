import { AlertTriangle } from 'lucide-react';
import type { DataQualitySpec } from '@shared/types';
import { Badge, Card } from '@/components/ui';

type DataQualityIssue = DataQualitySpec['issues'][number];
type DataQualityTarget = NonNullable<DataQualityIssue['targets']>[number];

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
  onTargetClick,
  getIssueTargets
}: {
  spec: DataQualitySpec;
  onTargetClick?: (
    target: DataQualityTarget,
    issue: DataQualityIssue
  ) => void;
  getIssueTargets?: (
    issue: DataQualityIssue,
    title: string
  ) => DataQualityTarget[];
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
            const targets = getIssueTargets?.(issue, spec.title) ?? issue.targets ?? [];
            return (
              <div
                key={i}
                className="flex w-full items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--background)] p-2.5 text-left"
              >
                <Badge variant={SEV_VARIANT[issue.severity]}>
                  {TYPE_LABEL[issue.type]}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-[var(--card-foreground)]">
                    {issue.sensor}
                  </div>
                  <div className="text-[12px] text-[var(--muted-foreground)]">
                    {issue.detail}
                  </div>
                  {targets.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {targets.map(target => (
                        <button
                          key={`${target.sensorId}:${target.nodeId ?? target.label}`}
                          type="button"
                          onClick={() => onTargetClick?.(target, issue)}
                          className="rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-0.5 text-[11px] font-medium text-[var(--card-foreground)] transition hover:border-[var(--primary)] hover:text-[var(--foreground)]"
                          title="Open sensor chart"
                        >
                          {target.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
