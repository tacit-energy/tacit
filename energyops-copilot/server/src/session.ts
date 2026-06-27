// One agent conversation = one Session. Each holds its own streaming query()
// bound to its dataset's tools, its own event Bus, and its own permission state.
// Sessions are resumable: we persist the SDK session id and pass `resume` on
// re-attach (the SDK auto-persists the transcript to disk).

import './env.js';
import { randomUUID } from 'node:crypto';
import {
  query,
  type SDKUserMessage,
  type PermissionResult,
  type PermissionUpdate
} from '@anthropic-ai/claude-agent-sdk';
import { Bus } from './bus.js';
import { makeEoTools } from './tools/index.js';
import { AzureResponsesRunner } from './azure-responses-runner.js';
import { OpenRouterRunner } from './openrouter-runner.js';
import { SYSTEM_PROMPT } from './prompt.js';
import type { ServerEvent } from './types.js';
import {
  insertSession,
  setSdkSessionId,
  getSessionRow,
  listSessions,
  deleteSessionRow,
  touchSession,
  getDecisions,
  appendSessionEvent,
  getSessionEvents,
  type SessionRow
} from './db/memory.js';

export type AgentProvider = 'claude' | 'openrouter' | 'azure';

export interface SessionOptions {
  provider?: AgentProvider;
  model?: string;
  openRouterApiKey?: string;
  azureApiKey?: string;
  azureEndpoint?: string;
  resume?: string | null;
}

export type PermissionAnswer =
  | { behavior: 'allow'; always?: boolean; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message?: string };

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

export class Session {
  readonly id: string;
  readonly datasetId: string;
  readonly provider: AgentProvider;
  readonly model: string | null;
  readonly bus: Bus;
  sdkSessionId: string | null = null;

  private widgetSeq = 0;
  private firstMessage = true;
  private pendingContext: string[] = [];
  private inputQueue = createInputQueue();
  private pending = new Map<
    string,
    { resolve: (a: PermissionAnswer) => void; suggestions: PermissionUpdate[] }
  >();
  private handle: ReturnType<typeof query> | null = null;
  private openRouter: OpenRouterRunner | null = null;
  private azure: AzureResponsesRunner | null = null;
  private activeTurn = false;

  constructor(id: string, datasetId: string, options: SessionOptions = {}) {
    this.id = id;
    this.datasetId = datasetId;
    this.provider = options.provider ?? 'claude';
    this.model = options.model ?? null;
    this.bus = new Bus(getSessionEvents(id), event =>
      appendSessionEvent(this.id, event)
    );
    this.bus.subscribe(event => {
      if (
        event.kind === 'agent' &&
        event.event.type === 'turn_complete'
      ) {
        this.activeTurn = false;
      } else if (event.kind === 'error' || event.kind === 'credential_needed') {
        this.activeTurn = false;
      }
    });

    if (this.provider === 'openrouter') {
      this.openRouter = new OpenRouterRunner({
        id,
        datasetId,
        model: this.model ?? 'anthropic/claude-sonnet-4',
        apiKey: options.openRouterApiKey,
        bus: this.bus,
        nextWidgetId: () => `w${++this.widgetSeq}`
      });
      return;
    }
    if (this.provider === 'azure') {
      this.azure = new AzureResponsesRunner({
        id,
        datasetId,
        endpoint: options.azureEndpoint ?? '',
        model: this.model ?? 'gpt-5.4',
        apiKey: options.azureApiKey,
        bus: this.bus,
        nextWidgetId: () => `w${++this.widgetSeq}`
      });
      return;
    }

    const tools = makeEoTools({
      datasetId,
      sessionId: id,
      broadcast: this.bus.broadcast,
      nextWidgetId: () => `w${++this.widgetSeq}`
    });

    this.handle = query({
      prompt: this.inputQueue,
      options: {
        systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_PROMPT },
        mcpServers: { eo: tools },
        includePartialMessages: true,
        canUseTool: this.canUseTool,
        ...(options.resume ? { resume: options.resume } : {})
      }
    });
    void this.pump();
  }

  private pump = async (): Promise<void> => {
    if (!this.handle) return;
    try {
      for await (const message of this.handle) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = message as any;
        if (m?.type === 'system' && m.subtype === 'init' && m.session_id) {
          this.sdkSessionId = m.session_id;
          setSdkSessionId(this.id, m.session_id);
        }
        if (m?.type === 'result') {
          this.activeTurn = false;
        }
        this.bus.broadcast({ kind: 'sdk', message });
      }
    } catch (err) {
      this.activeTurn = false;
      this.bus.broadcast({ kind: 'error', error: String(err) });
    }
  };

  private canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    options: { suggestions?: PermissionUpdate[]; toolUseID: string }
  ): Promise<PermissionResult> => {
    if (toolName.startsWith('mcp__')) {
      return { behavior: 'allow', updatedInput: input };
    }
    const id = options.toolUseID;
    const suggestions = options.suggestions ?? [];
    const answer = await new Promise<PermissionAnswer>(resolve => {
      this.pending.set(id, { resolve, suggestions });
      this.bus.broadcast({ kind: 'permission_request', id, toolName, input, suggestions });
    });
    this.pending.delete(id);
    this.bus.broadcast({ kind: 'permission_resolved', id, behavior: answer.behavior });
    if (answer.behavior === 'allow') {
      return {
        behavior: 'allow',
        updatedInput: answer.updatedInput ?? input,
        updatedPermissions: answer.always ? suggestions : undefined
      };
    }
    return { behavior: 'deny', message: answer.message || 'User denied this action' };
  };

  /** Queue a context note (e.g. an operator decision) for the agent's next turn. */
  noteDecision(text: string): void {
    this.pendingContext.push(text);
  }

  send(
    text: string,
    credentials?: {
      openRouterApiKey?: string;
      azureApiKey?: string;
      azureEndpoint?: string;
      azureModel?: string;
    }
  ): void {
    touchSession(this.id);
    this.activeTurn = true;
    this.bus.broadcast({ kind: 'agent', event: { type: 'user_message', text } });

    const prefix: string[] = [];
    if (this.firstMessage) {
      this.firstMessage = false;
      const prior = getDecisions({ datasetId: this.datasetId, limit: 10 });
      if (prior.length) {
        const lines = prior.map(
          d =>
            `- ${d.decision_type} "${d.insight_title}"${d.rationale ? `: ${d.rationale}` : ''}`
        );
        prefix.push(
          `Prior operator decisions for this dataset (most recent first):\n${lines.join('\n')}`
        );
      }
    }
    if (this.pendingContext.length) {
      prefix.push(...this.pendingContext);
      this.pendingContext = [];
    }

    const content = prefix.length
      ? `[Context]\n${prefix.join('\n\n')}\n\n${text}`
      : text;

    if (this.provider === 'openrouter') {
      this.openRouter?.send(content, credentials?.openRouterApiKey);
    } else if (this.provider === 'azure') {
      this.azure?.send(content, credentials);
    } else {
      this.inputQueue.push({
        type: 'user',
        message: { role: 'user', content },
        parent_tool_use_id: null,
        session_id: ''
      });
    }
  }

  setProviderCredentials(credentials: {
    openRouterApiKey?: string;
    azureApiKey?: string;
    azureEndpoint?: string;
    azureModel?: string;
  }): void {
    this.openRouter?.setApiKey(credentials.openRouterApiKey);
    this.azure?.setCredentials({
      apiKey: credentials.azureApiKey,
      endpoint: credentials.azureEndpoint,
      model: credentials.azureModel
    });
  }

  markTurnComplete(): void {
    this.activeTurn = false;
  }

  isActive(): boolean {
    return this.activeTurn;
  }

  respondPermission(id: string, answer: PermissionAnswer): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    p.resolve(answer);
    return true;
  }

  async interrupt(): Promise<void> {
    if (this.provider === 'openrouter') {
      await this.openRouter?.interrupt();
    } else if (this.provider === 'azure') {
      await this.azure?.interrupt();
    } else {
      await this.handle?.interrupt();
    }
  }
}

// --- Manager ---------------------------------------------------------------

const live = new Map<string, Session>();

export function createSession(
  datasetId: string,
  name: string,
  options: SessionOptions = {}
): Session {
  const id = randomUUID();
  insertSession({
    id,
    dataset_id: datasetId,
    name,
    provider: options.provider ?? 'claude',
    model: options.model ?? null
  });
  const s = new Session(id, datasetId, options);
  live.set(id, s);
  return s;
}

/** Get a live session, resuming it from the store (SDK `resume`) if needed. */
export function getSession(id: string): Session | undefined {
  const existing = live.get(id);
  if (existing) return existing;
  const row = getSessionRow(id);
  if (!row) return undefined;
  const s = new Session(id, row.dataset_id, {
    provider: row.provider ?? 'claude',
    model: row.model ?? undefined,
    resume: row.sdk_session_id ?? undefined
  });
  live.set(id, s);
  return s;
}

export function getLiveSession(id: string): Session | undefined {
  return live.get(id);
}

export function getSessionSnapshot(id: string):
  | { row: SessionRow; live: boolean; events: ServerEvent[] }
  | undefined {
  const row = getSessionRow(id);
  if (!row) return undefined;
  const existing = live.get(id);
  const active = existing?.isActive() ?? false;
  return {
    row,
    live: active,
    events: active ? [] : getSessionEvents(id)
  };
}

export function listSessionRows(datasetId: string): SessionRow[] {
  return listSessions(datasetId);
}

export async function deleteSession(id: string): Promise<boolean> {
  const existing = live.get(id);
  if (existing) {
    await existing.interrupt().catch(() => {});
    live.delete(id);
  }
  return deleteSessionRow(id);
}
