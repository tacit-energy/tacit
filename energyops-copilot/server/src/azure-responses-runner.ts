import { randomUUID } from 'node:crypto';
import { SYSTEM_PROMPT } from './prompt.js';
import { makeOpenRouterTools, type OpenRouterTool } from './openrouter-tools.js';
import type { Bus } from './bus.js';
import type { ToolContext } from './tools/context.js';

interface AzureResponsesRunnerOptions {
  id: string;
  datasetId: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  bus: Bus;
  nextWidgetId: () => string;
}

interface FunctionCall {
  id?: string;
  call_id?: string;
  name: string;
  arguments: string;
}

const defaultInstructions = `${SYSTEM_PROMPT}\n\nYou have access to EnergyOps tools. Use them to inspect the dataset and render workspace widgets. Prefer describe_dataset first.`;

const resultText = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value);

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export class AzureResponsesRunner {
  private apiKey?: string;
  private endpoint: string;
  private model: string;
  private readonly bus: Bus;
  private readonly tools: OpenRouterTool[];
  private abort?: AbortController;
  private busy = false;
  private previousResponseId: string | null = null;
  private pendingInputs: unknown[] = [];

  constructor(options: AzureResponsesRunnerOptions) {
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint;
    this.model = options.model;
    this.bus = options.bus;
    const ctx: ToolContext = {
      datasetId: options.datasetId,
      sessionId: options.id,
      broadcast: options.bus.broadcast,
      nextWidgetId: options.nextWidgetId
    };
    this.tools = makeOpenRouterTools(ctx);
    this.bus.broadcast({
      kind: 'agent',
      event: { type: 'meta', provider: 'azure', model: this.model, sessionId: options.id }
    });
  }

  setCredentials(input: { apiKey?: string; endpoint?: string; model?: string }): void {
    if (input.apiKey?.trim()) this.apiKey = input.apiKey.trim();
    if (input.endpoint?.trim()) this.endpoint = input.endpoint.trim();
    if (input.model?.trim()) this.model = input.model.trim();
  }

  send(
    text: string,
    credentials?: { azureApiKey?: string; azureEndpoint?: string; azureModel?: string }
  ): void {
    this.setCredentials({
      apiKey: credentials?.azureApiKey,
      endpoint: credentials?.azureEndpoint,
      model: credentials?.azureModel
    });
    if (!this.apiKey || !this.endpoint || !this.model) {
      this.bus.broadcast({
        kind: 'credential_needed',
        provider: 'azure',
        message: 'Azure endpoint, deployment/model, and API key are required. Add them in Settings, then retry.'
      });
      return;
    }
    this.pendingInputs.push({ role: 'user', content: text });
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
        const outcome = await this.callResponses(this.pendingInputs);
        this.pendingInputs = [];
        if (outcome.responseId) this.previousResponseId = outcome.responseId;

        if (!outcome.functionCalls.length) {
          if (outcome.text.trim()) {
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

        const toolOutputs: unknown[] = [];
        for (const call of outcome.functionCalls) {
          const id = call.call_id ?? call.id ?? `call_${randomUUID().replace(/-/g, '')}`;
          const tool = this.tools.find(t => t.name === call.name);
          const input = parseArgs(call.arguments);
          this.bus.broadcast({
            kind: 'agent',
            event: { type: 'tool_start', id, name: call.name, input }
          });
          if (!tool) {
            const output = `Tool not found: ${call.name}`;
            this.bus.broadcast({
              kind: 'agent',
              event: { type: 'tool_result', id, result: output, isError: true }
            });
            toolOutputs.push({ type: 'function_call_output', call_id: id, output });
            continue;
          }
          try {
            const output = resultText(await tool.execute(input));
            this.bus.broadcast({
              kind: 'agent',
              event: { type: 'tool_result', id, result: output }
            });
            toolOutputs.push({ type: 'function_call_output', call_id: id, output });
          } catch (err) {
            const output = String(err);
            this.bus.broadcast({
              kind: 'agent',
              event: { type: 'tool_result', id, result: output, isError: true }
            });
            toolOutputs.push({ type: 'function_call_output', call_id: id, output });
          }
        }
        this.pendingInputs = toolOutputs;
      }
      this.bus.broadcast({
        kind: 'agent',
        event: {
          type: 'assistant_message',
          text: 'I stopped after the maximum tool-loop depth. Ask me to continue if needed.'
        }
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

  private async callResponses(input: unknown[]): Promise<{
    text: string;
    functionCalls: FunctionCall[];
    responseId?: string;
  }> {
    this.abort = new AbortController();
    const body: Record<string, unknown> = {
      model: this.model,
      instructions: defaultInstructions,
      input,
      stream: true,
      tools: this.tools.map(tool => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }))
    };
    if (this.previousResponseId) body.previous_response_id = this.previousResponseId;

    const res = await fetch(this.endpoint, {
      method: 'POST',
      signal: this.abort.signal,
      headers: {
        'api-key': this.apiKey!,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`Azure Responses request failed (${res.status}): ${text || res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let responseId: string | undefined;
    const functionCalls: FunctionCall[] = [];
    const addFunctionCall = (call: FunctionCall) => {
      const key = call.call_id ?? call.id ?? `${call.name}:${call.arguments}`;
      if (
        functionCalls.some(
          existing => (existing.call_id ?? existing.id ?? `${existing.name}:${existing.arguments}`) === key
        )
      ) {
        return;
      }
      functionCalls.push(call);
    };

    const processLine = (line: string) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
      const event = JSON.parse(data) as {
        type?: string;
        delta?: string;
        response?: { id?: string; output?: unknown[] };
        item?: unknown;
      };
      if (event.type === 'response.output_text.delta' && event.delta) {
        fullText += event.delta;
        this.bus.broadcast({
          kind: 'agent',
          event: { type: 'assistant_delta', text: event.delta }
        });
      }
      if (event.type === 'response.output_item.done' && event.item) {
        const item = event.item as { type?: string; name?: string; arguments?: string; call_id?: string; id?: string };
        if (item.type === 'function_call' && item.name) {
          addFunctionCall({
            id: item.id,
            call_id: item.call_id,
            name: item.name,
            arguments: item.arguments ?? ''
          });
        }
      }
      if (event.response?.id) responseId = event.response.id;
      for (const item of event.response?.output ?? []) {
        const out = item as { type?: string; name?: string; arguments?: string; call_id?: string; id?: string };
        if (out.type === 'function_call' && out.name) {
          addFunctionCall({
            id: out.id,
            call_id: out.call_id,
            name: out.name,
            arguments: out.arguments ?? ''
          });
        }
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
    return { text: fullText, functionCalls, responseId };
  }
}
