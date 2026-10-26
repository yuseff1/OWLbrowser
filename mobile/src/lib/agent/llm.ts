// OpenAI-compatible chat-completions client. Port of desktop src/main/agents/llm.ts for React Native
// (no Node streams; tool calls are non-streamed, which is what the agent loop needs).
import { appStore, app } from '@/state/app';
import type { ModelRef, ModelProvider } from '@/lib/types';

export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export type LlmToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type LlmTool = { type: 'function'; function: { name: string; description: string; parameters: any } };
export type LlmResponse = { content: string; toolCalls: LlmToolCall[]; usage: number; finish: string };

export class LlmError extends Error {
  status?: number;
  constructor(msg: string, status?: number) { super(msg); this.status = status; }
}

export function resolveModel(ref?: ModelRef | null): { ref: ModelRef; provider: ModelProvider } {
  const { providers, settings } = appStore.get();
  const r = ref ?? settings.defaultModel;
  const p = r && providers.find((x) => x.id === r.providerId);
  if (r && p) return { ref: r, provider: p };
  for (const x of providers) {
    if (!x.enabled || !x.models.length) continue;
    if (x.local || x.hasKey) return { ref: { providerId: x.id, model: x.models[0] }, provider: x };
  }
  throw new LlmError('No AI model is set up yet. Open Settings → Models to add an API key or a model running on your network (Ollama / LM Studio).');
}

export async function headersFor(p: ModelProvider): Promise<Record<string, string>> {
  const key = await app.providerKey(p.id);
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) h['Authorization'] = `Bearer ${key}`;
  if (p.kind === 'anthropic' && key) { h['x-api-key'] = key; h['anthropic-version'] = '2023-06-01'; }
  if (p.kind === 'openrouter') { h['HTTP-Referer'] = 'https://owl.varsen.tech'; h['X-Title'] = 'OWL Mobile'; }
  return h;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with a timeout that also honours an outer abort signal (Hermes has no AbortSignal.timeout/any). */
export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number; signal?: AbortSignal | null } = {}) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  init.signal?.addEventListener?.('abort', onAbort);
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 60000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
    init.signal?.removeEventListener?.('abort', onAbort);
  }
}

export async function chat(opts: {
  model?: ModelRef | null;
  messages: LlmMessage[];
  tools?: LlmTool[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<LlmResponse> {
  const { ref, provider: p } = resolveModel(opts.model);
  const body: any = { model: ref.model, messages: opts.messages, temperature: opts.temperature ?? 0.3 };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.tools?.length) { body.tools = opts.tools; body.tool_choice = 'auto'; }
  const headers = await headersFor(p);

  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (opts.signal?.aborted) throw new LlmError('Stopped');
    try {
      const r = await fetchWithTimeout(p.baseUrl + '/chat/completions', {
        method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal, timeoutMs: 120000,
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        if (r.status === 429 || r.status >= 500) { lastErr = new LlmError(`${p.name}: ${r.status} ${t.slice(0, 300)}`, r.status); await sleep(1200 * (attempt + 1)); continue; }
        // some local servers reject tool_choice → retry without
        if (r.status === 400 && body.tool_choice && attempt === 0) { delete body.tool_choice; continue; }
        if (r.status === 401 || r.status === 403) throw new LlmError(`${p.name} rejected the API key (${r.status}). Check it in Settings → Models.`, r.status);
        throw new LlmError(`${p.name}: ${r.status} ${t.slice(0, 400)}`, r.status);
      }
      const j: any = await r.json();
      const msg = j.choices?.[0]?.message ?? {};
      let toolCalls: LlmToolCall[] = (msg.tool_calls || []).map((c: any, i: number) => ({
        id: c.id || `call_${Date.now()}_${i}`,
        type: 'function' as const,
        function: { name: c.function?.name, arguments: typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function?.arguments ?? {}) },
      }));
      let content: string = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((x: any) => x.text || '').join('') : '';
      // small local models sometimes emit tool calls as JSON text — recover them
      if (!toolCalls.length && opts.tools?.length) {
        const rec = recoverToolCall(content, opts.tools);
        if (rec) { toolCalls = [rec]; content = ''; }
      }
      return { content, toolCalls, usage: j.usage?.total_tokens ?? 0, finish: j.choices?.[0]?.finish_reason ?? '' };
    } catch (e: any) {
      if (opts.signal?.aborted) throw new LlmError('Stopped');
      lastErr = e;
      if (e instanceof LlmError && e.status && e.status < 500 && e.status !== 429) throw e;
      if (p.local && /Network request failed|abort/i.test(String(e?.message))) {
        throw new LlmError(`Can't reach ${p.name} at ${p.baseUrl}. Make sure it's running, listening on your network (not just localhost), and that your phone is on the same Wi-Fi.`);
      }
      await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr ?? new LlmError('Model call failed');
}

function recoverToolCall(text: string, tools: LlmTool[]): LlmToolCall | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const name = j.name || j.tool || j.function;
    const args = j.arguments || j.args || j.parameters || {};
    if (name && tools.some((t) => t.function.name === name)) {
      return { id: 'rec_' + Date.now(), type: 'function', function: { name, arguments: JSON.stringify(args) } };
    }
  } catch {}
  return null;
}

/** Ask a provider which models it serves (OpenAI /models; Ollama /api/tags fallback). */
export async function discoverModels(p: ModelProvider): Promise<string[]> {
  const headers = await headersFor(p);
  try {
    const r = await fetchWithTimeout(p.baseUrl + '/models', { headers, timeoutMs: 8000 });
    if (!r.ok) throw new Error(String(r.status));
    const j: any = await r.json();
    const ids: string[] = (j.data || j.models || []).map((m: any) => m.id || m.name).filter(Boolean);
    return p.kind === 'openrouter' ? ids.slice(0, 400) : ids;
  } catch (e) {
    if (p.kind === 'ollama') {
      const r = await fetchWithTimeout(p.baseUrl.replace(/\/v1$/, '') + '/api/tags', { timeoutMs: 6000 });
      const j: any = await r.json();
      return (j.models || []).map((m: any) => m.name);
    }
    throw e;
  }
}

/** One tiny round-trip to prove the key + model work. */
export async function testModel(ref: ModelRef): Promise<{ ok: boolean; text?: string; error?: string; ms: number }> {
  const t0 = Date.now();
  try {
    const r = await chat({ model: ref, messages: [{ role: 'user', content: 'Reply with just: OK' }], maxTokens: 12, temperature: 0 });
    return { ok: true, text: r.content.trim().slice(0, 60), ms: Date.now() - t0 };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), ms: Date.now() - t0 };
  }
}
