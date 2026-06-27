// Hono HTTP + SSE server. Multi-dataset, multi-session.
//   GET  /datasets
//   GET  /datasets/:id/sessions          list sessions for a dataset
//   POST /datasets/:id/sessions          { prompt?, name? } -> create + start a session
//   GET  /sessions/:id/events            SSE stream for one session
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
import { listDiagrams } from './db/topology.js';
import {
  getAnnotations,
  setAnnotation,
  type AnnotationKind
} from './db/memory.js';
import {
  createSession,
  getSession,
  listSessionRows,
  type Session
} from './session.js';
import { DEFAULT_ANALYSIS_PROMPT } from './prompt.js';

if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
  console.error(
    'No credentials found. Run `claude setup-token` and put CLAUDE_CODE_OAUTH_TOKEN in server/.env'
  );
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? 3460);
const app = new Hono();
app.use('*', cors());

function sseForBus(c: Context, bus: Bus) {
  return streamSSE(c, async stream => {
    for (const event of bus.getHistory()) {
      await stream.writeSSE({ data: JSON.stringify(event) });
    }
    let chain: Promise<unknown> = Promise.resolve();
    const unsubscribe = bus.subscribe(event => {
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

app.post('/datasets/:id/sessions', async c => {
  const datasetId = c.req.param('id');
  if (!listDatasets().some(d => d.id === datasetId)) {
    return c.json({ error: 'unknown dataset' }, 404);
  }
  const body = await c.req
    .json<{ prompt?: string; name?: string; range?: { from?: string; to?: string } }>()
    .catch(
      () =>
        ({}) as {
          prompt?: string;
          name?: string;
          range?: { from?: string; to?: string };
        }
    );
  const session = createSession(datasetId, body.name?.trim() || deriveName(body.prompt));
  const initialPrompt = body.prompt?.trim() ? body.prompt : DEFAULT_ANALYSIS_PROMPT;
  session.send(withAnalysisRange(initialPrompt, body.range));
  return c.json({ id: session.id });
});

app.get('/sessions/:id/events', c => {
  const s = getSession(c.req.param('id'));
  if (!s) return c.text('no such session', 404);
  return sseForBus(c, s.bus);
});

app.post('/sessions/:id/message', async c => {
  const s = getSession(c.req.param('id'));
  if (!s) return c.json({ error: 'no such session' }, 404);
  const { text } = await c.req.json<{ text?: string }>();
  if (typeof text === 'string' && text.trim()) s.send(text);
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
  return c.json(setAnnotation(s.datasetId, kind, String(id), String(text ?? '')));
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
  return sseForBus(c, s.bus);
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
  return c.json(setAnnotation(s.datasetId, kind, String(id), String(text ?? '')));
});

serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`EnergyOps Copilot server on http://localhost:${info.port}`);
});
