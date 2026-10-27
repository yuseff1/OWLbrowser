import { providers, settings } from '../settings';
import type { ModelRef } from '../../shared/types';
import { checkProviderUrl, maySendKey, isPrivateHost } from '../net-guard';

export type LlmContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
export type LlmMessage =
  | { role: 'system' | 'user'; content: LlmContent }
  | { role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export type LlmToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type LlmTool = { type: 'function'; function: { name: string; description: string; parameters: any } };
export type LlmResponse = { content: string; toolCalls: LlmToolCall[]; usage: number; finish: string };

/** kind lets callers (and the UI) tell a bad key from a rate limit from an unreachable server. */
export type LlmErrorKind = 'auth' | 'rate-limit' | 'timeout' | 'unreachable' | 'bad-response' | 'not-found' | 'context' | 'config' | 'server' | 'request';

export class LlmError extends Error {
  constructor(msg: string, public status?: number, public kind: LlmErrorKind = 'request', public retryAfterMs?: number) { super(msg); this.name = 'LlmError'; }
}

/** Timeouts / retry policy. Mutable so tests can shrink the waits. */
export const llmTuning = {
  /** time to receive response headers (and the whole body for non-streaming calls) */
  timeoutMs: 120_000,
  /** max silence between two chunks of a streaming response */
  idleMs: 60_000,
  /** attempts for 429 / 5xx / network errors (first try included) */
  attempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 20_000,
  /** a Retry-After longer than this is not waited out; the error is shown instead */
  maxRetryAfterMs: 60_000,
};

export function resolveModel(ref?: ModelRef | null): ModelRef {
  const r = ref ?? settings.get().defaultModel;
  if (r && providers.get(r.providerId)) return r;
  // fallback: first enabled provider that is usable
  for (const p of providers.list()) {
    if (!p.enabled || !p.models.length) continue;
    if (p.local || p.hasKey) return { providerId: p.id, model: p.models[0] };
  }
  throw new LlmError('No AI model is set up yet. Open Settings → Models to add an API key or start a local model (Ollama / LM Studio).', undefined, 'config');
}

function headersFor(providerId: string): Record<string, string> {
  const p = providers.get(providerId)!;
  const key = providers.key(providerId);
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  // never send an API key in clear text over the network (https, or http to this machine only)
  if (key && maySendKey(p.baseUrl)) h['Authorization'] = `Bearer ${key}`;
  if (p.kind === 'anthropic' && key && maySendKey(p.baseUrl)) { h['x-api-key'] = key; h['anthropic-version'] = '2023-06-01'; }
  if (p.kind === 'openrouter') { h['HTTP-Referer'] = 'https://owl.varsen.tech'; h['X-Title'] = 'OWL Browser'; }
  return h;
}

/**
 * The chat-completions endpoint for a provider base URL. Accepts the forms people paste:
 * `http://localhost:11434` (Ollama root), `http://127.0.0.1:1234/v1` (LM Studio), `…/v1/` and
 * a full `…/v1/chat/completions`.
 */
export function chatEndpoint(baseUrl: string): string {
  const b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(b)) return b;
  try {
    const u = new URL(b);
    if (u.pathname === '' || u.pathname === '/') return b + '/v1/chat/completions';
    if (/\/api$/i.test(u.pathname) && /11434/.test(u.port)) return b.replace(/\/api$/i, '') + '/v1/chat/completions'; // Ollama native path pasted
  } catch {}
  return b + '/chat/completions';
}

const isLocalUrl = (raw: string) => { try { return isPrivateHost(new URL(raw).hostname); } catch { return false; } };

/** Models that answered "tools not supported": later calls go straight to the JSON-in-text fallback. */
const noToolSupport = new Set<string>();
/** Providers that rejected tool_choice / response_format / stream_options: later calls leave them out. */
const plainProviders = new Set<string>();
const NO_TOOLS_RE = /(does not support|doesn'?t support|not support(ed)?|unsupported|unknown|unrecognized|invalid|not allowed)[^.]{0,60}\b(tools?|tool_choice|function[_ ]?call(ing|s)?|functions)\b|\b(tools?|tool_choice|function[_ ]?calling)\b[^.]{0,40}\b(not supported|unsupported|not available|is not enabled)/i;

/** One chat-completions call with tools. Works for every OpenAI-compatible endpoint, cloud or local. */
export async function chat(opts: {
  model?: ModelRef | null;
  messages: LlmMessage[];
  tools?: LlmTool[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  json?: boolean;
  /** streams text tokens; also works together with tools (tool-call deltas are assembled) */
  onToken?: (t: string) => void;
  /** told before each backoff wait (rate limit / server error), so a UI can say "retrying in 4s" */
  onRetry?: (info: { attempt: number; waitMs: number; reason: string }) => void;
}): Promise<LlmResponse> {
  const ref = resolveModel(opts.model);
  const p = providers.get(ref.providerId)!;
  const chk = checkProviderUrl(p.baseUrl);
  if (!chk.ok) throw new LlmError(`${p.name}: ${chk.reason}`, undefined, 'config');
  const local = p.local || isLocalUrl(p.baseUrl);
  const cacheKey = `${ref.providerId}|${ref.model}`;
  let toolsInText = !!opts.tools?.length && noToolSupport.has(cacheKey);
  // once text has been streamed to the user a retry would show it twice, so no retries after that
  let emitted = false;
  const onToken = opts.onToken ? (t: string) => { emitted = true; opts.onToken!(t); } : undefined;

  const makeBody = () => {
    const body: any = { model: ref.model, messages: toolsInText ? toolsAsText(opts.messages, opts.tools!) : opts.messages, temperature: opts.temperature ?? 0.3 };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    const plain = plainProviders.has(ref.providerId);
    if (opts.tools?.length && !toolsInText) { body.tools = opts.tools; if (!plain) body.tool_choice = 'auto'; }
    if (opts.json && !plain) body.response_format = { type: 'json_object' };
    if (opts.onToken) { body.stream = true; if (!plain) body.stream_options = { include_usage: true }; }
    return body;
  };
  let body = makeBody();

  let lastErr: LlmError | null = null;
  let relaxed = false; // already retried without tool_choice / response_format / stream_options
  for (let attempt = 1; attempt <= llmTuning.attempts; attempt++) {
    if (opts.signal?.aborted) throw abortError();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), llmTuning.timeoutMs);
    const signal = opts.signal ? anySignal([opts.signal, timeout.signal]) : timeout.signal;
    try {
      let r: Response;
      try {
        r = await fetch(chatEndpoint(p.baseUrl), { method: 'POST', headers: headersFor(ref.providerId), body: JSON.stringify(body), signal });
      } catch (e: any) {
        throw networkError(e, p.name, local, opts.signal, timeout.signal);
      }
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        const detail = providerMessage(text);
        if (r.status === 400 || r.status === 422 || r.status === 404 || r.status === 501) {
          // a model / server without function calling: fall back to tools described in text
          if (opts.tools?.length && !toolsInText && NO_TOOLS_RE.test(detail)) {
            noToolSupport.add(cacheKey); toolsInText = true; body = makeBody(); attempt--; continue;
          }
          // some local servers reject tool_choice / response_format / stream_options → retry once without
          if (!relaxed && (body.tool_choice || body.response_format || body.stream_options)) {
            relaxed = true; delete body.tool_choice; delete body.response_format; delete body.stream_options; attempt--; continue;
          }
        }
        const err = httpError(r.status, detail, p.name, ref.model, r.headers.get('retry-after'));
        if (err.kind === 'rate-limit' || err.kind === 'server') {
          lastErr = err;
          if (attempt < llmTuning.attempts && (err.retryAfterMs == null || err.retryAfterMs <= llmTuning.maxRetryAfterMs)) {
            await backoff(attempt, err, opts);
            continue;
          }
        }
        throw err;
      }
      const ctype = r.headers.get('content-type') || '';
      let res: LlmResponse;
      if (body.stream && r.body && !/application\/json/i.test(ctype)) {
        clearTimeout(timer); // the idle timer takes over for streams
        res = await readStream(r, onToken!, p.name, opts.signal);
      } else {
        const raw = await r.text();
        let j: any;
        try { j = JSON.parse(raw); } catch { throw new LlmError(`${p.name} sent a response that isn't valid JSON (${raw.slice(0, 80).replace(/\s+/g, ' ') || 'empty body'}). Check the base URL points at an OpenAI-compatible /v1 endpoint.`, r.status, 'bad-response'); }
        if (j?.error && !j.choices) throw new LlmError(`${p.name}: ${providerMessage(JSON.stringify(j))}`, r.status, 'server');
        res = parseCompletion(j, p.name);
        if (onToken && res.content) onToken(res.content);
      }
      // small local models sometimes emit tool calls as JSON text — recover them
      if (!res.toolCalls.length && opts.tools?.length) {
        const rec = recoverToolCall(res.content, opts.tools);
        if (rec) { res.toolCalls = [rec]; res.content = ''; }
      }
      if (relaxed) plainProviders.add(ref.providerId); // the extras were the problem: leave them out from now on
      return res;
    } catch (e: any) {
      if (opts.signal?.aborted) throw abortError();
      if (!(e instanceof LlmError)) e = new LlmError(`${p.name}: ${e?.message || String(e)}`, undefined, 'request');
      lastErr = e;
      // transient: timeouts, dropped connections (not "server isn't running"), and garbled bodies
      const transient = e.kind === 'timeout' || (e.kind === 'unreachable' && !/isn't running|can't find/.test(e.message)) || e.kind === 'bad-response';
      if (transient && !emitted && attempt < Math.min(llmTuning.attempts, e.kind === 'bad-response' ? 2 : llmTuning.attempts)) { await backoff(attempt, e, opts); continue; }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new LlmError('Model call failed');
}

function parseCompletion(j: any, name: string): LlmResponse {
  const choice = j?.choices?.[0];
  if (!choice) throw new LlmError(`${name} returned no answer (empty "choices"). The model may be overloaded or the request was filtered.`, undefined, 'bad-response');
  const msg = choice.message ?? {};
  const toolCalls: LlmToolCall[] = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []).filter((c: any) => c?.function?.name).map((c: any, i: number) => ({
    id: c.id || `call_${Date.now()}_${i}`,
    type: 'function' as const,
    function: { name: String(c.function.name), arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}) },
  }));
  const content: string = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((x: any) => x?.text || '').join('') : '';
  return { content, toolCalls, usage: j.usage?.total_tokens ?? 0, finish: choice.finish_reason ?? '' };
}

async function readStream(r: Response, onToken: (t: string) => void, name: string, outer?: AbortSignal): Promise<LlmResponse> {
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = '', content = '', usage = 0, finish = '', sawData = false;
  const calls: Array<{ id?: string; name: string; args: string }> = [];
  const handle = (d: string) => {
    if (d === '[DONE]') return;
    let j: any;
    try { j = JSON.parse(d); } catch { return; } // keep-alive / partial garbage lines are skipped
    sawData = true;
    if (j.error) throw new LlmError(`${name}: ${providerMessage(JSON.stringify(j))}`, undefined, 'server');
    if (j.usage?.total_tokens) usage = j.usage.total_tokens;
    const ch = j.choices?.[0];
    if (!ch) return;
    if (ch.finish_reason) finish = ch.finish_reason;
    const delta = ch.delta ?? ch.message ?? {};
    if (typeof delta.content === 'string' && delta.content) { content += delta.content; onToken(delta.content); }
    for (const tc of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const idx = typeof tc.index === 'number' ? tc.index : calls.length;
      const c = calls[idx] || (calls[idx] = { name: '', args: '' });
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.name += tc.function.name;
      if (tc.function?.arguments != null) c.args += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
    }
  };
  for (;;) {
    let idle: NodeJS.Timeout | undefined;
    const chunk = await Promise.race([
      reader.read(),
      new Promise<never>((_, rej) => { idle = setTimeout(() => rej(new LlmError(`${name} stopped responding mid-answer (no data for ${Math.round(llmTuning.idleMs / 1000)}s).`, undefined, 'timeout')), llmTuning.idleMs); }),
    ]).catch((e) => { reader.cancel().catch(() => {}); if (outer?.aborted) throw abortError(); throw e; }).finally(() => clearTimeout(idle));
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith('data:')) handle(line.slice(5).trim());
    }
  }
  const rest = buf.trim();
  if (rest.startsWith('data:')) handle(rest.slice(5).trim());
  else if (rest && !sawData) {
    // not SSE at all: maybe a plain JSON body despite stream=true
    try { const res = parseCompletion(JSON.parse(rest), name); if (res.content) onToken(res.content); return res; }
    catch (e) { if (e instanceof LlmError) throw e; throw new LlmError(`${name} sent a response that isn't valid JSON or a stream (${rest.slice(0, 80)}).`, undefined, 'bad-response'); }
  }
  if (!sawData && !content) throw new LlmError(`${name} closed the stream without an answer.`, undefined, 'bad-response');
  const toolCalls: LlmToolCall[] = calls.filter((c) => c && c.name).map((c, i) => ({ id: c.id || `call_${Date.now()}_${i}`, type: 'function', function: { name: c.name, arguments: c.args || '{}' } }));
  return { content, toolCalls, usage, finish: finish || 'stop' };
}

/** Extracts the human message from an OpenAI/Anthropic/Ollama style error body. */
function providerMessage(text: string): string {
  try {
    const j = JSON.parse(text);
    const m = j?.error?.message ?? (typeof j?.error === 'string' ? j.error : null) ?? j?.message ?? j?.detail;
    if (m) return String(typeof m === 'string' ? m : JSON.stringify(m)).slice(0, 300);
  } catch {}
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function parseRetryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, n * 1000);
  const d = Date.parse(v);
  return Number.isNaN(d) ? undefined : Math.max(0, d - Date.now());
}

function httpError(status: number, detail: string, name: string, model: string, retryAfter: string | null): LlmError {
  const tail = detail ? ` (${detail})` : '';
  if (status === 401 || status === 403) return new LlmError(`${name} rejected the API key (${status}). Check the key in Settings → Models.${detail ? ' Provider says: ' + detail : ''}`, status, 'auth');
  if (status === 429) {
    const ms = parseRetryAfter(retryAfter);
    const quota = /quota|credit|billing|insufficient/i.test(detail);
    return new LlmError(quota ? `${name} says the account is out of credit or quota (429).${tail}` : `${name} is rate-limiting requests (429)${ms != null ? `; it asked to wait ${Math.ceil(ms / 1000)}s` : ''}. Try again shortly or pick another model.${tail}`, status, quota ? 'auth' : 'rate-limit', ms);
  }
  if (status === 404) return new LlmError(`${name}: model "${model}" or the endpoint was not found (404). Check the model name and that the base URL ends in /v1.${tail}`, status, 'not-found');
  if (status === 408 || status === 504) return new LlmError(`${name} timed out (${status}).${tail}`, status, 'server');
  if (status === 413 || /context length|maximum context|too many tokens|context_length/i.test(detail)) return new LlmError(`The conversation is too long for ${model} (${status}). Start a new task or use a model with a larger context.${tail}`, status, 'context');
  if (status >= 500) return new LlmError(`${name} had a server error (${status}).${tail}`, status, 'server', parseRetryAfter(retryAfter));
  return new LlmError(`${name} refused the request (${status}).${tail}`, status, 'request');
}

function networkError(e: any, name: string, local: boolean, outer: AbortSignal | undefined, timeout: AbortSignal): LlmError | Error {
  if (outer?.aborted) return abortError();
  if (timeout.aborted) return new LlmError(`${name} did not answer within ${Math.round(llmTuning.timeoutMs / 1000)}s.`, undefined, 'timeout');
  const code = e?.cause?.code || e?.code || '';
  const msg = `${code} ${e?.message || ''} ${e?.cause?.message || ''}`;
  if (/ECONNREFUSED/.test(msg)) return new LlmError(local ? `${name} isn't running (connection refused). Start it, then try again.` : `${name} refused the connection.`, undefined, 'unreachable');
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return new LlmError(`Can't find ${name}'s server (DNS lookup failed). Check the base URL and your internet connection.`, undefined, 'unreachable');
  if (/CERT|SSL|TLS/i.test(msg)) return new LlmError(`${name}: secure connection failed (${code || 'TLS error'}).`, undefined, 'unreachable');
  return new LlmError(`Can't reach ${name} (${String(code || e?.cause?.message || e?.message || 'network error').slice(0, 80)}).`, undefined, 'unreachable');
}

function abortError(): Error { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }

function anySignal(signals: AbortSignal[]): AbortSignal {
  const anyFn = (AbortSignal as any).any;
  if (typeof anyFn === 'function') return anyFn.call(AbortSignal, signals);
  const c = new AbortController();
  for (const s of signals) { if (s.aborted) { c.abort(); break; } s.addEventListener('abort', () => c.abort(), { once: true }); }
  return c.signal;
}

/** Exponential backoff with jitter, honouring Retry-After; aborts immediately when the run is stopped. */
async function backoff(attempt: number, err: LlmError, opts: { signal?: AbortSignal; onRetry?: (i: { attempt: number; waitMs: number; reason: string }) => void }) {
  const exp = Math.min(llmTuning.maxDelayMs, llmTuning.baseDelayMs * 2 ** (attempt - 1));
  const waitMs = Math.round(err.retryAfterMs != null ? Math.min(Math.max(err.retryAfterMs, 50), llmTuning.maxRetryAfterMs) : exp * (0.75 + Math.random() * 0.5));
  try { opts.onRetry?.({ attempt, waitMs, reason: err.message }); } catch {}
  await sleep(waitMs, opts.signal);
}

/**
 * For models without native function calling: describe the tools in the system prompt and turn the
 * tool-call history into plain text, so the model can answer with one JSON object we then parse.
 */
function toolsAsText(messages: LlmMessage[], tools: LlmTool[]): LlmMessage[] {
  const spec = tools.map((t) => `- ${t.function.name}(${Object.keys(t.function.parameters?.properties || {}).join(', ')}): ${t.function.description.slice(0, 160)}`).join('\n');
  const guide = `\n\nYou can use tools. To call one, reply with ONLY a JSON object and nothing else, like {"name": "tool_name", "arguments": {...}}. One tool per reply. When the task is complete call {"name": "finish", "arguments": {"answer": "..."}}.\nTools:\n${spec}`;
  const out: LlmMessage[] = [];
  let addedGuide = false;
  for (const m of messages) {
    if (m.role === 'system' && !addedGuide) { out.push({ role: 'system', content: (typeof m.content === 'string' ? m.content : '') + guide }); addedGuide = true; continue; }
    if (m.role === 'assistant') {
      const calls = (m.tool_calls || []).map((c) => JSON.stringify({ name: c.function.name, arguments: safeJson(c.function.arguments) })).join('\n');
      out.push({ role: 'assistant', content: [m.content, calls].filter(Boolean).join('\n') || '(no reply)' });
      continue;
    }
    if (m.role === 'tool') { out.push({ role: 'user', content: `Tool result:\n${m.content}` }); continue; }
    out.push(m);
  }
  if (!addedGuide) out.unshift({ role: 'system', content: guide.trim() });
  return out;
}

function safeJson(s: string): any { try { return JSON.parse(s || '{}'); } catch { return s; } }

function recoverToolCall(text: string, tools: LlmTool[]): LlmToolCall | null {
  const m = String(text || '').replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const name = j.name || j.tool || j.function?.name || j.function;
    const args = j.arguments || j.args || j.parameters || j.function?.arguments || {};
    if (typeof name === 'string' && tools.some((t) => t.function.name === name)) {
      return { id: 'rec_' + Date.now(), type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } };
    }
  } catch {}
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function quickText(prompt: string, system = 'You are OWL, a concise assistant.', model?: ModelRef | null): Promise<string> {
  const r = await chat({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: 0.2 });
  return r.content.trim();
}

/** test hook: forget which models lacked tool support */
export function _resetToolSupportCache() { noToolSupport.clear(); plainProviders.clear(); }
