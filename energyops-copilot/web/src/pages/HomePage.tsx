import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Database, FolderPlus, Settings } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { TacitBrand } from '@/components/TacitBrand';
import { getDatasets, type DatasetInfo } from '@/lib/api';
import { datasetPath } from '@/lib/routes';

export function HomePage({
  onOpenSettings
}: {
  onOpenSettings: () => void;
}) {
  const [datasets, setDatasets] = useState<DatasetInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDatasets()
      .then(setDatasets)
      .catch(e => setError(String(e)));
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[image:var(--workspace-background)] text-[var(--foreground)]">
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-3">
        <TacitBrand />
        <span className="flex-1" />
        <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="Settings">
          <Settings />
        </Button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-xl font-semibold">Datasets</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Select a dataset to explore, or drop a new folder into{' '}
            <code className="rounded bg-[var(--background)] px-1 py-0.5">datasets/</code>{' '}
            to add one.
          </p>

          {error && (
            <div className="mt-4 rounded-md border border-[var(--destructive)] p-3 text-sm text-[var(--destructive)]">
              Couldn't load datasets: {error}
            </div>
          )}

          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {datasets?.map(d => (
              <Link
                key={d.id}
                to={datasetPath(d.id)}
                className="block rounded-[var(--radius)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <Card className="h-full cursor-pointer p-4 transition hover:border-[var(--primary)]">
                  <div className="flex items-center gap-2">
                    <Database size={16} className="text-[var(--primary)]" />
                    <span className="font-medium">{d.name}</span>
                  </div>
                  {d.narrative && (
                    <p className="mt-2 line-clamp-2 text-[13px] text-[var(--muted-foreground)]">
                      {d.narrative}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--muted-foreground)]">
                    {d.sensors != null && <span>{d.sensors} sensors</span>}
                    {d.diagrams != null && <span>{d.diagrams} topolog{d.diagrams === 1 ? 'y' : 'ies'}</span>}
                    {d.days != null && <span>{d.days} days</span>}
                  </div>
                </Card>
              </Link>
            ))}

            {datasets && datasets.length === 0 && (
              <Card className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-[var(--muted-foreground)]">
                <FolderPlus size={20} />
                No datasets yet. Drop a folder with{' '}
                <code className="rounded bg-[var(--background)] px-1">sensors.csv</code>{' '}
                into <code className="rounded bg-[var(--background)] px-1">datasets/</code>.
              </Card>
            )}

            {!datasets && !error && (
              <div className="text-sm text-[var(--muted-foreground)]">Loading…</div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
