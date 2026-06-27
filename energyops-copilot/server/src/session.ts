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
import { SYSTEM_PROMPT } from './prompt.js';
import {
  insertSession,
  setSdkSessionId,
  getSessionRow,
  listSessions,
  touchSession,
  type SessionRow
} from './db/memory.js';

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
  readonly bus = new Bus();
  sdkSessionId: string | null = null;

  private widgetSeq = 0;
  private inputQueue = createInputQueue();
  private pending = new Map<
    string,
    { resolve: (a: PermissionAnswer) => void; suggestions: PermissionUpdate[] }
  >();
  private handle: ReturnType<typeof query>;

  constructor(id: string, datasetId: string, resume?: string) {
    this.id = id;
    this.datasetId = datasetId;

    const tools = makeEoTools({
      datasetId,
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
        ...(resume ? { resume } : {})
      }
    });
    void this.pump();
  }

  private pump = async (): Promise<void> => {
    try {
      for await (const message of this.handle) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = message as any;
        if (m?.type === 'system' && m.subtype === 'init' && m.session_id) {
          this.sdkSessionId = m.session_id;
          setSdkSessionId(this.id, m.session_id);
        }
        this.bus.broadcast({ kind: 'sdk', message });
      }
    } catch (err) {
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

  send(text: string): void {
    touchSession(this.id);
    this.inputQueue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: ''
    });
  }

  respondPermission(id: string, answer: PermissionAnswer): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    p.resolve(answer);
    return true;
  }

  async interrupt(): Promise<void> {
    await this.handle.interrupt();
  }
}

// --- Manager ---------------------------------------------------------------

const live = new Map<string, Session>();

export function createSession(datasetId: string, name: string): Session {
  const id = randomUUID();
  insertSession({ id, dataset_id: datasetId, name });
  const s = new Session(id, datasetId);
  live.set(id, s);
  return s;
}

/** Get a live session, resuming it from the store (SDK `resume`) if needed. */
export function getSession(id: string): Session | undefined {
  const existing = live.get(id);
  if (existing) return existing;
  const row = getSessionRow(id);
  if (!row) return undefined;
  const s = new Session(id, row.dataset_id, row.sdk_session_id ?? undefined);
  live.set(id, s);
  return s;
}

export function listSessionRows(datasetId: string): SessionRow[] {
  return listSessions(datasetId);
}
