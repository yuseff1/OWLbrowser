/**
 * Minimal Model Context Protocol CLIENT (no SDK). Lets users connect "Apps" (MCP servers).
 *
 * Transports
 *  - stdio: spawn command+args, newline-delimited JSON-RPC 2.0 over stdin/stdout.
 *  - Streamable HTTP: POST JSON-RPC to url; response is application/json or text/event-stream;
 *    keeps the Mcp-Session-Id header; optional bearer token (stored encrypted via secrets).
 *
 * Lifecycle: initialize → notifications/initialized → tools/list (paginated) → tools/call.
 *
 * Security
 *  - Tokens live only in the encrypted secrets store, never in the JSON config and never logged.
 *  - Remote URLs must be https:// (plain http only for localhost).
 *  - Response bodies / tool output are size-capped; server-initiated requests other than ping
 *    are refused (no sampling / roots / elicitation exposure).
 *  - stdio commands are spawned without a shell; .cmd/.bat shims on Windows go through
 *    cmd.exe with every argument escaped (cross-spawn style).
 */
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { JsonStore } from './store';
import { secrets } from './secrets';
import { profiles } from './profiles';

// ───────────────────────────── types ─────────────────────────────

export type McpTransport = 'stdio' | 'http';

export type McpServerConfig = {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled: boolean;
  icon?: string;
  description?: string;
};

export type McpStatus = 'connected' | 'connecting' | 'error' | 'off';

export type McpTool = {
  serverId: string;
  serverName: string;
  name: string;
  description: string;
  inputSchema: any;
};

export type McpServerView = McpServerConfig & { hasToken: boolean; status: McpStatus; error?: string };

export type AppCatalogEntry = {
  name: string;
  description: string;
  category: 'Essentials' | 'Productivity' | 'Sales & CRM' | 'Dev' | 'Data';
  transport: 'http';
  url: string;
  /** true when the server rejects unauthenticated requests (needs a bearer token / API key) */
  needsToken: boolean;
  iconDomain: string;
};

type JsonRpcMessage = {
  jsonrpc: '2.0';
  id?: number | string | null;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: any };
};

// ───────────────────────────── constants ─────────────────────────────

const PROTOCOL_VERSION = '2025-06-18';
const CLIENT_INFO = { name: 'OWL', version: '0.1.0' };
const REQUEST_TIMEOUT_MS = 60_000;
const CALL_TIMEOUT_MS = 180_000;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_TOOL_OUTPUT_CHARS = 200_000;
const MAX_TOOL_PAGES = 50;

// ───────────────────────────── helpers ─────────────────────────────

const stores = new Map<string, JsonStore<McpServerConfig[]>>();
function storeFor(profileId: string) {
  let s = stores.get(profileId);
  if (!s) { s = new JsonStore<McpServerConfig[]>('mcp', [], profiles.dataDir(profileId)); stores.set(profileId, s); }
  return s;
}
const tokenKey = (profileId: string, id: string) => 'mcp:' + profileId + ':' + id;

function slug(s: string, max = 16) {
  const v = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
  return (v || 'app').slice(0, max).replace(/_+$/, '');
}
function isSafeId(id: any): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9-]+(?:_[a-zA-Z0-9-]+)*$/.test(id) && id.length <= 40;
}
function newId(name: string) {
  return `${slug(name)}_${crypto.randomBytes(3).toString('hex')}`;
}

function validateUrl(raw: string): string {
  let u: URL;
  try { u = new URL(String(raw || '').trim()); } catch { throw new Error('Invalid server URL'); }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('Server URL must use https:// (http:// is allowed only for localhost)');
  if (u.username || u.password) throw new Error('Do not put credentials in the URL; use the token field');
  return u.toString();
}

function sanitizeEnv(env: any): Record<string, string> | undefined {
  if (!env || typeof env !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error(`Invalid environment variable name: ${k}`);
    if (v == null) continue;
    const s = String(v);
    if (s.includes('\0')) throw new Error(`Invalid value for ${k}`);
    out[k] = s;
  }
  return Object.keys(out).length ? out : undefined;
}

function errMsg(e: any) { return e?.message ? String(e.message) : String(e); }

// ───────────────────────────── Windows spawn helpers ─────────────────────────────

const META = /([()\][%!^"`<>&|;, *?])/g;
function escapeCmdArg(arg: string, doubleEscape: boolean) {
  let a = String(arg);
  a = a.replace(/(\\*)"/g, '$1$1\\"');
  a = a.replace(/(\\*)$/, '$1$1');
  a = `"${a}"`;
  a = a.replace(META, '^$1');
  if (doubleEscape) a = a.replace(META, '^$1');
  return a;
}

function resolveOnPath(cmd: string, env: NodeJS.ProcessEnv): string | null {
  const exts = path.extname(cmd) ? [''] : String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((x) => x.toLowerCase());
  const hasDir = /[\\/]/.test(cmd);
  const dirs = hasDir ? [''] : String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) for (const e of exts) {
    const full = hasDir ? cmd + e : path.join(d, cmd + e);
    try { if (fs.statSync(full).isFile()) return full; } catch { /* next */ }
  }
  return null;
}

function spawnStdio(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
  const opts = { env, stdio: ['pipe', 'pipe', 'pipe'] as any, windowsHide: true };
  if (process.platform !== 'win32') return spawn(command, args, { ...opts, shell: false }) as ChildProcessWithoutNullStreams;
  const resolved = resolveOnPath(command, env) || command;
  if (!/\.(cmd|bat)$/i.test(resolved)) return spawn(resolved, args, { ...opts, shell: false }) as ChildProcessWithoutNullStreams;
  // .cmd / .bat (npx, uvx shims...) cannot be spawned directly since Node's CVE-2024-27980 fix.
  const dbl = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(resolved);
  const line = [path.normalize(resolved).replace(META, '^$1'), ...args.map((a) => escapeCmdArg(a, dbl))].join(' ');
  return spawn(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...opts, shell: false, windowsVerbatimArguments: true }) as ChildProcessWithoutNullStreams;
}

// ───────────────────────────── transports ─────────────────────────────

interface Transport {
  /** send a message; for HTTP returns any messages received in direct response */
  send(msg: JsonRpcMessage, timeoutMs: number): Promise<void>;
  close(): Promise<void>;
  onMessage: (m: JsonRpcMessage) => void;
  onClose: (err?: Error) => void;
  protocolVersion?: string;
}

class StdioTransport implements Transport {
  onMessage: (m: JsonRpcMessage) => void = () => {};
  onClose: (err?: Error) => void = () => {};
  private proc: ChildProcessWithoutNullStreams;
  private buf = '';
  private stderrTail = '';
  private closed = false;

  constructor(cfg: McpServerConfig) {
    if (!cfg.command || !String(cfg.command).trim()) throw new Error('No command configured');
    // Inherit the user's environment (PATH etc.) but not variables that would turn a child into an
    // Electron/Node with injected options; the server's own configured env still wins.
    const inherited: NodeJS.ProcessEnv = { ...process.env };
    for (const k of Object.keys(inherited)) if (/^(ELECTRON_|NODE_OPTIONS$|NODE_EXTRA_CA_CERTS$)/i.test(k)) delete inherited[k];
    const env = { ...inherited, ...(cfg.env || {}) };
    this.proc = spawnStdio(String(cfg.command).trim(), (cfg.args || []).map(String), env);
    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');
    this.proc.stdout.on('data', (d: string) => this.onData(d));
    this.proc.stderr.on('data', (d: string) => { this.stderrTail = (this.stderrTail + d).slice(-4000); });
    this.proc.on('error', (e) => this.finish(new Error(`Failed to start "${cfg.command}": ${e.message}`)));
    this.proc.on('exit', (code, sig) => this.finish(new Error(`Server process exited (${sig || code})${this.stderrTail ? ': ' + this.stderrTail.trim().slice(-500) : ''}`)));
    this.proc.stdin.on('error', () => { /* surfaced through exit */ });
  }

  private finish(err?: Error) {
    if (this.closed) return;
    this.closed = true;
    this.onClose(err);
  }

  private onData(d: string) {
    this.buf += d;
    if (this.buf.length > MAX_MESSAGE_BYTES) { this.buf = ''; this.finish(new Error('Server sent an oversized message')); this.kill(); return; }
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg: any;
      try { msg = JSON.parse(line); } catch { continue; } // servers sometimes log to stdout
      for (const m of Array.isArray(msg) ? msg : [msg]) if (m && m.jsonrpc === '2.0') this.onMessage(m);
    }
  }

  async send(msg: JsonRpcMessage): Promise<void> {
    if (this.closed) throw new Error('Server is not running');
    await new Promise<void>((res, rej) => this.proc.stdin.write(JSON.stringify(msg) + '\n', 'utf8', (e) => (e ? rej(e) : res())));
  }

  private kill() {
    try { this.proc.stdin.end(); } catch {}
    // On Windows .cmd shims run as cmd.exe → node.exe; proc.kill() only ends cmd.exe and orphans the
    // real server. Kill the whole tree so nothing survives OWL quitting.
    if (process.platform === 'win32' && this.proc.pid && this.proc.exitCode === null) {
      try { spawn('taskkill', ['/pid', String(this.proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {}); } catch {}
    }
    try { this.proc.kill(); } catch {}
  }

  async close() {
    this.closed = true;
    this.kill();
  }
}

class HttpTransport implements Transport {
  onMessage: (m: JsonRpcMessage) => void = () => {};
  onClose: (err?: Error) => void = () => {};
  protocolVersion?: string;
  sessionId: string | null = null;
  private url: string;
  private token: string | null;
  private controllers = new Set<AbortController>();

  constructor(cfg: McpServerConfig, token: string | null) {
    this.url = validateUrl(cfg.url || '');
    this.token = token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'User-Agent': `${CLIENT_INFO.name}/${CLIENT_INFO.version}`,
    };
    if (this.protocolVersion) h['MCP-Protocol-Version'] = this.protocolVersion;
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async send(msg: JsonRpcMessage, timeoutMs: number): Promise<void> {
    const ac = new AbortController();
    this.controllers.add(ac);
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(this.url, { method: 'POST', headers: this.headers(), body: JSON.stringify(msg), signal: ac.signal, redirect: 'follow' });
      const sid = res.headers.get('mcp-session-id');
      if (sid && /^[\x21-\x7e]{1,512}$/.test(sid)) this.sessionId = sid;
      if (res.status === 202 || res.status === 204) return;
      if (!res.ok) {
        const body = (await safeText(res, 2000)).trim();
        if (res.status === 401 || res.status === 403) {
          throw new HttpError(res.status, this.token ? 'Authorization failed: the token was rejected' : 'This app needs a token: add an API key / access token in its settings');
        }
        if (res.status === 404 && this.sessionId) { this.sessionId = null; throw new HttpError(404, 'Session expired'); }
        throw new HttpError(res.status, `HTTP ${res.status}${body ? ': ' + body.slice(0, 300) : ''}`);
      }
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/event-stream')) await this.readSse(res, msg.id);
      else if (ct.includes('application/json')) {
        const text = await safeText(res, MAX_MESSAGE_BYTES);
        if (!text.trim()) return;
        const parsed = JSON.parse(text);
        for (const m of Array.isArray(parsed) ? parsed : [parsed]) if (m && m.jsonrpc === '2.0') this.onMessage(m);
      } else {
        await safeText(res, 1000);
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new Error('Request timed out');
      throw e;
    } finally {
      clearTimeout(timer);
      this.controllers.delete(ac);
    }
  }

  /** Parse an SSE stream; stop once the response for `waitId` arrived (or stream ends). */
  private async readSse(res: Response, waitId: any) {
    if (!res.body) return;
    const reader = (res.body as any).getReader();
    const dec = new TextDecoder();
    let buf = '';
    let total = 0;
    let data: string[] = [];
    let done = false;
    const dispatch = () => {
      if (!data.length) return;
      const payload = data.join('\n');
      data = [];
      try {
        const parsed = JSON.parse(payload);
        for (const m of Array.isArray(parsed) ? parsed : [parsed]) {
          if (!m || m.jsonrpc !== '2.0') continue;
          this.onMessage(m);
          if (waitId != null && m.id === waitId && (m.result !== undefined || m.error !== undefined)) done = true;
        }
      } catch { /* ignore non-JSON events */ }
    };
    try {
      while (!done) {
        const { value, done: end } = await reader.read();
        if (end) break;
        total += value.byteLength;
        if (total > MAX_MESSAGE_BYTES) throw new Error('Server sent an oversized response');
        buf += dec.decode(value, { stream: true });
        let i: number;
        while (!done && (i = buf.search(/\r?\n/)) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(buf[i] === '\r' ? i + 2 : i + 1);
          if (line === '') dispatch();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
          // event:, id:, retry: and comments are ignored
        }
      }
      if (!done) dispatch();
    } finally {
      try { await reader.cancel(); } catch {}
    }
  }

  async close() {
    for (const c of this.controllers) { try { c.abort(); } catch {} }
    this.controllers.clear();
    if (this.sessionId) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 3000);
      try { await fetch(this.url, { method: 'DELETE', headers: this.headers(), signal: ac.signal }); } catch {}
      clearTimeout(t);
      this.sessionId = null;
    }
  }
}

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

async function safeText(res: Response, max: number): Promise<string> {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > max) throw new Error('Server sent an oversized response');
  const t = await res.text();
  return t.length > max ? t.slice(0, max) : t;
}

// ───────────────────────────── connection ─────────────────────────────

type PendingReq = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

class Connection {
  status: McpStatus = 'off';
  error?: string;
  serverInfo?: any;
  private transport: Transport | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingReq>();
  private toolsCache: any[] | null = null;
  private connecting: Promise<void> | null = null;

  constructor(public profileId: string, public cfg: McpServerConfig) {}

  connect(): Promise<void> {
    if (this.status === 'connected') return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async doConnect() {
    this.status = 'connecting';
    this.error = undefined;
    this.toolsCache = null;
    try {
      const t: Transport = this.cfg.transport === 'http'
        ? new HttpTransport(this.cfg, secrets.get(tokenKey(this.profileId, this.cfg.id)))
        : new StdioTransport(this.cfg);
      this.transport = t;
      t.onMessage = (m) => this.onMessage(m);
      t.onClose = (err) => this.onTransportClose(t, err);
      const init = await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      }, REQUEST_TIMEOUT_MS);
      this.serverInfo = init?.serverInfo;
      t.protocolVersion = typeof init?.protocolVersion === 'string' ? init.protocolVersion : PROTOCOL_VERSION;
      await this.notify('notifications/initialized');
      this.status = 'connected';
    } catch (e) {
      this.status = 'error';
      this.error = errMsg(e);
      const t = this.transport;
      this.transport = null;
      this.rejectAll(new Error(this.error));
      if (t) await t.close().catch(() => {});
      throw new Error(`${this.cfg.name}: ${this.error}`);
    }
  }

  private onTransportClose(t: Transport, err?: Error) {
    if (this.transport !== t) return;
    this.transport = null;
    this.toolsCache = null;
    if (this.status !== 'off') { this.status = 'error'; this.error = err ? errMsg(err) : 'Connection closed'; }
    this.rejectAll(new Error(this.error || 'Connection closed'));
  }

  private rejectAll(err: Error) {
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }

  private onMessage(m: JsonRpcMessage) {
    // response
    if (m.id != null && m.method === undefined) {
      const p = this.pending.get(Number(m.id));
      if (!p) return;
      this.pending.delete(Number(m.id));
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(`${m.error.message || 'MCP error'}${m.error.code != null ? ` (${m.error.code})` : ''}`));
      else p.resolve(m.result);
      return;
    }
    // server → client request
    if (m.id != null && m.method) {
      const reply: JsonRpcMessage = m.method === 'ping'
        ? { jsonrpc: '2.0', id: m.id, result: {} }
        : { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Method not supported by OWL: ${m.method}` } };
      this.transport?.send(reply, 10_000).catch(() => {});
      return;
    }
    // notification
    if (m.method === 'notifications/tools/list_changed') this.toolsCache = null;
  }

  async request(method: string, params: any, timeoutMs = REQUEST_TIMEOUT_MS, retried = false): Promise<any> {
    const t = this.transport;
    if (!t) throw new Error('Not connected');
    const id = this.nextId++;
    const msg: JsonRpcMessage = { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
    const result = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
        // best-effort cancellation
        if (method !== 'initialize') this.notify('notifications/cancelled', { requestId: id, reason: 'timeout' }).catch(() => {});
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    try {
      await t.send(msg, timeoutMs);
    } catch (e) {
      const p = this.pending.get(id);
      if (p) { clearTimeout(p.timer); this.pending.delete(id); }
      if (e instanceof HttpError && e.status === 404 && method !== 'initialize' && !retried) {
        // session expired → reconnect once and retry
        this.status = 'off';
        await this.close(false);
        await this.connect();
        return this.request(method, params, timeoutMs, true);
      }
      throw e;
    }
    return result;
  }

  async notify(method: string, params?: any) {
    const t = this.transport;
    if (!t) return;
    await t.send({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) }, 15_000);
  }

  async listTools(): Promise<any[]> {
    if (this.toolsCache) return this.toolsCache;
    await this.connect();
    const all: any[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page++) {
      const r = await this.request('tools/list', cursor ? { cursor } : {});
      for (const tool of Array.isArray(r?.tools) ? r.tools : []) if (tool && typeof tool.name === 'string') all.push(tool);
      cursor = typeof r?.nextCursor === 'string' && r.nextCursor ? r.nextCursor : undefined;
      if (!cursor) break;
    }
    this.toolsCache = all;
    return all;
  }

  async callTool(name: string, args: any): Promise<string> {
    await this.connect();
    const r = await this.request('tools/call', { name, arguments: args && typeof args === 'object' ? args : {} }, CALL_TIMEOUT_MS);
    return formatToolResult(r);
  }

  async close(markOff = true) {
    if (markOff) this.status = 'off';
    const t = this.transport;
    this.transport = null;
    this.toolsCache = null;
    this.rejectAll(new Error('Disconnected'));
    if (t) await t.close().catch(() => {});
  }
}

function formatToolResult(r: any): string {
  const parts: string[] = [];
  for (const c of Array.isArray(r?.content) ? r.content : []) {
    if (!c) continue;
    if (c.type === 'text') parts.push(String(c.text ?? ''));
    else if (c.type === 'image' || c.type === 'audio') parts.push(`[${c.type}: ${c.mimeType || 'binary'}]`);
    else if (c.type === 'resource') parts.push(c.resource?.text != null ? String(c.resource.text) : `[resource: ${c.resource?.uri || ''}]`);
    else if (c.type === 'resource_link') parts.push(`[resource: ${c.name || ''} ${c.uri || ''}]`.trim());
    else parts.push(JSON.stringify(c));
  }
  if (!parts.length && r?.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent));
  let out = parts.join('\n');
  if (r?.isError) out = 'Error: ' + (out || 'tool reported an error');
  if (out.length > MAX_TOOL_OUTPUT_CHARS) out = out.slice(0, MAX_TOOL_OUTPUT_CHARS) + '\n…[truncated]';
  return out || '(no output)';
}

// ───────────────────────────── registry ─────────────────────────────

/** live connections, keyed by profile AND app id: two profiles may hold an app with the same id */
const conns = new Map<string, Connection>();
const connKey = (profileId: string, id: string) => profileId + '\u0000' + id;

function getCfg(profileId: string, id: string): McpServerConfig {
  const cfg = storeFor(profileId).get().find((s) => s.id === id);
  if (!cfg) throw new Error(`Unknown app: ${id}`);
  return cfg;
}

function connFor(profileId: string, id: string): Connection {
  const cfg = getCfg(profileId, id);
  let c = conns.get(connKey(profileId, id));
  if (!c) {
    c = new Connection(profileId, cfg);
    conns.set(connKey(profileId, id), c);
  } else c.cfg = cfg;
  return c;
}

function normalize(input: any, existing?: McpServerConfig): McpServerConfig {
  const transport: McpTransport = input.transport === 'http' ? 'http' : 'stdio';
  const name = String(input.name ?? existing?.name ?? '').trim().slice(0, 80);
  if (!name) throw new Error('Name is required');
  const cfg: McpServerConfig = {
    id: existing?.id || (isSafeId(input.id) ? input.id : newId(name)),
    name,
    transport,
    enabled: input.enabled ?? existing?.enabled ?? true,
  };
  if (transport === 'http') {
    cfg.url = validateUrl(input.url ?? existing?.url ?? '');
  } else {
    const command = String(input.command ?? existing?.command ?? '').trim();
    if (!command) throw new Error('Command is required');
    if (command.includes('\0') || /[\r\n]/.test(command)) throw new Error('Invalid command');
    cfg.command = command;
    const args = input.args ?? existing?.args ?? [];
    if (!Array.isArray(args)) throw new Error('args must be a list');
    cfg.args = args.map((a: any) => { const s = String(a); if (s.includes('\0')) throw new Error('Invalid argument'); return s; });
    cfg.env = sanitizeEnv(input.env ?? existing?.env);
  }
  const icon = input.icon ?? existing?.icon;
  if (icon) cfg.icon = String(icon).slice(0, 2048);
  const desc = input.description ?? existing?.description;
  if (desc) cfg.description = String(desc).slice(0, 500);
  return cfg;
}

// ───────────────────────────── public API ─────────────────────────────

export const mcp = {
  /** server configs for the profile (token never returned, only hasToken) */
  list(profileId: string): McpServerView[] {
    return storeFor(profileId).get().map((s) => {
      const c = conns.get(connKey(profileId, s.id));
      const st: McpStatus = c ? c.status : 'off';
      return { ...s, hasToken: secrets.has(tokenKey(profileId, s.id)), status: st, error: st === 'error' ? c?.error : undefined };
    });
  },

  /** create or update. `token`: string sets it, '' or null clears it, undefined leaves it. */
  upsert(profileId: string, cfg: Partial<McpServerConfig> & { token?: string | null }): McpServerConfig {
    const store = storeFor(profileId);
    const list = store.get();
    const existing = cfg.id ? list.find((s) => s.id === cfg.id) : undefined;
    const next = normalize(cfg, existing);
    store.update((d) => {
      const i = d.findIndex((s) => s.id === next.id);
      if (i >= 0) d[i] = next; else d.push(next);
    });
    store.flush();
    if (cfg.token !== undefined) secrets.set(tokenKey(profileId, next.id), cfg.token ? String(cfg.token).trim() : null);
    // config changed → drop any live connection so the next use reconnects with new settings
    const c = conns.get(connKey(profileId, next.id));
    if (c) { conns.delete(connKey(profileId, next.id)); c.close().catch(() => {}); }
    return next;
  },

  remove(profileId: string, id: string) {
    const c = conns.get(connKey(profileId, id));
    if (c) { conns.delete(connKey(profileId, id)); c.close().catch(() => {}); }
    storeFor(profileId).update((d) => d.filter((s) => s.id !== id));
    storeFor(profileId).flush();
    secrets.set(tokenKey(profileId, id), null);
  },

  async connect(profileId: string, id: string): Promise<{ ok: boolean; status: McpStatus; error?: string; tools?: number; serverInfo?: any }> {
    const c = connFor(profileId, id);
    try {
      await c.connect();
      const tools = await c.listTools();
      return { ok: true, status: c.status, tools: tools.length, serverInfo: c.serverInfo };
    } catch (e) {
      return { ok: false, status: c.status, error: c.error || errMsg(e) };
    }
  },

  async disconnect(profileId: string, id: string) {
    const c = conns.get(connKey(profileId, id));
    if (!c) return;
    conns.delete(connKey(profileId, id));
    await c.close();
  },

  status(profileId: string, id: string): McpStatus {
    return conns.get(connKey(profileId, id))?.status ?? 'off';
  },

  /** all tools from enabled servers of this profile (auto-connects; failing servers are skipped) */
  async tools(profileId: string): Promise<McpTool[]> {
    const servers = storeFor(profileId).get().filter((s) => s.enabled);
    const results = await Promise.all(servers.map(async (s) => {
      try {
        const c = connFor(profileId, s.id);
        const list = await c.listTools();
        return list.map((t: any) => ({
          serverId: s.id,
          serverName: s.name,
          name: String(t.name),
          description: String(t.description || t.title || ''),
          inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} },
        }));
      } catch (e) {
        console.warn('[mcp] tools unavailable for', s.name, '-', errMsg(e));
        return [] as McpTool[];
      }
    }));
    return results.flat();
  },

  async call(profileId: string, serverId: string, toolName: string, args: any): Promise<string> {
    const cfg = getCfg(profileId, serverId);
    if (!cfg.enabled) throw new Error(`${cfg.name} is turned off`);
    return connFor(profileId, serverId).callTool(String(toolName), args);
  },

  async disconnectAll() {
    const all = [...conns.values()];
    conns.clear();
    await Promise.all(all.map((c) => c.close().catch(() => {})));
  },
};

// ───────────────────────────── OpenAI function tools ─────────────────────────────

const fnRegistry = new Map<string, { serverId: string; toolName: string }>();

function fnName(serverId: string, toolName: string): string {
  const clean = (s: string) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
  let n = `mcp__${clean(serverId)}__${clean(toolName)}`;
  if (n.length > 64) {
    const h = crypto.createHash('sha1').update(serverId + '\0' + toolName).digest('hex').slice(0, 6);
    n = n.slice(0, 57) + '_' + h;
  }
  return n;
}

function toObjectSchema(s: any): any {
  const schema = s && typeof s === 'object' ? { ...s } : {};
  if (schema.type !== 'object') return { type: 'object', properties: {} };
  if (!schema.properties || typeof schema.properties !== 'object') schema.properties = {};
  delete schema.$schema;
  return schema;
}

/** MCP tools → OpenAI `tools` entries named mcp__<serverId>__<toolName> (sanitized, ≤64 chars). */
export function mcpToolsAsFunctions(tools: McpTool[]) {
  return tools.map((t) => {
    const name = fnName(t.serverId, t.name);
    fnRegistry.set(name, { serverId: t.serverId, toolName: t.name });
    const desc = `[${t.serverName}] ${t.description || t.name}`;
    return {
      type: 'function' as const,
      function: {
        name,
        description: desc.length > 1024 ? desc.slice(0, 1021) + '...' : desc,
        parameters: toObjectSchema(t.inputSchema),
      },
    };
  });
}

/** Reverse of mcpToolsAsFunctions. Returns null if `name` is not an MCP function name. */
export function parseMcpToolName(name: string): { serverId: string; toolName: string } | null {
  if (typeof name !== 'string' || !name.startsWith('mcp__')) return null;
  const hit = fnRegistry.get(name);
  if (hit) return { ...hit };
  const rest = name.slice(5);
  const i = rest.indexOf('__');
  if (i <= 0) return null;
  return { serverId: rest.slice(0, i), toolName: rest.slice(i + 2) };
}

// ───────────────────────────── one-click catalog ─────────────────────────────
// Each URL was probed on 2026-10-26 with an MCP `initialize` POST and answered as an MCP
// endpoint (200 with an initialize result, or 401 with an OAuth WWW-Authenticate challenge).

export const APP_CATALOG: AppCatalogEntry[] = [
  // Essentials
  { name: 'Context7', description: 'Up-to-date library and framework docs for coding', category: 'Essentials', transport: 'http', url: 'https://mcp.context7.com/mcp', needsToken: false, iconDomain: 'context7.com' },
  { name: 'DeepWiki', description: 'Ask questions about any public GitHub repository', category: 'Essentials', transport: 'http', url: 'https://mcp.deepwiki.com/mcp', needsToken: false, iconDomain: 'deepwiki.com' },
  { name: 'Exa', description: 'AI web search and page contents', category: 'Essentials', transport: 'http', url: 'https://mcp.exa.ai/mcp', needsToken: false, iconDomain: 'exa.ai' },
  { name: 'Hugging Face', description: 'Search models, datasets, Spaces and papers', category: 'Essentials', transport: 'http', url: 'https://huggingface.co/mcp', needsToken: false, iconDomain: 'huggingface.co' },
  { name: 'Cloudflare Docs', description: 'Search Cloudflare developer documentation', category: 'Essentials', transport: 'http', url: 'https://docs.mcp.cloudflare.com/mcp', needsToken: false, iconDomain: 'cloudflare.com' },
  { name: 'Zapier', description: 'Run actions across 8,000+ apps', category: 'Essentials', transport: 'http', url: 'https://mcp.zapier.com/api/mcp/mcp', needsToken: true, iconDomain: 'zapier.com' },
  // Productivity
  { name: 'Notion', description: 'Search, read and edit your Notion pages and databases', category: 'Productivity', transport: 'http', url: 'https://mcp.notion.com/mcp', needsToken: true, iconDomain: 'notion.so' },
  { name: 'Linear', description: 'Issues, projects and cycles in Linear', category: 'Productivity', transport: 'http', url: 'https://mcp.linear.app/mcp', needsToken: true, iconDomain: 'linear.app' },
  { name: 'Atlassian', description: 'Jira issues and Confluence pages', category: 'Productivity', transport: 'http', url: 'https://mcp.atlassian.com/v1/mcp', needsToken: true, iconDomain: 'atlassian.com' },
  { name: 'Asana', description: 'Tasks, projects and goals in Asana', category: 'Productivity', transport: 'http', url: 'https://mcp.asana.com/v2/mcp', needsToken: true, iconDomain: 'asana.com' },
  { name: 'monday.com', description: 'Boards, items and updates on monday.com', category: 'Productivity', transport: 'http', url: 'https://mcp.monday.com/mcp', needsToken: true, iconDomain: 'monday.com' },
  { name: 'ClickUp', description: 'Tasks, docs and spaces in ClickUp', category: 'Productivity', transport: 'http', url: 'https://mcp.clickup.com/mcp', needsToken: true, iconDomain: 'clickup.com' },
  { name: 'Airtable', description: 'Read and update Airtable bases', category: 'Productivity', transport: 'http', url: 'https://mcp.airtable.com/mcp', needsToken: true, iconDomain: 'airtable.com' },
  { name: 'Canva', description: 'Create and find Canva designs', category: 'Productivity', transport: 'http', url: 'https://mcp.canva.com/mcp', needsToken: true, iconDomain: 'canva.com' },
  { name: 'Figma', description: 'Design context from Figma files', category: 'Productivity', transport: 'http', url: 'https://mcp.figma.com/mcp', needsToken: true, iconDomain: 'figma.com' },
  { name: 'Box', description: 'Search and read files in Box', category: 'Productivity', transport: 'http', url: 'https://mcp.box.com', needsToken: true, iconDomain: 'box.com' },
  // Sales & CRM
  { name: 'HubSpot', description: 'Contacts, companies and deals in HubSpot CRM', category: 'Sales & CRM', transport: 'http', url: 'https://mcp.hubspot.com/', needsToken: true, iconDomain: 'hubspot.com' },
  { name: 'Stripe', description: 'Customers, payments, invoices and Stripe docs', category: 'Sales & CRM', transport: 'http', url: 'https://mcp.stripe.com', needsToken: true, iconDomain: 'stripe.com' },
  { name: 'PayPal', description: 'Invoices, orders and transactions in PayPal', category: 'Sales & CRM', transport: 'http', url: 'https://mcp.paypal.com/mcp', needsToken: true, iconDomain: 'paypal.com' },
  { name: 'Intercom', description: 'Conversations and contacts in Intercom', category: 'Sales & CRM', transport: 'http', url: 'https://mcp.intercom.com/mcp', needsToken: true, iconDomain: 'intercom.com' },
  { name: 'Attio', description: 'Records, lists and notes in Attio CRM', category: 'Sales & CRM', transport: 'http', url: 'https://mcp.attio.com/mcp', needsToken: true, iconDomain: 'attio.com' },
  { name: 'Close', description: 'Leads, opportunities and activities in Close CRM', category: 'Sales & CRM', transport: 'http', url: 'https://mcp.close.com/mcp', needsToken: true, iconDomain: 'close.com' },
  // Dev
  { name: 'GitHub', description: 'Repos, issues, pull requests and code search', category: 'Dev', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', needsToken: true, iconDomain: 'github.com' },
  { name: 'Sentry', description: 'Errors, issues and performance data from Sentry', category: 'Dev', transport: 'http', url: 'https://mcp.sentry.dev/mcp', needsToken: true, iconDomain: 'sentry.io' },
  { name: 'Vercel', description: 'Projects, deployments and logs on Vercel', category: 'Dev', transport: 'http', url: 'https://mcp.vercel.com', needsToken: true, iconDomain: 'vercel.com' },
  { name: 'Supabase', description: 'Manage Supabase projects, databases and edge functions', category: 'Dev', transport: 'http', url: 'https://mcp.supabase.com/mcp', needsToken: true, iconDomain: 'supabase.com' },
  { name: 'Netlify', description: 'Sites, deploys and settings on Netlify', category: 'Dev', transport: 'http', url: 'https://netlify-mcp.netlify.app/mcp', needsToken: true, iconDomain: 'netlify.com' },
  { name: 'Neon', description: 'Serverless Postgres projects and queries', category: 'Dev', transport: 'http', url: 'https://mcp.neon.tech/mcp', needsToken: true, iconDomain: 'neon.tech' },
  { name: 'Cloudflare', description: 'Workers, KV, R2 and D1 on your Cloudflare account', category: 'Dev', transport: 'http', url: 'https://bindings.mcp.cloudflare.com/mcp', needsToken: true, iconDomain: 'cloudflare.com' },
  // Data
  { name: 'PostHog', description: 'Product analytics, insights and feature flags', category: 'Data', transport: 'http', url: 'https://mcp.posthog.com/mcp', needsToken: true, iconDomain: 'posthog.com' },
  { name: 'Apify', description: 'Run web scrapers and data-extraction Actors', category: 'Data', transport: 'http', url: 'https://mcp.apify.com', needsToken: true, iconDomain: 'apify.com' },
];
