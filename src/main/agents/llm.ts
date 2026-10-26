import { providers, settings } from '../settings';
import type { ModelRef } from '../../shared/types';

export type LlmContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
export type LlmMessage =
  | { role: 'system' | 'user'; content: LlmContent }
  | { role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export type LlmToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type LlmTool = { type: 'function'; function: { name: string; description: string; parameters: any } };
export type LlmResponse = { content: string; toolCalls: LlmToolCall[]; usage: number; finish: string };

export class LlmError extends Error {
  constructor(msg: string, public status?: number) { super(msg); }
}

export function resolveModel(ref?: ModelRef | null): ModelRef {
  const r = ref ?? settings.get().defaultModel;
  if (r && providers.get(r.providerId)) return r;
  // fallback: first enabled provider that is usable
  for (const p of providers.list()) {
    if (!p.enabled || !p.models.length) continue;
    if (p.local || p.hasKey) return { providerId: p.id, model: p.models[0] };
  }
  throw new LlmError('No AI model is set up yet. Open Settings → Models to add an API key or start a local model (Ollama / LM Studio).');
}

function headersFor(providerId: string): Record<string, string> {
  const p = providers.get(providerId)!;
  const key = providers.key(providerId);
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) h['Authorization'] = `Bearer ${key}`;
  if (p.kind === 'anthropic' && key) { h['x-api-key'] = key; h['anthropic-version'] = '2023-06-01'; }
  if (p.kind === 'openrouter') { h['HTTP-Referer'] = 'https://owl.varsen.tech'; h['X-Title'] = 'OWL Browser'; }
  return h;
}

/** One chat-completions call with tools. Works for every OpenAI-compatible endpoint, cloud or local. */
export async function chat(opts: {
  model?: ModelRef | null;
  messages: LlmMessage[];
  tools?: LlmTool[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  json?: boolean;
  onToken?: (t: string) => void;
}): Promise<LlmResponse> {
  const ref = resolveModel(opts.model);
  const p = providers.get(ref.providerId)!;
  const body: any = {
    model: ref.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.tools?.length) { body.tools = opts.tools; body.tool_choice = 'auto'; }
  if (opts.json) body.response_format = { type: 'json_object' };
  const stream = !!opts.onToken && !opts.tools?.length;
  if (stream) body.stream = true;

  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(p.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: headersFor(ref.providerId),
        body: JSON.stringify(body),
        signal: opts.signal,
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        if (r.status === 429 || r.status >= 500) { lastErr = new LlmError(`${p.name}: ${r.status} ${t.slice(0, 300)}`, r.status); await sleep(1200 * (attempt + 1)); continue; }
        // some local servers reject tool_choice / response_format → retry without
        if (r.status === 400 && (body.tool_choice || body.response_format) && attempt === 0) { delete body.tool_choice; delete body.response_format; continue; }
        throw new LlmError(`${p.name}: ${r.status} ${t.slice(0, 400)}`, r.status);
      }
      if (stream && r.body) return await readStream(r, opts.onToken!);
      const j: any = await r.json();
      const msg = j.choices?.[0]?.message ?? {};
      let toolCalls: LlmToolCall[] = (msg.tool_calls || []).map((c: any, i: number) => ({
        id: c.id || `call_${Date.now()}_${i}`,
        type: 'function',
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
      if (e?.name === 'AbortError') throw e;
      lastErr = e;
      if (e instanceof LlmError && e.status && e.status < 500 && e.status !== 429) throw e;
      if (String(e?.message || '').includes('ECONNREFUSED') && p.local) throw new LlmError(`${p.name} isn't running. Start it, then try again.`);
      await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr ?? new LlmError('Model call failed');
}

async function readStream(r: Response, onToken: (t: string) => void): Promise<LlmResponse> {
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = '', content = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim();
      if (d === '[DONE]') continue;
      try { const j = JSON.parse(d); const t = j.choices?.[0]?.delta?.content; if (t) { content += t; onToken(t); } } catch {}
    }
  }
  return { content, toolCalls: [], usage: 0, finish: 'stop' };
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function quickText(prompt: string, system = 'You are OWL, a concise assistant.', model?: ModelRef | null): Promise<string> {
  const r = await chat({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: 0.2 });
  return r.content.trim();
}
