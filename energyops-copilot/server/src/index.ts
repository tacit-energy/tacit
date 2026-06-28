// Hono HTTP + SSE server. Multi-dataset, multi-session.
//   GET  /datasets
//   GET  /datasets/:id/sessions          list sessions for a dataset
//   POST /datasets/:id/sessions          { prompt?, name? } -> create + start a session
//   GET  /sessions/:id/events            SSE stream for one session
//   DELETE /sessions/:id                 delete one session
//   POST /sessions/:id/message           { text }
//   POST /sessions/:id/permission        { id, behavior, ... }
//   POST /sessions/:id/interrupt
//   GET  /sessions/:id/annotations       ?kind=&id=   (dataset-scoped)
//   POST /sessions/:id/annotation        { kind, id, text }
// Plus legacy /events|/message|/permission|/interrupt|/annotation(s) bound to a
// default session, so the pre-multi-session frontend keeps working in transit.

import './env.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import type { Context } from 'hono';
import type { Bus } from './bus.js';
import { listDatasets } from './db/datasets.js';
import { getDuck } from './db/duck.js';
import { getSensorSeries } from './db/scan.js';
import { getDiagram, listDiagrams } from './db/topology.js';
import {
  getAnnotations,
  setAnnotation,
  recordDecision,
  getDecisions,
  findSimilarDecisions,
  type AnnotationKind,
  type DecisionType
} from './db/memory.js';
import {
  createSession,
  deleteSession,
  getLiveSession,
  getSession,
  getSessionWithOptions,
  getSessionSnapshot,
  listSessionRows,
  type AgentProvider,
  type Session
} from './session.js';
import { DEFAULT_ANALYSIS_PROMPT } from './prompt.js';

if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
  console.warn(
    'Claude credentials not found. Claude sessions will fail until CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY is set; OpenRouter sessions can still run with a user key.'
  );
}

const PORT = Number(process.env.PORT ?? 3460);
const app = new Hono();
app.use('*', cors());

function sseForBus(c: Context, session: Session) {
  return streamSSE(c, async stream => {
    await stream.writeSSE({
      data: JSON.stringify({
        kind: 'agent',
        event: {
          type: 'meta',
          provider: session.provider,
          model: session.model ?? undefined,
          sessionId: session.sdkSessionId ?? session.id
        }
      })
    });
    for (const event of session.bus.getHistory()) {
      await stream.writeSSE({ data: JSON.stringify(event) });
    }
    let chain: Promise<unknown> = Promise.resolve();
    const unsubscribe = session.bus.subscribe(event => {
      chain = chain.then(() =>
        stream.writeSSE({ data: JSON.stringify(event) }).catch(() => {})
      );
    });
    const heartbeat = setInterval(() => {
      chain = chain.then(() =>
        stream.writeSSE({ data: '', event: 'ping' }).catch(() => {})
      );
    }, 25000);
    await new Promise<void>(resolve => {
      stream.onAbort(() => {
        clearInterval(heartbeat);
        unsubscribe();
        resolve();
      });
    });
  });
}

function deriveName(prompt?: string): string {
  const t = prompt?.trim();
  if (!t) return 'General analysis';
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

function withAnalysisRange(prompt: string, range?: { from?: string; to?: string }): string {
  const from = range?.from?.trim();
  const to = range?.to?.trim();
  if (!from && !to) return prompt;

  const bounds = [
    from ? `start at ${from} 00:00:00` : undefined,
    to ? `end at ${to} 23:59:59` : undefined
  ].filter(Boolean);

  return `Time range constraint: ${bounds.join(' and ')}. Limit anomaly scans, data-quality scans, SQL filters, and charts to this range unless the operator explicitly asks otherwise.\n\n${prompt}`;
}

// ---------------------------------------------------------------------------
// Datasets + sessions
// ---------------------------------------------------------------------------

app.get('/health', c => c.json({ ok: true }));
app.get('/datasets', c => c.json(listDatasets()));

app.get('/datasets/:id/sessions', c =>
  c.json(listSessionRows(c.req.param('id')))
);

app.get('/datasets/:id/topologies', c =>
  c.json(listDiagrams(c.req.param('id')))
);

app.get('/datasets/:id/topologies/:diagramId', c => {
  const id = c.req.param('id');
  if (!listDatasets().some(d => d.id === id)) return c.json(null, 404);
  const diagram = getDiagram(id, c.req.param('diagramId'));
  if (!diagram) return c.json(null, 404);
  return c.json({
    title: diagram.name,
    nodes: diagram.nodes,
    edges: diagram.edges
  });
});

app.get('/datasets/:id/tables', async c => {
  const id = c.req.param('id');
  if (!listDatasets().some(d => d.id === id)) return c.json([], 404);
  const duck = await getDuck(id);
  const out: { table: string; rows: number }[] = [];
  for (const t of duck.tables()) {
    const r = await duck.raw(`SELECT count(*) AS n FROM "${t}"`, 1);
    out.push({ table: t, rows: Number(r.rows[0]?.n ?? 0) });
  }
  return c.json(out);
});

app.get('/datasets/:id/tables/:table/rows', async c => {
  const id = c.req.param('id');
  if (!listDatasets().some(d => d.id === id)) return c.json({ error: 'unknown dataset' }, 404);

  const duck = await getDuck(id);
  const table = c.req.param('table');
  if (!duck.tables().includes(table)) return c.json({ error: 'unknown table' }, 404);

  const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1);
  const pageSize = Math.min(
    100,
    Math.max(5, Number(c.req.query('pageSize') ?? 25) || 25)
  );
  const offset = (page - 1) * pageSize;
  const quoted = `"${table.replace(/"/g, '""')}"`;
  const [count, rows] = await Promise.all([
    duck.raw(`SELECT count(*) AS n FROM ${quoted}`, 1),
    duck.raw(`SELECT * FROM ${quoted} LIMIT ${pageSize} OFFSET ${offset}`, pageSize)
  ]);

  return c.json({
    table,
    page,
    pageSize,
    totalRows: Number(count.rows[0]?.n ?? 0),
    columns: rows.columns,
    rows: rows.rows
  });
});

app.get('/datasets/:id/annotations', c => {
  const id = c.req.param('id');
  if (!listDatasets().some(d => d.id === id)) return c.json([], 404);
  const kind = c.req.query('kind') as AnnotationKind | undefined;
  const annotationId = c.req.query('id');
  return c.json(getAnnotations({ datasetId: id, kind, id: annotationId }));
});

app.get('/datasets/:id/decisions', c => {
  const id = c.req.param('id');
  if (!listDatasets().some(d => d.id === id)) return c.json([], 404);
  return c.json(getDecisions({ datasetId: id }));
});

app.post('/datasets/:id/sessions', async c => {
  const datasetId = c.req.param('id');
  if (!listDatasets().some(d => d.id === datasetId)) {
    return c.json({ error: 'unknown dataset' }, 404);
  }
  const body = await c.req
    .json<{
      prompt?: string;
      name?: string;
      range?: { from?: string; to?: string };
      provider?: AgentProvider;
      model?: string;
      claudeApiKey?: string;
      openRouterApiKey?: string;
      azureEndpoint?: string;
      azureApiKey?: string;
      includePreviousKnowledge?: boolean;
    }>()
    .catch(
      () =>
        ({}) as {
          prompt?: string;
          name?: string;
          range?: { from?: string; to?: string };
          provider?: AgentProvider;
          model?: string;
          claudeApiKey?: string;
          openRouterApiKey?: string;
          azureEndpoint?: string;
          azureApiKey?: string;
          includePreviousKnowledge?: boolean;
        }
    );
  const provider =
    body.provider === 'openrouter' || body.provider === 'azure'
      ? body.provider
      : 'claude';
  const model =
    body.model?.trim() ||
    (provider === 'openrouter'
      ? 'anthropic/claude-sonnet-4'
      : provider === 'azure'
        ? 'gpt-5.4'
        : null);
  const session = createSession(datasetId, body.name?.trim() || deriveName(body.prompt), {
    provider,
    model: model ?? undefined,
    claudeApiKey: body.claudeApiKey,
    openRouterApiKey: body.openRouterApiKey,
    azureEndpoint: body.azureEndpoint,
    azureApiKey: body.azureApiKey,
    includePreviousKnowledge: body.includePreviousKnowledge !== false
  });
  const initialPrompt = body.prompt?.trim() ? body.prompt : DEFAULT_ANALYSIS_PROMPT;
  session.send(withAnalysisRange(initialPrompt, body.range), {
    claudeApiKey: body.claudeApiKey,
    claudeModel: model ?? undefined,
    openRouterApiKey: body.openRouterApiKey,
    azureEndpoint: body.azureEndpoint,
    azureApiKey: body.azureApiKey,
    azureModel: model ?? undefined
  });
  return c.json({ id: session.id });
});

app.get('/sessions/:id/events', c => {
  const s = getLiveSession(c.req.param('id'));
  if (!s) return c.text('session is not live', 409);
  if (!s.isActive()) return c.text('session is not active', 409);
  return sseForBus(c, s);
});

app.get('/sessions/:id/snapshot', c => {
  const snapshot = getSessionSnapshot(c.req.param('id'));
  if (!snapshot) return c.json({ error: 'no such session' }, 404);
  return c.json(snapshot);
});

app.delete('/sessions/:id', async c => {
  const ok = await deleteSession(c.req.param('id'));
  return c.json({ ok }, ok ? 200 : 404);
});

app.post('/sessions/:id/message', async c => {
  const { text, claudeApiKey, claudeModel, openRouterApiKey, azureEndpoint, azureApiKey, azureModel } = await c.req.json<{
    text?: string;
    claudeApiKey?: string;
    claudeModel?: string;
    openRouterApiKey?: string;
    azureEndpoint?: string;
    azureApiKey?: string;
    azureModel?: string;
  }>();
  const s = getSessionWithOptions(c.req.param('id'), {
    claudeApiKey,
    model: claudeModel
  });
  if (!s) return c.json({ error: 'no such session' }, 404);
  if (typeof text === 'string' && text.trim()) {
    s.send(text, {
      claudeApiKey,
      claudeModel,
      openRouterApiKey,
      azureEndpoint,
      azureApiKey,
      azureModel
    });
  }
  return c.json({ ok: true });
});

app.post('/sessions/:id/provider-credentials', async c => {
  const { claudeApiKey, claudeModel, openRouterApiKey, azureEndpoint, azureApiKey, azureModel } = await c.req.json<{
    claudeApiKey?: string;
    claudeModel?: string;
    openRouterApiKey?: string;
    azureEndpoint?: string;
    azureApiKey?: string;
    azureModel?: string;
  }>();
  const s = getSessionWithOptions(c.req.param('id'), {
    claudeApiKey,
    model: claudeModel
  });
  if (!s) return c.json({ error: 'no such session' }, 404);
  s.setProviderCredentials({
    claudeApiKey,
    claudeModel,
    openRouterApiKey,
    azureEndpoint,
    azureApiKey,
    azureModel
  });
  return c.json({ ok: true });
});

app.post('/sessions/:id/permission', async c => {
  const s = getSession(c.req.param('id'));
  if (!s) return c.json({ error: 'no such session' }, 404);
  const { id, behavior, message, always, updatedInput } = await c.req.json();
  const ok = s.respondPermission(
    id,
    behavior === 'allow' ? { behavior, always, updatedInput } : { behavior, message }
  );
  return c.json({ ok }, ok ? 200 : 404);
});

app.post('/sessions/:id/interrupt', async c => {
  const s = getSession(c.req.param('id'));
  if (!s) return c.json({ error: 'no such session' }, 404);
  await s.interrupt();
  return c.json({ ok: true });
});

app.get('/sessions/:id/annotations', c => {
  const s = getSession(c.req.param('id'));
  if (!s) return c.json([]);
  const kind = c.req.query('kind') as AnnotationKind | undefined;
  const id = c.req.query('id');
  return c.json(getAnnotations({ datasetId: s.datasetId, kind, id }));
});

app.post('/sessions/:id/annotation', async c => {
  const s = getSession(c.req.param('id'));
  if (!s) return c.json({ error: 'no such session' }, 404);
  const { kind, id, text } = await c.req.json<{
    kind: AnnotationKind;
    id: string;
    text: string;
  }>();
  return c.json(setAnnotation(s.datasetId, kind, String(id), String(text ?? ''), s.id));
});

// --- Decisions (dataset-scoped, recorded directly from the UI) -------------

app.get('/sessions/:id/decisions', c => {
  const s = getSession(c.req.param('id'));
  if (!s) return c.json([]);
  return c.json(getDecisions({ datasetId: s.datasetId, sessionId: s.id }));
});

app.get('/sessions/:id/decisions/similar', c => {
  const s = getSession(c.req.param('id'));
  if (!s) return c.json([]);
  const nodeIds = c.req.query('nodeIds')?.split(',').filter(Boolean);
  const title = c.req.query('title') || undefined;
  return c.json(findSimilarDecisions({ datasetId: s.datasetId, nodeIds, title }));
});

app.post('/sessions/:id/decision', async c => {
  const s = getSession(c.req.param('id'));
  if (!s) return c.json({ error: 'no such session' }, 404);
  const body = await c.req.json<{
    insightCardId?: string;
    insightTitle?: string;
    decisionType?: string;
    rationale?: string;
    relatedNodeIds?: string[];
    impact?: number;
  }>();
  const decisionType = body.decisionType as DecisionType;
  if (!['accept', 'override', 'dismiss'].includes(decisionType)) {
    return c.json({ error: 'invalid decisionType' }, 400);
  }
  if (
    (decisionType === 'override' || decisionType === 'dismiss') &&
    !body.rationale?.trim()
  ) {
    return c.json({ error: 'rationale required for override/dismiss' }, 400);
  }
  const decision = recordDecision({
    datasetId: s.datasetId,
    sessionId: s.id,
    insightCardId: body.insightCardId,
    insightTitle: body.insightTitle ?? 'Insight',
    decisionType,
    rationale: body.rationale,
    relatedNodeIds: body.relatedNodeIds,
    impact: body.impact ?? null
  });
  // Make the agent aware on its next turn (no tool call needed).
  if (s.includePreviousKnowledge) {
    s.noteDecision(
      `You chose ${decisionType} for insight "${decision.insight_title}"` +
        (decision.rationale ? ` — ${decision.rationale}` : '') +
        '.'
    );
  }
  return c.json(decision);
});

app.get('/sessions/:id/series', async c => {
  const s = getSession(c.req.param('id'));
  if (!s) return c.json(null, 404);
  const sensorId = Number(c.req.query('sensorId'));
  if (!Number.isFinite(sensorId)) return c.json(null, 400);
  const from = c.req.query('from') || undefined;
  const to = c.req.query('to') || undefined;
  return c.json(await getSensorSeries(s.datasetId, sensorId, { from, to }));
});

// ---------------------------------------------------------------------------
// Legacy bridge — a single default session for the pre-multi-session frontend.
// Remove once the frontend uses the /sessions/* routes.
// ---------------------------------------------------------------------------

let defaultSessionId: string | null = null;
function defaultSession(): Session | undefined {
  if (defaultSessionId) {
    const s = getSession(defaultSessionId);
    if (s) return s;
  }
  const ds = listDatasets()[0];
  if (!ds) return undefined;
  const s = createSession(ds.id, 'Default session');
  defaultSessionId = s.id;
  return s;
}

app.get('/events', c => {
  const s = defaultSession();
  if (!s) return c.text('no datasets found', 404);
  return sseForBus(c, s);
});
app.post('/message', async c => {
  const { text } = await c.req.json<{ text?: string }>();
  if (typeof text === 'string' && text.trim()) defaultSession()?.send(text);
  return c.json({ ok: true });
});
app.post('/permission', async c => {
  const { id, behavior, message, always, updatedInput } = await c.req.json();
  const ok = defaultSession()?.respondPermission(
    id,
    behavior === 'allow' ? { behavior, always, updatedInput } : { behavior, message }
  );
  return c.json({ ok: !!ok }, ok ? 200 : 404);
});
app.post('/interrupt', async c => {
  await defaultSession()?.interrupt();
  return c.json({ ok: true });
});
app.get('/annotations', c => {
  const s = defaultSession();
  if (!s) return c.json([]);
  const kind = c.req.query('kind') as AnnotationKind | undefined;
  const id = c.req.query('id');
  return c.json(getAnnotations({ datasetId: s.datasetId, kind, id }));
});
app.post('/annotation', async c => {
  const s = defaultSession();
  if (!s) return c.json({ error: 'no datasets' }, 404);
  const { kind, id, text } = await c.req.json<{
    kind: AnnotationKind;
    id: string;
    text: string;
  }>();
  return c.json(setAnnotation(s.datasetId, kind, String(id), String(text ?? ''), s.id));
});

serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`EnergyOps Copilot server on http://localhost:${info.port}`);
});
