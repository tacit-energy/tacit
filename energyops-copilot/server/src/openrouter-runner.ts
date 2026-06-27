import { randomUUID } from 'node:crypto';
import { SYSTEM_PROMPT } from './prompt.js';
import { makeOpenRouterTools, type OpenRouterTool } from './openrouter-tools.js';
import type { Bus } from './bus.js';
import type { ToolContext } from './tools/context.js';

type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; name: string; content: string };

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ToolCallDraft {
  id?: string;
  name?: string;
  arguments: string;
}

export interface OpenRouterRunnerOptions {
  id: string;
  datasetId: string;
  model: string;
  apiKey?: string;
  bus: Bus;
  nextWidgetId: () => string;
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function resultText(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export class OpenRouterRunner {
  private apiKey?: string;
  private readonly model: string;
  private readonly bus: Bus;
  private readonly tools: OpenRouterTool[];
  private readonly messages: ChatMessage[];
  private abort?: AbortController;
  private busy = false;

  constructor(options: OpenRouterRunnerOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.bus = options.bus;
    const ctx: ToolContext = {
      datasetId: options.datasetId,
      sessionId: options.id,
      broadcast: options.bus.broadcast,
      nextWidgetId: options.nextWidgetId
    };
    this.tools = makeOpenRouterTools(ctx);
    this.messages = [
      {
        role: 'system',
        content: `${SYSTEM_PROMPT}\n\nYou have access to EnergyOps tools. Use them to inspect the dataset and render workspace widgets. Prefer describe_dataset first.`
      }
    ];
    this.bus.broadcast({
      kind: 'agent',
      event: { type: 'meta', provider: 'openrouter', model: this.model, sessionId: options.id }
    });
  }

  setApiKey(apiKey?: string): void {
    if (apiKey?.trim()) this.apiKey = apiKey.trim();
  }

  send(text: string, apiKey?: string): void {
    this.setApiKey(apiKey);
    if (!this.apiKey) {
      this.bus.broadcast({
        kind: 'credential_needed',
        provider: 'openrouter',
        message: 'OpenRouter API key required. Add it in Settings, then retry.'
      });
      return;
    }
    this.messages.push({ role: 'user', content: text });
    void this.runTurn();
  }

  async interrupt(): Promise<void> {
    this.abort?.abort();
  }

  private async runTurn(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const started = Date.now();
    try {
      for (let step = 0; step < 8; step += 1) {
        const outcome = await this.callModel();
        if (!outcome.toolCalls.length) {
          if (outcome.text.trim()) {
            this.messages.push({ role: 'assistant', content: outcome.text });
            this.bus.broadcast({
              kind: 'agent',
              event: { type: 'assistant_message', text: outcome.text }
            });
          }
          this.bus.broadcast({
            kind: 'agent',
            event: { type: 'turn_complete', duration_ms: Date.now() - started }
          });
          return;
        }
        this.messages.push({
          role: 'assistant',
          content: outcome.text || null,
          tool_calls: outcome.toolCalls
        });
        for (const call of outcome.toolCalls) {
          const tool = this.tools.find(t => t.name === call.function.name);
          const input = parseArgs(call.function.arguments);
          this.bus.broadcast({
            kind: 'agent',
            event: { type: 'tool_start', id: call.id, name: call.function.name, input }
          });
          if (!tool) {
            const content = `Tool not found: ${call.function.name}`;
            this.bus.broadcast({
              kind: 'agent',
              event: { type: 'tool_result', id: call.id, result: content, isError: true }
            });
            this.messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content });
            continue;
          }
          try {
            const content = resultText(await tool.execute(input));
            this.bus.broadcast({
              kind: 'agent',
              event: { type: 'tool_result', id: call.id, result: content }
            });
            this.messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content });
          } catch (err) {
            const content = String(err);
            this.bus.broadcast({
              kind: 'agent',
              event: { type: 'tool_result', id: call.id, result: content, isError: true }
            });
            this.messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content });
          }
        }
      }
      this.bus.broadcast({
        kind: 'agent',
        event: { type: 'assistant_message', text: 'I stopped after the maximum tool-loop depth. Ask me to continue if needed.' }
      });
      this.bus.broadcast({
        kind: 'agent',
        event: { type: 'turn_complete', duration_ms: Date.now() - started }
      });
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        this.bus.broadcast({ kind: 'error', error: String(err) });
      }
      this.bus.broadcast({
        kind: 'agent',
        event: { type: 'turn_complete', duration_ms: Date.now() - started }
      });
    } finally {
      this.abort = undefined;
      this.busy = false;
    }
  }

  private async callModel(): Promise<{ text: string; toolCalls: ToolCall[] }> {
    this.abort = new AbortController();
    const res = await fetch(DEFAULT_BASE_URL, {
      method: 'POST',
      signal: this.abort.signal,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'EnergyOps Copilot'
      },
      body: JSON.stringify({
        model: this.model,
        messages: this.messages,
        stream: true,
        tools: this.tools.map(tool => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }
        })),
        tool_choice: 'auto'
      })
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenRouter request failed (${res.status}): ${text || res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    const drafts = new Map<number, ToolCallDraft>();

    const processLine = (line: string) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
      const parsed = JSON.parse(data) as {
        choices?: {
          delta?: {
            content?: string;
            tool_calls?: {
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
        }[];
      };
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) return;
      if (delta.content) {
        fullText += delta.content;
        this.bus.broadcast({ kind: 'agent', event: { type: 'assistant_delta', text: delta.content } });
      }
      for (const tc of delta.tool_calls ?? []) {
        const draft = drafts.get(tc.index) ?? { arguments: '' };
        if (tc.id) draft.id = tc.id;
        if (tc.function?.name) draft.name = tc.function.name;
        if (tc.function?.arguments) draft.arguments += tc.function.arguments;
        drafts.set(tc.index, draft);
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    }
    if (buffer.trim()) processLine(buffer.trim());

    const toolCalls: ToolCall[] = [...drafts.values()]
      .filter(d => d.name)
      .map(d => ({
        id: d.id ?? `call_${randomUUID().replace(/-/g, '')}`,
        type: 'function' as const,
        function: { name: d.name!, arguments: d.arguments }
      }));
    return { text: fullText, toolCalls };
  }
}
