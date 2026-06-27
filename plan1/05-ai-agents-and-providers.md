# Spec 05: AI Agents, Providers & Robust Parsing

This is the integration core. Three design goals:

1. **Real prompts, real LLM calls** — no faked AI logic inside the app.
2. **Swappable AI backend at runtime** — Claude (default) or OpenAI, selected in Settings, with an offline Demo provider. UI/agents never import a concrete SDK.
3. **Never crash on model output** — every response goes through `extractJSON` with try/catch and a deterministic seed-data fallback.

---

## 1. Provider Abstraction

### Interface (`src/ai/providers/types.ts`)

```ts
export interface LLMRequest {
  system: string;
  user: string;
  maxTokens?: number;        // default per provider
}

export interface LLMResult {
  text: string;              // raw assistant text (may contain markdown fences)
  provider: ProviderId;
  model: string;
}

export interface LLMProvider {
  id: ProviderId;
  isConfigured(): boolean;   // true if a usable key/model is present
  complete(req: LLMRequest): Promise<LLMResult>;
}
```

All agents depend only on `LLMProvider`. Switching backends = returning a different implementation from the registry.

### Registry (`src/ai/providerRegistry.ts`)

```ts
import { useAppStore } from '../store/useAppStore';

export function getProvider(): LLMProvider {
  const { settings } = useAppStore.getState();
  if (settings.demoMode) return demoProvider;          // Demo Mode short-circuits everything
  switch (settings.provider) {
    case 'anthropic': return makeAnthropicProvider(settings.providers.anthropic);
    case 'openai':    return makeOpenAIProvider(settings.providers.openai);
    case 'demo':      return demoProvider;
  }
}
```

- Reads settings **fresh on every call**, so flipping the provider in Settings affects the next agent call with no re-wiring. This is what makes the backend dynamically switchable.
- If the selected provider `!isConfigured()` → agents log a warning and fall back to seed data (Spec 06), exactly as if a parse failed.

### Anthropic provider (`src/ai/providers/anthropic.ts`) — default

Uses the official SDK `@anthropic-ai/sdk`, model **`claude-opus-4-8`** by default.

```ts
import Anthropic from '@anthropic-ai/sdk';

export function makeAnthropicProvider(cfg: ProviderConfig): LLMProvider {
  return {
    id: 'anthropic',
    isConfigured: () => !!cfg.apiKey,
    async complete({ system, user, maxTokens = 4096 }) {
      const client = new Anthropic({
        apiKey: cfg.apiKey,
        dangerouslyAllowBrowser: true,   // REQUIRED for browser use — see Security
      });
      const resp = await client.messages.create({
        model: cfg.model || 'claude-opus-4-8',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      });
      const text = resp.content
        .filter(b => b.type === 'text')
        .map(b => (b as { text: string }).text)
        .join('\n');
      return { text, provider: 'anthropic', model: resp.model };
    },
  };
}
```

Notes:
- Default `max_tokens` 4096 (Agent 1 may need more for big topologies — pass `maxTokens: 8000`). Keep below the non-streaming timeout zone; we don't stream in the prototype.
- Guard `resp.stop_reason === 'refusal'` → treat as a parse failure → seed fallback.
- Do **not** send `temperature`, `top_p`, or `budget_tokens` — they are rejected on `claude-opus-4-8`. Thinking is optional; if used, `thinking: { type: 'adaptive' }` only.
- Structured output: we rely on prompt + `extractJSON` (the brief mandates a robust string-cleaning parser). `output_config.format` (JSON schema) is a possible hardening later, but `extractJSON` must exist regardless because OpenAI/other backends and markdown-wrapping make it necessary.

### OpenAI provider (`src/ai/providers/openai.ts`)

Uses the `openai` SDK, default model `gpt-4o`.

```ts
import OpenAI from 'openai';

export function makeOpenAIProvider(cfg: ProviderConfig): LLMProvider {
  return {
    id: 'openai',
    isConfigured: () => !!cfg.apiKey,
    async complete({ system, user, maxTokens = 4096 }) {
      const client = new OpenAI({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true });
      const resp = await client.chat.completions.create({
        model: cfg.model || 'gpt-4o',
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      const text = resp.choices[0]?.message?.content ?? '';
      return { text, provider: 'openai', model: resp.model };
    },
  };
}
```

### Demo provider (`src/ai/providers/demo.ts`)

No network. `complete()` is never actually used for logic in Demo Mode — the agents short-circuit to seed data before calling it (Spec 06). It exists so the registry always returns a valid `LLMProvider` and `isConfigured()` is `true`.

---

## 2. Key Resolution & Security

### Resolution order (per provider)

1. Runtime value from Settings (`settings.providers[id].apiKey`), if non-empty.
2. Else `import.meta.env.VITE_ANTHROPIC_API_KEY` / `VITE_OPENAI_API_KEY`.
3. Else empty → `isConfigured()` false → seed fallback.

Same pattern for model (`VITE_ANTHROPIC_MODEL` / `VITE_OPENAI_MODEL`) and default provider (`VITE_LLM_PROVIDER`). The store seeds `settings` from env on init; the Settings modal overrides at runtime.

### Security caveats (prototype-only, document them)

- `dangerouslyAllowBrowser: true` ships the user's API key to the browser and makes raw provider calls from the client. This is acceptable **only** for a local hackathon prototype with the user's own key. Call this out in the README and Settings modal.
- API keys are **stripped from exported state** by default (`stripSecrets`, Spec 03 §4).
- For any real deployment, move LLM calls behind a server proxy and remove `dangerouslyAllowBrowser`. Out of scope here, but the provider abstraction makes that a one-file change (swap the provider impl to call your proxy endpoint).

---

## 3. Agents (`src/ai/agents.ts`)

Each agent: build prompt → `getProvider().complete()` → `extractJSON()` → validate/normalize → return; on any failure, return the seed fallback and set `ui.lastError` with a non-fatal notice.

```ts
export async function runUnderstandingAgent(
  rawSensors: RawSensor[], provider = getProvider()
): Promise<TopologyData> { /* Agent 1 */ }

export async function runAnomalyAgent(
  topology: TopologyData, timeSeries: TimeSeriesData[], provider = getProvider()
): Promise<AnomalyData[]> { /* Agent 2 */ }

export async function runMemoryAgent(
  anomaly: AnomalyData, memory: DecisionMemory[], provider = getProvider()
): Promise<MemoryRecall> { /* Agent 3 */ }
```

Each wraps the call:

```ts
try {
  const { text } = await provider.complete({ system, user, maxTokens });
  const json = extractJSON<TExpected>(text);          // throws on irrecoverable
  return normalize(json);                              // clamp/validate (Spec 02 §10)
} catch (e) {
  console.warn('[agentX] falling back to seed data:', e);
  useAppStore.getState().setError('AI step failed — using demo data.');
  return SEED_FALLBACK;
}
```

In **Demo Mode**, the agent returns the deterministic seed immediately and skips `complete()` (Spec 06).

---

## 4. Prompts (`src/ai/prompts.ts`)

Utility functions that construct the concrete system/user prompts from current state. Verbatim from the brief, with explicit JSON-only instructions.

### Agent 1 — Understanding (Topology Simplifier)

```ts
export function buildAgent1Prompt(rawSensors: RawSensor[]): LLMRequest {
  const system =
    'You are an industrial system architect. I will provide a list of raw IoT ' +
    'sensors and their locations. Your task is to extract the 5 to 10 most ' +
    'critical components (e.g., Main Chiller, Heat Exchanger, Return Valve) and ' +
    'their relationships. Aggregate multiple similar nodes if useful. Output ONLY ' +
    'a valid JSON object with "nodes" and "edges" optimized for a ReactFlow graph. ' +
    'Collapse irrelevant subsystems. ' +
    'Each node: {id, type, name, status: "ok"|"warning"|"critical"}. ' +
    'Each edge: {id, source, target}. Do not include any prose or markdown fences.';
  const user = JSON.stringify({ rawSensors }, null, 0);
  return { system, user, maxTokens: 8000 };
}
```

### Agent 2 — Anomaly

```ts
export function buildAgent2Prompt(
  topology: TopologyData, timeSeries: TimeSeriesData[], dateRange: { from: string; to: string }
): LLMRequest {
  const system =
    'You are an anomaly detection agent. Analyze the provided time-series data ' +
    'for the given topology. Identify any physical inconsistencies (e.g., ' +
    'temperature rising while cooling pump is active). Return a JSON array of ' +
    'anomalies. Each must include "description", "relatedNodeIds", a ' +
    '"confidenceScore" (0-100), and a "confidenceType" (either "rule_based_data" ' +
    'or "ai_inferred"). Distinguish clearly between definitive rule-breaks and ' +
    'unusual patterns. Output ONLY the JSON array, no prose or markdown.';
  const user = JSON.stringify({ topology, timeSeries, dateRange }, null, 0);
  return { system, user, maxTokens: 4000 };
}
```

### Agent 3 — Compounding Memory (the core innovation)

```ts
export function buildAgent3Prompt(
  anomaly: AnomalyData, decisionMemory: DecisionMemory[]
): LLMRequest {
  const system =
    'You are a contextual memory agent. A new anomaly has been detected: ' +
    '{current_anomaly}. Review the provided historical decision log: ' +
    '{decision_memory}. Determine if a highly similar situation occurred in the ' +
    'past. If yes, extract the human rationale and action taken. Output a JSON ' +
    'object with "isRelated": true, "pastRationale": "...", and ' +
    '"suggestedAction": "...". If no relation exists, return "isRelated": false. ' +
    'Do not hallucinate connections. Output ONLY the JSON object.';
  const user = JSON.stringify(
    { current_anomaly: anomaly, decision_memory: decisionMemory }, null, 0
  );
  return { system, user, maxTokens: 1500 };
}
```

> The `{current_anomaly}` / `{decision_memory}` placeholders are kept in the system text (matching the brief) and the actual data is supplied in the user message as JSON. Models handle this reliably; it also keeps the system prompt static for prompt-cache friendliness if we later add caching.

---

## 5. Robust JSON Parsing (`src/ai/extractJSON.ts`)

Mandated by the brief. Strips markdown fences, trims conversational text, and `try/catch`es before parsing. On irrecoverable failure it **throws** (the agent's try/catch then falls back to seed data — the UI never crashes).

```ts
export function extractJSON<T>(raw: string): T {
  if (!raw) throw new Error('empty LLM response');

  let s = raw.trim();

  // 1. Strip ```json ... ``` or ``` ... ``` fences.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // 2. If there's leading/trailing prose, slice from the first { or [ to its match.
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  const start =
    firstArr === -1 ? firstObj
    : firstObj === -1 ? firstArr
    : Math.min(firstObj, firstArr);
  if (start === -1) throw new Error('no JSON found in response');
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  const end = s.lastIndexOf(close);
  if (end === -1 || end < start) throw new Error('unbalanced JSON in response');
  s = s.slice(start, end + 1);

  // 3. Parse with try/catch.
  try {
    return JSON.parse(s) as T;
  } catch (e) {
    throw new Error('JSON.parse failed: ' + (e as Error).message);
  }
}
```

- Handles the common failure modes: ```` ```json ```` fences, a leading "Here is the JSON:" sentence, and trailing commentary.
- Does **not** attempt to repair invalid JSON (e.g. trailing commas) — if `JSON.parse` fails, we fall back to seed data deterministically rather than risk a half-parsed object. (A `jsonrepair` dependency is an optional later upgrade.)
- `normalize()` (per agent) runs after parse to clamp scores, coerce `confidenceType`, drop dangling node refs, and inject `status: 'open'` / generated ids (Spec 02 §10).

---

## 6. Switching Backends — End-to-End

1. User opens **Settings**, picks **OpenAI**, pastes a key, sets model `gpt-4o`.
2. `setProvider('openai')` + `setProviderConfig('openai', { apiKey, model })` update the store.
3. Next time any agent runs, `getProvider()` reads fresh settings → returns the OpenAI provider.
4. The exact same prompts and `extractJSON` pipeline run; only the transport differs.
5. "Test connection" in Settings calls `getProvider().complete({ system: 'ping', user: 'Reply with the single word OK.' })` and reports success/failure — a quick way to validate the active backend on stage.

This satisfies the user's requirement: **the AI backend is changeable dynamically at runtime**, defaulting to Claude (`claude-opus-4-8`), with OpenAI and an offline Demo backend available.
