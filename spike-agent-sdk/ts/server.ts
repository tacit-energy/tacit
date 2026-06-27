import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname, basename, relative, sep } from 'node:path';
import { z } from 'zod';
import {
  query,
  tool,
  createSdkMcpServer,
  type SDKUserMessage,
  type PermissionResult,
  type PermissionUpdate
} from '@anthropic-ai/claude-agent-sdk';

// Load CLAUDE_CODE_OAUTH_TOKEN (and any other vars) from the .env next to this
// file. Node 20.12+/22 ships process.loadEnvFile natively, so no dependency.
try {
  process.loadEnvFile(fileURLToPath(new URL('.env', import.meta.url)));
} catch {
  // .env is optional; fall back to the ambient environment.
}

if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  console.error(
    'CLAUDE_CODE_OAUTH_TOKEN is not set. Run `claude setup-token` first.'
  );
  process.exit(1);
}

const PORT = 3456;
const __dirname = dirname(fileURLToPath(import.meta.url));

// Sample "external data source": a folder of building energy/heating files the
// agent can browse and read via the list_data_files / read_data_file tools.
const DATA_DIR = join(__dirname, 'data');

// ---------------------------------------------------------------------------
// Sample custom tool (in-process MCP server)
// ---------------------------------------------------------------------------

const demoTools = createSdkMcpServer({
  name: 'demo',
  version: '1.0.0',
  tools: [
    tool(
      'get_sensor_reading',
      'Read the current temperature of a sensor in a building. Demo tool returning fake data.',
      {
        building: z.string().describe("Building name, e.g. 'Hauptstrasse 12'"),
        sensor: z.string().describe("Sensor id, e.g. 'boiler-1' or 'flow-temp'")
      },
      async ({ building, sensor }) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              building,
              sensor,
              temperature_c: Number((40 + Math.random() * 40).toFixed(1)),
              timestamp: new Date().toISOString()
            })
          }
        ]
      })
    ),
    tool(
      'list_data_files',
      'List every available sample data file in the building monitoring dataset. Returns relative paths you can pass to read_data_file. Call this first to discover what data exists.',
      {},
      async () => {
        const entries = await readdir(DATA_DIR, { recursive: true });
        const files = entries
          .filter(rel => statSync(join(DATA_DIR, rel)).isFile())
          .map(rel => rel.split(sep).join('/'))
          .sort();
        return { content: [{ type: 'text', text: files.join('\n') }] };
      }
    ),
    tool(
      'read_data_file',
      'Read a sample data file by its relative path (from list_data_files), e.g. "buildings.json" or "readings/seestrasse-8.csv". Returns the raw file contents.',
      {
        path: z
          .string()
          .describe('Relative path within the dataset, e.g. "readings/hauptstrasse-12.csv"')
      },
      async ({ path: rel }) => {
        const abs = resolve(DATA_DIR, rel);
        // Sandbox: never read outside the dataset directory.
        if (abs !== DATA_DIR && !abs.startsWith(DATA_DIR + sep)) {
          return {
            content: [
              { type: 'text', text: `Error: "${rel}" is outside the data directory.` }
            ],
            isError: true
          };
        }
        const text = await readFile(abs, 'utf8');
        return { content: [{ type: 'text', text }] };
      }
    ),
    tool(
      'display_chart',
      'Display an interactive chart directly in the chat UI. Prefer this over generating image files when the user asks for a plot or visualization.',
      {
        title: z.string().describe('Chart title'),
        chart_type: z.enum(['line', 'bar', 'scatter']).describe('Chart type'),
        x: z
          .array(z.string())
          .describe('X axis category labels, e.g. timestamps'),
        series: z
          .array(
            z.object({
              name: z.string().describe('Series name shown in the legend'),
              data: z
                .array(z.number().nullable())
                .describe('Y values, one per x label; null for gaps')
            })
          )
          .describe('One or more data series')
      },
      async spec => {
        broadcast({ kind: 'widget', widget: 'chart', spec: spec as ChartSpec });
        return {
          content: [
            {
              type: 'text',
              text: `Chart "${spec.title}" is now displayed to the user in the chat.`
            }
          ]
        };
      }
    ),
    tool(
      'show_image',
      'Display an image file (e.g. a generated plot PNG) directly in the chat UI.',
      {
        file_path: z
          .string()
          .describe('Path to the image file (png, jpg, gif, svg)')
      },
      async ({ file_path }) => {
        const abs = resolve(file_path);
        const data = await readFile(abs);
        const ext = extname(abs).toLowerCase().slice(1);
        const mime =
          ext === 'svg'
            ? 'image/svg+xml'
            : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
        broadcast({
          kind: 'widget',
          widget: 'image',
          title: basename(abs),
          src: `data:${mime};base64,${data.toString('base64')}`
        });
        return {
          content: [
            {
              type: 'text',
              text: `Image ${file_path} is now displayed to the user in the chat.`
            }
          ]
        };
      }
    )
  ]
});

// ---------------------------------------------------------------------------
// SSE broadcasting: every event is stored (for reconnects) and pushed live
// ---------------------------------------------------------------------------

type ChartSpec = {
  title: string;
  chart_type: 'line' | 'bar' | 'scatter';
  x: string[];
  series: { name: string; data: (number | null)[] }[];
};

type ServerEvent =
  | { kind: 'sdk'; message: unknown }
  | {
      kind: 'permission_request';
      id: string;
      toolName: string;
      input: unknown;
      suggestions: PermissionUpdate[];
    }
  | { kind: 'permission_resolved'; id: string; behavior: 'allow' | 'deny' }
  | { kind: 'widget'; widget: 'chart'; spec: ChartSpec }
  | { kind: 'widget'; widget: 'image'; title: string; src: string }
  | { kind: 'error'; error: string };

const history: ServerEvent[] = [];
const sseClients = new Set<http.ServerResponse>();

function broadcast(event: ServerEvent) {
  history.push(event);
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

// ---------------------------------------------------------------------------
// Permission bridge: canUseTool parks a promise until the browser answers
// ---------------------------------------------------------------------------

type PermissionAnswer =
  | {
      behavior: 'allow';
      always?: boolean;
      updatedInput?: Record<string, unknown>;
    }
  | { behavior: 'deny'; message?: string };

const pendingPermissions = new Map<
  string,
  {
    resolve: (answer: PermissionAnswer) => void;
    input: Record<string, unknown>;
    suggestions: PermissionUpdate[];
  }
>();

async function canUseTool(
  toolName: string,
  input: Record<string, unknown>,
  options: { suggestions?: PermissionUpdate[]; toolUseID: string }
): Promise<PermissionResult> {
  // Our in-process demo tools are read-only / safe, so auto-approve them for a
  // smooth demo. Built-in tools (Bash, Write, …) still go through the UI prompt.
  if (toolName.startsWith('mcp__demo__')) {
    return { behavior: 'allow', updatedInput: input };
  }

  const id = options.toolUseID;
  const suggestions = options.suggestions ?? [];

  const answer = await new Promise<PermissionAnswer>(resolve => {
    pendingPermissions.set(id, { resolve, input, suggestions });
    broadcast({ kind: 'permission_request', id, toolName, input, suggestions });
  });
  pendingPermissions.delete(id);
  broadcast({ kind: 'permission_resolved', id, behavior: answer.behavior });

  if (answer.behavior === 'allow') {
    return {
      behavior: 'allow',
      updatedInput: answer.updatedInput ?? input,
      updatedPermissions: answer.always ? suggestions : undefined
    };
  }
  return {
    behavior: 'deny',
    message: answer.message || 'User denied this action'
  };
}

// ---------------------------------------------------------------------------
// Agent session: one streaming-input query for the server's lifetime
// ---------------------------------------------------------------------------

function createInputQueue() {
  const items: SDKUserMessage[] = [];
  const waiters: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
  return {
    push(msg: SDKUserMessage) {
      const waiter = waiters.shift();
      if (waiter) waiter({ value: msg, done: false });
      else items.push(msg);
    },
    [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
      return {
        next: () => {
          const value = items.shift();
          return value !== undefined
            ? Promise.resolve({ value, done: false })
            : new Promise(resolve => waiters.push(resolve));
        }
      };
    }
  };
}

const inputQueue = createInputQueue();

const SYSTEM_PROMPT = `You are the Cosmos hardware agent, an assistant for monitoring and analyzing building energy and heating systems.

Data:
- A sample dataset of buildings is available through tools. Call list_data_files to see what exists, then read_data_file to load a file (start with "buildings.json" for the index, then the per-building CSVs under readings/ and notes under notes/).
- Readings are daily for the last 30 days. Columns: date, outdoor_temp_c, flow_temp_c, return_temp_c, energy_kwh. Temperatures are in °C, energy in kWh/day.

Behavior:
- When the user asks about a building, read its data first instead of guessing.
- When the user asks for a plot, trend, or comparison, use the display_chart tool to render it directly in the chat (pass the dates as x labels and one series per metric/building). Only generate image files if the user explicitly asks for a file.
- Use get_sensor_reading for a live spot reading of a sensor.
- Keep answers short and easy to understand for non-technical users; avoid jargon.`;

const session = query({
  prompt: inputQueue,
  options: {
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: SYSTEM_PROMPT
    },
    mcpServers: { demo: demoTools },
    includePartialMessages: true,
    canUseTool
  }
});

(async () => {
  try {
    for await (const message of session) {
      broadcast({ kind: 'sdk', message });
    }
  } catch (err) {
    broadcast({ kind: 'error', error: String(err) });
  }
})();

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(join(__dirname, 'public', 'index.html')));
    return;
  }

  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    for (const event of history)
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    sseClients.add(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/message') {
    const { text } = JSON.parse(await readBody(req));
    inputQueue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: ''
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && req.url === '/permission') {
    const { id, behavior, message, always, updatedInput } = JSON.parse(
      await readBody(req)
    );
    const pending = pendingPermissions.get(id);
    if (!pending) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no pending permission with that id' }));
      return;
    }
    pending.resolve(
      behavior === 'allow'
        ? { behavior, always, updatedInput }
        : { behavior, message }
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && req.url === '/interrupt') {
    await session.interrupt();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`Agent web UI running at http://localhost:${PORT}`);
});
