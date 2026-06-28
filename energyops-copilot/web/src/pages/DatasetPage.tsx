import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Database,
  ExternalLink,
  GitFork,
  Loader2,
  MessageSquarePlus,
  Play,
  Sparkles,
  StickyNote,
  Table2,
  Trash2,
  X
} from 'lucide-react';
import { Button, Card, Textarea } from '@/components/ui';
import {
  cacheDataset,
  deleteSession,
  getDatasetAnnotations,
  getDatasetDecisions,
  getDatasets,
  getSessions,
  getTableRows,
  getTables,
  getTopology,
  getTopologies,
  startSession,
  type DatasetInfo,
  type DiagramInfo,
  type Annotation,
  type Decision,
  type SessionRow,
  type TableInfo,
  type TableRows
} from '@/lib/api';
import { sessionPath } from '@/lib/routes';
import { TopologyWidget } from '@/workspace/widgets/TopologyWidget';
import type { TopologySpec } from '@shared/types';
import type { ProviderSettings } from '@/App';
import { formatDateTime, formatNumber, formatTableCell } from '@/lib/format';

type Tab = 'sessions' | 'topologies' | 'data' | 'log';
type CacheStatus = 'idle' | 'warming' | 'ready' | 'error';

type LogEntry =
  | { type: 'decision'; at: string; item: Decision }
  | { type: 'annotation'; at: string; item: Annotation };

const tabs: { id: Tab; label: string }[] = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'topologies', label: 'Topologies' },
  { id: 'data', label: 'Data' },
  { id: 'log', label: 'Decisions and annotations' }
];

export function DatasetPage({
  datasetId,
  providerSettings,
  onBack,
  onOpenSession
}: {
  datasetId: string;
  providerSettings: ProviderSettings;
  onBack: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const [dataset, setDataset] = useState<DatasetInfo | null>(null);
  const [tab, setTab] = useState<Tab>('sessions');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [topologies, setTopologies] = useState<DiagramInfo[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTopologyId, setSelectedTopologyId] = useState<string | null>(null);
  const [topologySpec, setTopologySpec] = useState<TopologySpec | null>(null);
  const [topologyLoading, setTopologyLoading] = useState(false);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const [tableRows, setTableRows] = useState<TableRows | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [includePreviousKnowledge, setIncludePreviousKnowledge] = useState(true);
  const [starting, setStarting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SessionRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus>('idle');

  useEffect(() => {
    setSelectedTopologyId(null);
    setTopologySpec(null);
    setSelectedTable(null);
    setTablePage(1);
    setTableRows(null);
    setCacheStatus('idle');
    getDatasets().then(ds => {
      const nextDataset = ds.find(d => d.id === datasetId) ?? null;
      setDataset(nextDataset);
      if (nextDataset?.startDate) {
        setRangeFrom(nextDataset.defaultStartDate ?? nextDataset.startDate);
        if (nextDataset.defaultEndDate) {
          setRangeTo(nextDataset.defaultEndDate);
        } else if (nextDataset.days && nextDataset.days > 0) {
          const end = new Date(`${nextDataset.startDate}T00:00:00`);
          end.setDate(end.getDate() + nextDataset.days - 1);
          setRangeTo(end.toISOString().slice(0, 10));
        } else {
          setRangeTo('');
        }
      } else {
        setRangeFrom('');
        setRangeTo('');
      }
    });
    getSessions(datasetId).then(setSessions).catch(() => {});
    getTopologies(datasetId).then(setTopologies).catch(() => {});
    getTables(datasetId).then(setTables).catch(() => {});
    setAnnotations([]);
    setDecisions([]);
  }, [datasetId]);

  useEffect(() => {
    if (!selectedTopologyId) return;
    let alive = true;
    setTopologyLoading(true);
    getTopology(datasetId, selectedTopologyId)
      .then(spec => {
        if (alive) setTopologySpec(spec);
      })
      .catch(() => {
        if (alive) setTopologySpec(null);
      })
      .finally(() => {
        if (alive) setTopologyLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [datasetId, selectedTopologyId]);

  useEffect(() => {
    if (!selectedTable) return;
    let alive = true;
    setTableLoading(true);
    getTableRows(datasetId, selectedTable, tablePage)
      .then(rows => {
        if (alive) setTableRows(rows);
      })
      .catch(() => {
        if (alive) setTableRows(null);
      })
      .finally(() => {
        if (alive) setTableLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [datasetId, selectedTable, tablePage]);

  useEffect(() => {
    if (tab !== 'log') return;
    let alive = true;
    setLogLoading(true);
    Promise.all([getDatasetAnnotations(datasetId), getDatasetDecisions(datasetId)])
      .then(([nextAnnotations, nextDecisions]) => {
        if (!alive) return;
        setAnnotations(nextAnnotations);
        setDecisions(nextDecisions);
      })
      .catch(() => {
        if (!alive) return;
        setAnnotations([]);
        setDecisions([]);
      })
      .finally(() => {
        if (alive) setLogLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [datasetId, tab]);

  const totalPages = useMemo(() => {
    if (!tableRows) return 1;
    return Math.max(1, Math.ceil(tableRows.totalRows / tableRows.pageSize));
  }, [tableRows]);

  const logEntries = useMemo<LogEntry[]>(() => {
    return [
      ...decisions.map(item => ({
        type: 'decision' as const,
        at: item.created_at,
        item
      })),
      ...annotations.map(item => ({
        type: 'annotation' as const,
        at: item.updated_at,
        item
      }))
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [annotations, decisions]);

  const sessionsById = useMemo(() => {
    return new Map(sessions.map(session => [session.id, session]));
  }, [sessions]);

  const selectTable = (table: string) => {
    setSelectedTable(table);
    setTablePage(1);
  };

  const formatCell = (value: unknown) => {
    return formatTableCell(value);
  };

  const start = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const id = await startSession(
        datasetId,
        prompt.trim() || undefined,
        {
          from: rangeFrom || undefined,
          to: rangeTo || undefined
        },
        providerSettings.provider,
        providerSettings.provider === 'openrouter'
          ? providerSettings.openRouterModel
          : providerSettings.provider === 'azure'
            ? providerSettings.azureModel
            : providerSettings.claudeModel,
        providerSettings.provider === 'openrouter'
          ? providerSettings.openRouterApiKey
          : undefined,
        providerSettings.provider === 'azure'
          ? providerSettings.azureEndpoint
          : undefined,
        providerSettings.provider === 'azure'
          ? providerSettings.azureApiKey
          : undefined,
        providerSettings.provider === 'claude'
          ? providerSettings.claudeApiKey
          : undefined,
        includePreviousKnowledge
      );
      onOpenSession(id);
    } catch {
      setStarting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    setDeleteError(null);
    try {
      await deleteSession(deleteTarget.id);
      setSessions(current => current.filter(session => session.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch {
      setDeleteError('Could not delete this session. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const warmDatasetCache = async () => {
    if (cacheStatus === 'warming') return;
    setCacheStatus('warming');
    try {
      await cacheDataset(datasetId);
      setTables(await getTables(datasetId));
      setCacheStatus('ready');
    } catch {
      setCacheStatus('error');
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
        <Button
          variant="ghost"
          size="sm"
          onClick={warmDatasetCache}
          disabled={cacheStatus === 'warming'}
          title="Cache dataset summary without starting an analysis"
          className="ml-auto"
        >
          {cacheStatus === 'warming' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : cacheStatus === 'ready' ? (
            <CheckCircle2 size={14} />
          ) : (
            <Database size={14} />
          )}
          {cacheStatus === 'warming'
            ? 'Caching...'
            : cacheStatus === 'ready'
              ? 'Cached'
              : cacheStatus === 'error'
                ? 'Retry cache'
                : 'Cache dataset'}
        </Button>
      </header>

      <nav className="flex gap-1 border-b border-[var(--border)] px-3">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${
              tab === t.id
                ? 'border-[var(--primary)] text-[var(--foreground)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-6xl">
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
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-[12px] font-medium text-[var(--muted-foreground)]">
                    <span className="flex items-center gap-1.5">
                      <CalendarRange size={14} /> From
                    </span>
                    <input
                      type="date"
                      value={rangeFrom}
                      min={dataset?.startDate || undefined}
                      max={rangeTo || undefined}
                      onChange={e => setRangeFrom(e.target.value)}
                      className="h-9 rounded-md border border-[var(--input)] bg-[var(--background)] px-3 text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[12px] font-medium text-[var(--muted-foreground)]">
                    <span className="flex items-center gap-1.5">
                      <CalendarRange size={14} /> To
                    </span>
                    <input
                      type="date"
                      value={rangeTo}
                      min={rangeFrom || undefined}
                      max={dataset?.endDate || undefined}
                      onChange={e => setRangeTo(e.target.value)}
                      className="h-9 rounded-md border border-[var(--input)] bg-[var(--background)] px-3 text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-[12px] text-[var(--muted-foreground)]">
                    Provider:{' '}
                    <span className="font-medium text-[var(--foreground)]">
                      {providerSettings.provider === 'openrouter'
                        ? `OpenRouter · ${providerSettings.openRouterModel || 'model not set'}`
                        : providerSettings.provider === 'azure'
                          ? `Azure · ${providerSettings.azureModel || 'deployment not set'}`
                          : `Claude · ${providerSettings.claudeModel || 'model not set'}`}
                    </span>
                  </div>
                  <label className="flex items-center gap-2 text-[12px]">
                    <input
                      type="checkbox"
                      checked={includePreviousKnowledge}
                      onChange={e => setIncludePreviousKnowledge(e.target.checked)}
                      className="h-4 w-4 rounded border border-[var(--input)] accent-[var(--primary)]"
                    />
                    <span className="font-medium text-[var(--foreground)]">
                      Include previous knowledge
                    </span>
                  </label>
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
                      className="group flex items-center gap-3 p-3 transition hover:border-[var(--primary)] focus-within:border-[var(--primary)]"
                    >
                      <Link
                        to={sessionPath(datasetId, s.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                      >
                        <GitFork size={15} className="shrink-0 text-[var(--muted-foreground)]" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium">{s.name}</div>
                          <div className="text-[12px] text-[var(--muted-foreground)]">
                          updated {formatDateTime(s.updated_at)}
                          </div>
                        </div>
                      </Link>
                      <Button
                        variant="danger"
                        size="icon"
                        aria-label={`Delete ${s.name}`}
                        title="Delete session"
                        onClick={e => {
                          e.stopPropagation();
                          setDeleteError(null);
                          setDeleteTarget(s);
                        }}
                        onKeyDown={e => e.stopPropagation()}
                        className="h-8 w-8 opacity-100 transition duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                      >
                        <Trash2 />
                      </Button>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'topologies' && (
            <div className="grid min-h-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className="flex flex-col gap-2">
                {topologies.map(t => (
                  <Card
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedTopologyId(t.id)}
                    onKeyDown={e => e.key === 'Enter' && setSelectedTopologyId(t.id)}
                    className={`flex cursor-pointer items-center gap-3 p-3 transition hover:border-[var(--primary)] ${
                      selectedTopologyId === t.id ? 'border-[var(--primary)]' : ''
                    }`}
                  >
                    <GitFork size={15} className="shrink-0 text-[var(--primary)]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{t.name}</div>
                      <div className="text-[12px] text-[var(--muted-foreground)]">
                        {t.nodes} nodes
                      </div>
                    </div>
                  </Card>
                ))}
                {topologies.length === 0 && (
                  <div className="text-[13px] text-[var(--muted-foreground)]">
                    No topology diagrams in this dataset.
                  </div>
                )}
              </div>

              <div className="min-w-0">
                {topologyLoading && (
                  <Card className="p-4 text-[13px] text-[var(--muted-foreground)]">
                    Loading topology...
                  </Card>
                )}
                {!topologyLoading && topologySpec && (
                  <TopologyWidget spec={topologySpec} />
                )}
                {!topologyLoading && !topologySpec && topologies.length > 0 && (
                  <Card className="p-4 text-[13px] text-[var(--muted-foreground)]">
                    Select a topology to inspect the full diagram.
                  </Card>
                )}
              </div>
            </div>
          )}

          {tab === 'data' && (
            <div className="grid min-h-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className="flex flex-col gap-2">
                {tables.map(t => (
                  <Card
                    key={t.table}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectTable(t.table)}
                    onKeyDown={e => e.key === 'Enter' && selectTable(t.table)}
                    className={`flex cursor-pointer items-center gap-3 p-3 transition hover:border-[var(--primary)] ${
                      selectedTable === t.table ? 'border-[var(--primary)]' : ''
                    }`}
                  >
                    <Table2 size={15} className="shrink-0 text-[var(--primary)]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[13px]">{t.table}</div>
                      <div className="text-[12px] text-[var(--muted-foreground)]">
                        {formatNumber(t.rows)} rows
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              <Card className="min-w-0 overflow-hidden p-0">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[13px] font-semibold">
                      {selectedTable ?? 'Select a data type'}
                    </div>
                    {tableRows && (
                      <div className="text-[12px] text-[var(--muted-foreground)]">
                        {formatNumber(tableRows.totalRows)} rows
                      </div>
                    )}
                  </div>
                  {tableRows && (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setTablePage(p => Math.max(1, p - 1))}
                        disabled={tableLoading || tablePage <= 1}
                        aria-label="Previous page"
                      >
                        <ChevronLeft />
                      </Button>
                      <span className="text-[12px] text-[var(--muted-foreground)]">
                        {tablePage} / {totalPages}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setTablePage(p => Math.min(totalPages, p + 1))}
                        disabled={tableLoading || tablePage >= totalPages}
                        aria-label="Next page"
                      >
                        <ChevronRight />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="overflow-auto">
                  {tableLoading && (
                    <div className="p-4 text-[13px] text-[var(--muted-foreground)]">
                      Loading rows...
                    </div>
                  )}
                  {!tableLoading && !tableRows && (
                    <div className="p-4 text-[13px] text-[var(--muted-foreground)]">
                      Choose a data type to preview paginated rows.
                    </div>
                  )}
                  {!tableLoading && tableRows && (
                    <table className="w-full border-collapse text-left text-[12px]">
                      <thead className="sticky top-0 bg-[var(--secondary)]">
                        <tr>
                          {tableRows.columns.map(column => (
                            <th
                              key={column}
                              className="border-b border-[var(--border)] px-3 py-2 font-medium text-[var(--muted-foreground)]"
                            >
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tableRows.rows.map((row, rowIndex) => (
                          <tr
                            key={rowIndex}
                            className="border-b border-[var(--border)] last:border-b-0"
                          >
                            {tableRows.columns.map(column => (
                              <td
                                key={column}
                                className="max-w-[260px] truncate px-3 py-2 font-mono"
                                title={formatCell(row[column])}
                              >
                                {formatCell(row[column])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </Card>
            </div>
          )}

          {tab === 'log' && (
            <div className="min-w-0">
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <Card className="flex items-center gap-3 p-3">
                  <div className="grid h-9 w-9 place-items-center rounded-md bg-[var(--primary)]/12 text-[var(--primary)]">
                    <ClipboardList size={17} />
                  </div>
                  <div>
                    <div className="text-[18px] font-semibold">{decisions.length}</div>
                    <div className="text-[12px] text-[var(--muted-foreground)]">
                      Decisions
                    </div>
                  </div>
                </Card>
                <Card className="flex items-center gap-3 p-3">
                  <div className="grid h-9 w-9 place-items-center rounded-md bg-[var(--primary)]/12 text-[var(--primary)]">
                    <StickyNote size={17} />
                  </div>
                  <div>
                    <div className="text-[18px] font-semibold">{annotations.length}</div>
                    <div className="text-[12px] text-[var(--muted-foreground)]">
                      Annotations
                    </div>
                  </div>
                </Card>
              </div>

              {logLoading && (
                <Card className="p-4 text-[13px] text-[var(--muted-foreground)]">
                  Loading log...
                </Card>
              )}

              {!logLoading && logEntries.length === 0 && (
                <Card className="p-4 text-[13px] text-[var(--muted-foreground)]">
                  No decisions or annotations recorded for this dataset yet.
                </Card>
              )}

              {!logLoading && logEntries.length > 0 && (
                <div className="flex flex-col gap-3">
                  {logEntries.map(entry => {
                    if (entry.type === 'decision') {
                      const d = entry.item;
                      const savedSession = d.session_id
                        ? sessionsById.get(d.session_id)
                        : undefined;
                      return (
                        <Card key={`decision-${d.id}`} className="p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <ClipboardList
                                size={16}
                                className="shrink-0 text-[var(--primary)]"
                              />
                              <div className="min-w-0">
                                <div className="truncate text-[13px] font-semibold">
                                  {d.insight_title}
                                </div>
                                <div className="mt-0.5 flex flex-wrap gap-2 text-[12px] text-[var(--muted-foreground)]">
                                  <span>{d.decision_type}</span>
                                  {savedSession ? (
                                    <span>{savedSession.name}</span>
                                  ) : d.session_id ? (
                                    <span>session deleted</span>
                                  ) : null}
                                  <span>{formatDateTime(d.created_at)}</span>
                                </div>
                              </div>
                            </div>
                            {savedSession && (
                              <Button
                                asChild
                                size="sm"
                                variant="ghost"
                              >
                                <Link to={sessionPath(datasetId, savedSession.id)}>
                                  <ExternalLink size={14} />
                                  Open session
                                </Link>
                              </Button>
                            )}
                          </div>
                          {d.rationale && (
                            <p className="mt-3 whitespace-pre-wrap text-[13px] leading-5">
                              {d.rationale}
                            </p>
                          )}
                          {d.related_node_ids.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {d.related_node_ids.map(nodeId => (
                                <span
                                  key={nodeId}
                                  className="rounded border border-[var(--border)] px-2 py-0.5 font-mono text-[11px] text-[var(--muted-foreground)]"
                                >
                                  {nodeId}
                                </span>
                              ))}
                            </div>
                          )}
                        </Card>
                      );
                    }

                    const a = entry.item;
                    const savedSession = a.source_session_id
                      ? sessionsById.get(a.source_session_id)
                      : undefined;
                    return (
                      <Card
                        key={`annotation-${a.target_kind}-${a.target_id}`}
                        className="p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <StickyNote
                              size={16}
                              className="shrink-0 text-[var(--primary)]"
                            />
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-semibold">
                                {a.target_kind} {a.target_id}
                              </div>
                              <div className="mt-0.5 flex flex-wrap gap-2 text-[12px] text-[var(--muted-foreground)]">
                                {savedSession ? (
                                  <span>{savedSession.name}</span>
                                ) : a.source_session_id ? (
                                  <span>session deleted</span>
                                ) : null}
                                <span>
                                  updated {formatDateTime(a.updated_at)}
                                </span>
                              </div>
                            </div>
                          </div>
                          {savedSession && (
                            <Button
                              asChild
                              size="sm"
                              variant="ghost"
                            >
                              <Link to={sessionPath(datasetId, savedSession.id)}>
                                <ExternalLink size={14} />
                                Open session
                              </Link>
                            </Button>
                          )}
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-[13px] leading-5">
                          {a.text}
                        </p>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <AnimatePresence>
        {starting && (
          <motion.div
            key="starting-analysis"
            className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-[var(--background)] px-6 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <Loader2 size={34} className="animate-spin text-[var(--primary)]" />
            <div className="text-lg font-semibold text-[var(--foreground)]">
              Analyzing system
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center bg-black/55 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => {
              if (!deletingId) setDeleteTarget(null);
            }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-session-title"
              className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--popover)] p-4 text-[var(--popover-foreground)] shadow-2xl"
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[var(--destructive)]/15 text-[var(--destructive)]">
                  <Trash2 size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 id="delete-session-title" className="text-[14px] font-semibold">
                    Delete session?
                  </h2>
                  <p className="mt-1 text-[13px] leading-5 text-[var(--muted-foreground)]">
                    This will remove "{deleteTarget.name}" and its saved session decisions.
                  </p>
                  {deleteError && (
                    <p className="mt-3 rounded-md border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 text-[12px] text-[var(--destructive)]">
                      {deleteError}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close dialog"
                  disabled={!!deletingId}
                  onClick={() => setDeleteTarget(null)}
                  className="h-8 w-8"
                >
                  <X />
                </Button>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  disabled={!!deletingId}
                  onClick={() => setDeleteTarget(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  disabled={!!deletingId}
                  onClick={confirmDelete}
                >
                  <Trash2 size={15} />
                  {deletingId ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
