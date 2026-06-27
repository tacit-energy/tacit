import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  GitFork,
  MessageSquarePlus,
  Play,
  Sparkles,
  Table2
} from 'lucide-react';
import { Button, Card, Textarea } from '@/components/ui';
import {
  getDatasets,
  getSessions,
  getTables,
  getTopologies,
  startSession,
  type DatasetInfo,
  type DiagramInfo,
  type SessionRow,
  type TableInfo
} from '@/lib/api';

type Tab = 'sessions' | 'topologies' | 'data';

export function DatasetPage({
  datasetId,
  onBack,
  onOpenSession
}: {
  datasetId: string;
  onBack: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const [dataset, setDataset] = useState<DatasetInfo | null>(null);
  const [tab, setTab] = useState<Tab>('sessions');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [topologies, setTopologies] = useState<DiagramInfo[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [prompt, setPrompt] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    getDatasets().then(ds => setDataset(ds.find(d => d.id === datasetId) ?? null));
    getSessions(datasetId).then(setSessions).catch(() => {});
    getTopologies(datasetId).then(setTopologies).catch(() => {});
    getTables(datasetId).then(setTables).catch(() => {});
  }, [datasetId]);

  const start = async () => {
    setStarting(true);
    try {
      const id = await startSession(datasetId, prompt.trim() || undefined);
      onOpenSession(id);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[image:var(--workspace-background)] text-[var(--foreground)]">
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to datasets">
          <ArrowLeft />
        </Button>
        <span className="text-[15px] font-semibold">{dataset?.name ?? datasetId}</span>
        {dataset?.scenario && (
          <span className="text-[12px] text-[var(--muted-foreground)]">
            {dataset.scenario}
          </span>
        )}
      </header>

      <nav className="flex gap-1 border-b border-[var(--border)] px-3">
        {(['sessions', 'topologies', 'data'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] capitalize ${
              tab === t
                ? 'border-[var(--primary)] text-[var(--foreground)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl">
          {tab === 'sessions' && (
            <>
              {/* Launcher */}
              <Card className="p-5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles size={16} className="text-[var(--primary)]" />
                  New analysis
                </div>
                <p className="mt-1 text-[13px] text-[var(--muted-foreground)]">
                  Describe what you want to look at — or leave it blank for a general analysis.
                </p>
                <Textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start();
                  }}
                  rows={3}
                  placeholder="e.g. Something feels off this week — help me understand it."
                  className="mt-3"
                />
                <div className="mt-3 flex justify-end">
                  <Button variant="primary" onClick={start} disabled={starting}>
                    <Play size={15} /> {starting ? 'Starting…' : 'Start analysis'}
                  </Button>
                </div>
              </Card>

              {/* Existing sessions */}
              <div className="mt-6 mb-2 text-[12px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Sessions
              </div>
              {sessions.length === 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-[var(--border)] p-3 text-[13px] text-[var(--muted-foreground)]">
                  <MessageSquarePlus size={15} /> No sessions yet — start one above.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {sessions.map(s => (
                    <Card
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenSession(s.id)}
                      onKeyDown={e => e.key === 'Enter' && onOpenSession(s.id)}
                      className="flex cursor-pointer items-center gap-3 p-3 transition hover:border-[var(--primary)]"
                    >
                      <GitFork size={15} className="shrink-0 text-[var(--muted-foreground)]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{s.name}</div>
                        <div className="text-[12px] text-[var(--muted-foreground)]">
                          updated {new Date(s.updated_at).toLocaleString()}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'topologies' && (
            <div className="flex flex-col gap-2">
              {topologies.map(t => (
                <Card key={t.id} className="flex items-center gap-3 p-3">
                  <GitFork size={15} className="text-[var(--primary)]" />
                  <span className="text-[13px] font-medium">{t.name}</span>
                  <span className="text-[12px] text-[var(--muted-foreground)]">
                    {t.nodes} nodes
                  </span>
                </Card>
              ))}
              {topologies.length === 0 && (
                <div className="text-[13px] text-[var(--muted-foreground)]">
                  No topology diagrams in this dataset.
                </div>
              )}
            </div>
          )}

          {tab === 'data' && (
            <div className="flex flex-col gap-2">
              {tables.map(t => (
                <Card key={t.table} className="flex items-center gap-3 p-3">
                  <Table2 size={15} className="text-[var(--primary)]" />
                  <span className="font-mono text-[13px]">{t.table}</span>
                  <span className="text-[12px] text-[var(--muted-foreground)]">
                    {t.rows.toLocaleString()} rows
                  </span>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
