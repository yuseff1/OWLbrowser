/**
 * Import user data from Chromium-family browsers (Chrome, Edge, Brave, Opera, Vivaldi).
 *
 * Security notes:
 *  - Secrets (decrypted passwords, master keys) never reach console/logs/progress messages/errors.
 *  - The DPAPI master key is passed to PowerShell over stdin, never on the command line.
 *  - SQLite files are copied to a private temp file, read, then the copy is deleted.
 *  - All SQL is static (no interpolation of external data).
 *  - Extension ids / profile ids are validated before being used in filesystem paths.
 */
import { app } from 'electron';
import type { Session, Extension } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn, execFile } from 'child_process';
import type { SqlJsStatic, Database } from 'sql.js';
import { history, bookmarks as bookmarkStore } from '../data';
import { JsonStore, uid } from '../store';
import { secrets } from '../secrets';
import { profiles } from '../profiles';
import type { ImportSource, ImportResult, HistoryEntry, PasswordEntry } from '../../shared/types';

type BrowserKey = ImportSource['browser'];

export type ImportWhat = {
  bookmarks: boolean;
  history: boolean;
  passwords: boolean;
  extensions: boolean;
  searchEngines?: boolean;
};

type Progress = (msg: string) => void;

// ---------------------------------------------------------------------------
// Browser locations
// ---------------------------------------------------------------------------

type BrowserRoot = {
  browser: BrowserKey;
  label: string;
  /** user data dir (contains `Local State`) */
  dir: string;
  /** Opera keeps the profile files directly in the user data dir */
  flat?: boolean;
  /** macOS keychain service name for "Safe Storage" */
  macService?: string;
  /** Linux libsecret application attribute */
  linuxApp?: string;
};

function browserRoots(): BrowserRoot[] {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return [
      { browser: 'chrome', label: 'Chrome', dir: path.join(local, 'Google', 'Chrome', 'User Data') },
      { browser: 'chrome', label: 'Chrome Beta', dir: path.join(local, 'Google', 'Chrome Beta', 'User Data') },
      { browser: 'chrome', label: 'Chrome Canary', dir: path.join(local, 'Google', 'Chrome SxS', 'User Data') },
      { browser: 'chrome', label: 'Chromium', dir: path.join(local, 'Chromium', 'User Data') },
      { browser: 'edge', label: 'Edge', dir: path.join(local, 'Microsoft', 'Edge', 'User Data') },
      { browser: 'brave', label: 'Brave', dir: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
      { browser: 'vivaldi', label: 'Vivaldi', dir: path.join(local, 'Vivaldi', 'User Data') },
      { browser: 'opera', label: 'Opera', dir: path.join(roaming, 'Opera Software', 'Opera Stable'), flat: true },
      { browser: 'opera', label: 'Opera GX', dir: path.join(roaming, 'Opera Software', 'Opera GX Stable'), flat: true },
    ];
  }
  if (process.platform === 'darwin') {
    const as = path.join(home, 'Library', 'Application Support');
    return [
      { browser: 'chrome', label: 'Chrome', dir: path.join(as, 'Google', 'Chrome'), macService: 'Chrome Safe Storage' },
      { browser: 'chrome', label: 'Chromium', dir: path.join(as, 'Chromium'), macService: 'Chromium Safe Storage' },
      { browser: 'edge', label: 'Edge', dir: path.join(as, 'Microsoft Edge'), macService: 'Microsoft Edge Safe Storage' },
      { browser: 'brave', label: 'Brave', dir: path.join(as, 'BraveSoftware', 'Brave-Browser'), macService: 'Brave Safe Storage' },
      { browser: 'vivaldi', label: 'Vivaldi', dir: path.join(as, 'Vivaldi'), macService: 'Vivaldi Safe Storage' },
      { browser: 'opera', label: 'Opera', dir: path.join(as, 'com.operasoftware.Opera'), flat: true, macService: 'Opera Safe Storage' },
    ];
  }
  const cfg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [
    { browser: 'chrome', label: 'Chrome', dir: path.join(cfg, 'google-chrome'), linuxApp: 'chrome' },
    { browser: 'chrome', label: 'Chromium', dir: path.join(cfg, 'chromium'), linuxApp: 'chromium' },
    { browser: 'edge', label: 'Edge', dir: path.join(cfg, 'microsoft-edge'), linuxApp: 'chromium' },
    { browser: 'brave', label: 'Brave', dir: path.join(cfg, 'BraveSoftware', 'Brave-Browser'), linuxApp: 'brave' },
    { browser: 'vivaldi', label: 'Vivaldi', dir: path.join(cfg, 'vivaldi'), linuxApp: 'vivaldi' },
    { browser: 'opera', label: 'Opera', dir: path.join(cfg, 'opera'), flat: true, linuxApp: 'chromium' },
  ];
}

function exists(p: string): boolean {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function readJson<T = any>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return null; }
}

/** A dir counts as a profile if it holds typical profile files. */
function looksLikeProfile(dir: string): boolean {
  return ['Preferences', 'Bookmarks', 'History', 'Login Data'].some((f) => exists(path.join(dir, f)));
}

/** Resolve the user-data dir (where `Local State` lives) for a profile path. */
function userDataDirFor(profilePath: string): string {
  if (exists(path.join(profilePath, 'Local State'))) return profilePath; // Opera (flat)
  return path.dirname(profilePath);
}

function rootFor(src: ImportSource): BrowserRoot | undefined {
  const ud = path.resolve(userDataDirFor(src.path));
  return browserRoots().find((r) => path.resolve(r.dir) === ud) ?? browserRoots().find((r) => r.browser === src.browser);
}

// ---------------------------------------------------------------------------
// detectSources
// ---------------------------------------------------------------------------

export async function detectSources(): Promise<ImportSource[]> {
  const out: ImportSource[] = [];
  for (const root of browserRoots()) {
    if (!exists(root.dir)) continue;
    const localState = readJson<any>(path.join(root.dir, 'Local State'));
    const infoCache: Record<string, any> = localState?.profile?.info_cache ?? {};
    const found = new Map<string, string>();

    if (root.flat && looksLikeProfile(root.dir)) {
      found.set('', root.label);
    }
    for (const [dirName, info] of Object.entries(infoCache)) {
      const p = path.join(root.dir, dirName);
      if (!looksLikeProfile(p)) continue;
      const name = (info && (info.name || info.gaia_name || info.user_name)) || dirName;
      found.set(dirName, String(name));
    }
    // Fallback scan: Default, Profile N
    try {
      for (const d of fs.readdirSync(root.dir, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        if (!(d.name === 'Default' || /^Profile \d+$/.test(d.name))) continue;
        if (found.has(d.name)) continue;
        if (looksLikeProfile(path.join(root.dir, d.name))) found.set(d.name, d.name === 'Default' ? 'Default' : d.name);
      }
    } catch { /* unreadable dir */ }

    for (const [dirName, name] of found) {
      out.push({
        browser: root.browser,
        profileDir: dirName || root.label,
        profileName: root.label === labelFor(root.browser) ? name : `${root.label} – ${name}`,
        path: dirName ? path.join(root.dir, dirName) : root.dir,
      });
    }
  }
  return out;
}

function labelFor(b: BrowserKey): string {
  return ({ chrome: 'Chrome', edge: 'Edge', brave: 'Brave', opera: 'Opera', vivaldi: 'Vivaldi' } as const)[b];
}

// ---------------------------------------------------------------------------
// SQLite helpers (sql.js)
// ---------------------------------------------------------------------------

let sqlPromise: Promise<SqlJsStatic> | null = null;

function wasmPath(): string {
  let p = require.resolve('sql.js/dist/sql-wasm.wasm');
  const unpacked = p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  if (unpacked !== p && exists(unpacked)) p = unpacked;
  return p;
}

function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const initSqlJs = require('sql.js') as (cfg?: any) => Promise<SqlJsStatic>;
    const wasm = wasmPath();
    sqlPromise = initSqlJs({ wasmBinary: fs.readFileSync(wasm), locateFile: () => wasm }).catch((e) => {
      sqlPromise = null;
      throw e;
    });
  }
  return sqlPromise;
}

/** Copy a (possibly locked) SQLite DB to a private temp file and open it in memory. */
async function openCopy(file: string): Promise<Database> {
  const SQL = await getSql();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-import-'));
  const tmp = path.join(tmpDir, 'db.sqlite');
  try {
    fs.copyFileSync(file, tmp);
    const buf = fs.readFileSync(tmp);
    return new SQL.Database(new Uint8Array(buf));
  } catch (e: any) {
    if (e && (e.code === 'EBUSY' || e.code === 'EPERM')) {
      throw new Error(`${path.basename(file)} is locked – close the browser and try again`);
    }
    throw e;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function queryAll(db: Database, sql: string): Record<string, any>[] {
  const rows: Record<string, any>[] = [];
  const stmt = db.prepare(sql);
  try {
    while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, any>);
  } finally {
    stmt.free();
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

const ROOT_NAMES: Record<string, string> = {
  bookmark_bar: 'Bookmarks bar',
  other: 'Other bookmarks',
  synced: 'Mobile bookmarks',
};

function isImportableUrl(u: string): boolean {
  return /^(https?|ftp|file):/i.test(u);
}

function importBookmarks(src: ImportSource, profileId: string): number {
  const file = path.join(src.path, 'Bookmarks');
  if (!exists(file)) return 0;
  const json = readJson<any>(file);
  if (!json || !json.roots) throw new Error('Bookmarks file is unreadable');
  let count = 0;
  const walk = (node: any, folder: string, depth: number) => {
    if (!node || depth > 64) return;
    if (node.type === 'url') {
      const url = String(node.url || '');
      if (!isImportableUrl(url)) return;
      bookmarkStore.add(profileId, { url, title: String(node.name || url), folder });
      count++;
      return;
    }
    const children: any[] = Array.isArray(node.children) ? node.children : [];
    for (const c of children) {
      if (c && c.type === 'folder') walk(c, `${folder} / ${String(c.name || 'Folder')}`, depth + 1);
      else walk(c, folder, depth + 1);
    }
  };
  for (const [key, label] of Object.entries(ROOT_NAMES)) {
    if (json.roots[key]) walk(json.roots[key], label, 0);
  }
  return count;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** WebKit epoch: microseconds since 1601-01-01 UTC. Offset to Unix epoch in ms. */
const WEBKIT_EPOCH_OFFSET_MS = 11644473600000;
const HISTORY_LIMIT = 50000;

async function importHistory(src: ImportSource, profileId: string): Promise<number> {
  const file = path.join(src.path, 'History');
  if (!exists(file)) return 0;
  const db = await openCopy(file);
  try {
    let rows: Record<string, any>[];
    // Divide in SQL so values stay inside the JS safe-integer range.
    const base = 'SELECT url, title, visit_count, (last_visit_time / 1000) AS t FROM urls';
    try {
      rows = queryAll(db, `${base} WHERE hidden = 0 ORDER BY last_visit_time DESC LIMIT ${HISTORY_LIMIT}`);
    } catch {
      rows = queryAll(db, `${base} ORDER BY last_visit_time DESC LIMIT ${HISTORY_LIMIT}`);
    }
    const entries: HistoryEntry[] = [];
    for (const r of rows) {
      const url = String(r.url || '');
      if (!/^https?:/i.test(url)) continue;
      const t = Number(r.t) || 0;
      entries.push({
        url,
        title: String(r.title || '') || url,
        visits: Math.max(1, Number(r.visit_count) || 1),
        lastVisit: t > 0 ? Math.round(t - WEBKIT_EPOCH_OFFSET_MS) : 0,
      });
    }
    if (entries.length) history.importMany(profileId, entries);
    return entries.length;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Password store (metadata in JSON, secret in safeStorage-backed secrets)
// ---------------------------------------------------------------------------

const pwStores = new Map<string, JsonStore<PasswordEntry[]>>();

function pwStore(profileId: string): JsonStore<PasswordEntry[]> {
  let s = pwStores.get(profileId);
  if (!s) {
    s = new JsonStore<PasswordEntry[]>('passwords', [], profiles.dataDir(profileId));
    pwStores.set(profileId, s);
  }
  return s;
}

const secretKey = (profileId: string, id: string) => 'pw:' + profileId + ':' + id;

/** Normalise to scheme://host[:port] for web origins; other schemes (android://) kept as-is. */
function normOrigin(o: string): string {
  const s = String(o || '').trim();
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
  } catch { /* not a URL */ }
  return s.replace(/\/+$/, '');
}

export const passwords = {
  list(profileId: string): PasswordEntry[] {
    return pwStore(profileId).get().map((e) => ({ ...e }));
  },
  /** Upserts by (origin, username). Returns the entry id. */
  save(profileId: string, origin: string, username: string, password: string): string {
    const o = normOrigin(origin);
    const user = String(username ?? '');
    const store = pwStore(profileId);
    let id = store.get().find((e) => e.origin === o && e.username === user)?.id;
    if (!id) {
      id = uid('pw_');
      const entry: PasswordEntry = { id, origin: o, username: user, createdAt: Date.now() };
      store.update((l) => { l.push(entry); });
    }
    secrets.set(secretKey(profileId, id), password);
    return id;
  },
  get(profileId: string, id: string): { username: string; password: string } | null {
    const e = pwStore(profileId).get().find((x) => x.id === id);
    if (!e) return null;
    const pw = secrets.get(secretKey(profileId, id));
    if (pw == null) return null;
    pwStore(profileId).update((l) => { const x = l.find((y) => y.id === id); if (x) x.lastUsed = Date.now(); });
    return { username: e.username, password: pw };
  },
  findForOrigin(profileId: string, origin: string): PasswordEntry[] {
    const o = normOrigin(origin);
    return pwStore(profileId).get().filter((e) => e.origin === o).map((e) => ({ ...e }));
  },
  remove(profileId: string, id: string): void {
    pwStore(profileId).update((l) => l.filter((e) => e.id !== id));
    secrets.set(secretKey(profileId, id), null);
  },
};

// ---------------------------------------------------------------------------
// Password decryption
// ---------------------------------------------------------------------------

const PS_TIMEOUT_MS = 30000;

/**
 * DPAPI-unprotect one or more base64 blobs (CurrentUser scope) via PowerShell.
 * Input goes over stdin (one base64 per line); output is one base64 per line ('' on failure).
 */
function dpapiUnprotect(blobsB64: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const script =
      "$ErrorActionPreference='Stop';" +
      'Add-Type -AssemblyName System.Security;' +
      '$lines=[Console]::In.ReadToEnd() -split "`n";' +
      'foreach($l in $lines){$in=$l.Trim(); if($in -eq \'\'){continue};' +
      'try{[Console]::Out.WriteLine([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($in),$null,\'CurrentUser\')))}' +
      'catch{[Console]::Out.WriteLine(\'\')}}';
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let errLen = 0;
    const timer = setTimeout(() => { ps.kill(); reject(new Error('Windows decryption timed out')); }, PS_TIMEOUT_MS);
    ps.stdout.on('data', (d) => { out += d.toString('utf8'); });
    ps.stderr.on('data', (d) => { errLen += d.length; }); // never surface stderr: may echo input
    ps.on('error', (e) => { clearTimeout(timer); reject(new Error('Could not start PowerShell: ' + e.message)); });
    ps.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) return reject(new Error(`Windows decryption failed (code ${code}${errLen ? ', stderr suppressed' : ''})`));
      const lines = out.split(/\r?\n/).map((s) => s.trim());
      resolve(blobsB64.map((_, i) => lines[i] ?? ''));
    });
    ps.stdin.end(blobsB64.join('\n') + '\n');
  });
}

async function windowsMasterKey(userDataDir: string): Promise<Buffer | null> {
  const ls = readJson<any>(path.join(userDataDir, 'Local State'));
  const encKeyB64: string | undefined = ls?.os_crypt?.encrypted_key;
  if (!encKeyB64) return null;
  let raw = Buffer.from(encKeyB64, 'base64');
  if (raw.subarray(0, 5).toString('latin1') === 'DPAPI') raw = raw.subarray(5);
  const [outB64] = await dpapiUnprotect([raw.toString('base64')]);
  if (!outB64) return null;
  const key = Buffer.from(outB64, 'base64');
  return key.length === 32 ? key : null;
}

function aesGcmDecrypt(key: Buffer, blob: Buffer): string | null {
  // blob = 'v10' | nonce(12) | ciphertext | tag(16)
  if (blob.length < 3 + 12 + 16) return null;
  try {
    const nonce = blob.subarray(3, 15);
    const tag = blob.subarray(blob.length - 16);
    const ct = blob.subarray(15, blob.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function aesCbcDecrypt(key: Buffer, blob: Buffer): string | null {
  // macOS/Linux: 'v10'|'v11' + AES-128-CBC, IV = 16 spaces
  try {
    const d = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
    return Buffer.concat([d.update(blob.subarray(3)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function macSafeStoragePassword(service: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-w', '-s', service], { timeout: PS_TIMEOUT_MS }, (err, stdout) => {
      if (err) return resolve(null);
      const v = String(stdout || '').trim();
      resolve(v || null);
    });
  });
}

function linuxKeyringPassword(appName: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('secret-tool', ['lookup', 'application', appName], { timeout: 10000 }, (err, stdout) => {
      if (err) return resolve(null);
      const v = String(stdout || '').trim();
      resolve(v || null);
    });
  });
}

const deriveCbcKey = (pw: string, iterations: number) => crypto.pbkdf2Sync(pw, 'saltysalt', iterations, 16, 'sha1');

type Decryptor = {
  /** Returns plaintext, or 'v20' for app-bound blobs, or null on failure. Legacy DPAPI blobs are queued. */
  decrypt(blob: Buffer): string | 'v20' | null | { legacy: true };
};

async function makeDecryptor(src: ImportSource): Promise<Decryptor> {
  const userDataDir = userDataDirFor(src.path);
  if (process.platform === 'win32') {
    let key: Buffer | null = null;
    try { key = await windowsMasterKey(userDataDir); } catch { key = null; }
    return {
      decrypt(blob) {
        const prefix = blob.subarray(0, 3).toString('latin1');
        if (prefix === 'v20') return 'v20';
        if (prefix === 'v10' || prefix === 'v11') return key ? aesGcmDecrypt(key, blob) : null;
        return blob.length ? { legacy: true } : null; // pre-Chrome-80: whole blob is DPAPI
      },
    };
  }
  const root = rootFor(src);
  let v10: Buffer | null = null;
  let v11: Buffer | null = null;
  if (process.platform === 'darwin') {
    const pw = root?.macService ? await macSafeStoragePassword(root.macService) : null;
    if (pw) v10 = v11 = deriveCbcKey(pw, 1003);
  } else {
    v10 = deriveCbcKey('peanuts', 1);
    const pw = root?.linuxApp ? await linuxKeyringPassword(root.linuxApp) : null;
    if (pw) v11 = deriveCbcKey(pw, 1);
  }
  return {
    decrypt(blob) {
      const prefix = blob.subarray(0, 3).toString('latin1');
      if (prefix === 'v10' && v10) return aesCbcDecrypt(v10, blob);
      if (prefix === 'v11' && v11) return aesCbcDecrypt(v11, blob);
      if (prefix === 'v20') return 'v20';
      return null;
    },
  };
}

const V20_MESSAGE = (n: number, browserName: string) =>
  `${n} password${n === 1 ? '' : 's'} use ${browserName}'s app-bound encryption and can't be read from outside the browser. ` +
  `Export them from chrome://password-manager/settings ("Export passwords") and use "Import passwords CSV" in OWL.`;

async function importPasswords(src: ImportSource, profileId: string, errors: string[], onProgress?: Progress): Promise<number> {
  const file = path.join(src.path, 'Login Data');
  if (!exists(file)) return 0;
  const db = await openCopy(file);
  let rows: Record<string, any>[];
  try {
    rows = queryAll(db, 'SELECT origin_url, username_value, password_value FROM logins WHERE blacklisted_by_user = 0');
  } catch {
    rows = queryAll(db, 'SELECT origin_url, username_value, password_value FROM logins');
  } finally {
    db.close();
  }
  if (!rows.length) return 0;

  onProgress?.(`Decrypting ${rows.length} saved passwords…`);
  const dec = await makeDecryptor(src);
  let saved = 0;
  let appBound = 0;
  let failed = 0;
  const legacy: { origin: string; username: string; b64: string }[] = [];

  for (const r of rows) {
    const origin = String(r.origin_url || '');
    const username = String(r.username_value || '');
    const val = r.password_value;
    if (!origin || !val) continue;
    const blob = Buffer.from(val as Uint8Array);
    if (!blob.length) continue;
    const res = dec.decrypt(blob);
    if (res === 'v20') { appBound++; continue; }
    if (res && typeof res === 'object') { legacy.push({ origin, username, b64: blob.toString('base64') }); continue; }
    if (typeof res === 'string' && res.length) { passwords.save(profileId, origin, username, res); saved++; }
    else failed++;
  }

  if (legacy.length) {
    try {
      const outs = await dpapiUnprotect(legacy.map((l) => l.b64));
      legacy.forEach((l, i) => {
        const pw = outs[i] ? Buffer.from(outs[i], 'base64').toString('utf8') : '';
        if (pw) { passwords.save(profileId, l.origin, l.username, pw); saved++; } else failed++;
      });
    } catch {
      failed += legacy.length;
    }
  }

  if (appBound) errors.push(V20_MESSAGE(appBound, labelFor(src.browser)));
  if (failed) errors.push(`${failed} password${failed === 1 ? '' : 's'} could not be decrypted. You can export a passwords CSV from the browser and import it instead.`);
  secrets.flush();
  return saved;
}

// ---------------------------------------------------------------------------
// Passwords CSV (Chrome/Edge/Brave export: name,url,username,password,note)
// ---------------------------------------------------------------------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

export function importPasswordsCsv(csvText: string, profileId: string): number {
  const rows = parseCsv(String(csvText || ''));
  if (!rows.length) return 0;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  let iUrl = col('url', 'origin', 'origin_url', 'login_uri', 'website');
  let iUser = col('username', 'login', 'user', 'login_username', 'username_value');
  let iPw = col('password', 'login_password', 'password_value');
  let start = 1;
  if (iUrl < 0 || iPw < 0) {
    // No recognisable header: assume Chrome's column order name,url,username,password,note
    iUrl = 1; iUser = 2; iPw = 3; start = 0;
  }
  let count = 0;
  for (let r = start; r < rows.length; r++) {
    const row = rows[r];
    const url = (row[iUrl] ?? '').trim();
    const pw = row[iPw] ?? '';
    const user = iUser >= 0 ? (row[iUser] ?? '') : '';
    if (!url || !pw) continue;
    if (!/^(https?:\/\/|android:\/\/)/i.test(url)) continue;
    passwords.save(profileId, url, user, pw);
    count++;
  }
  secrets.flush();
  return count;
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

/** Default-installed / component extensions that appear in the Extensions folder but aren't user picks. */
const SKIP_EXTENSION_IDS = new Set<string>([
  'nmmhkkegccagdldgiimedpiccmgmieda', // Chrome Web Store Payments
  'ghbmnnjooekpmoecnnnilnnbdlolhkhi', // Google Docs Offline
  'pkedcjkdefgpdelpbcmbmeomcjbeemfm', // Chrome Media Router / Cast
  'mhjfbmdgcfjbbpaeojofohoefgiehjai', // Chrome PDF Viewer
  'neajdppkdcdipfabeoofebfddakdcjhd', // Google Network Speech
  'nkeimhogjdpnpccoofpliimaahmaaome', // Google Hangouts services
  'aapocclcgogkmnckokdopfmhonfmgoek', // Slides (legacy default app)
  'aohghmighlieiainnegkcijnfilokake', // Docs (legacy default app)
  'apdfllckaahabafndbhieahigkjlhalf', // Drive (legacy default app)
  'blpcfgokakmgnkcojhhkbfbldkacnbeo', // YouTube (legacy default app)
  'felcaaldnbdncclmgdcncolpebgiejap', // Sheets (legacy default app)
  'pjkljhegncpnkpknbcohdijeoejaedia', // Gmail (legacy default app)
  'jmjflgjpcpepeafmmgdpfkogkghcpiha', // Edge: Microsoft Edge default
  'ncbjelpjchkpbikbpkcchkhkblodoama', // Edge: WebRTC internals
]);

const EXT_ID_RE = /^[a-p]{32}$/;
const SAFE_PROFILE_RE = /^[A-Za-z0-9_-]+$/;

function extensionsRoot(profileId: string): string {
  if (!SAFE_PROFILE_RE.test(profileId)) throw new Error('Invalid profile id');
  return path.join(app.getPath('userData'), 'extensions', profileId);
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[._]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[._]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function importExtensions(src: ImportSource, profileId: string, errors: string[], onProgress?: Progress): number {
  const extDir = path.join(src.path, 'Extensions');
  if (!exists(extDir)) return 0;
  const destRoot = extensionsRoot(profileId);
  fs.mkdirSync(destRoot, { recursive: true });
  let count = 0;
  let ids: string[] = [];
  try { ids = fs.readdirSync(extDir); } catch { return 0; }
  for (const id of ids) {
    if (!EXT_ID_RE.test(id) || SKIP_EXTENSION_IDS.has(id)) continue;
    const idDir = path.join(extDir, id);
    let versions: string[] = [];
    try {
      versions = fs.readdirSync(idDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && exists(path.join(idDir, d.name, 'manifest.json')))
        .map((d) => d.name)
        .sort(compareVersions);
    } catch { continue; }
    const latest = versions[versions.length - 1];
    if (!latest) continue;
    const srcDir = path.join(idDir, latest);
    const manifest = readJson<any>(path.join(srcDir, 'manifest.json'));
    if (!manifest || !manifest.name || manifest.theme || manifest.app) continue; // skip themes & legacy apps
    const dest = path.join(destRoot, id);
    try {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(srcDir, dest, { recursive: true, dereference: false });
      count++;
      onProgress?.(`Copied extension ${typeof manifest.name === 'string' && !manifest.name.startsWith('__MSG_') ? manifest.name : id}`);
    } catch (e: any) {
      errors.push(`Couldn't copy extension ${id}: ${e?.code || e?.message || 'unknown error'}`);
    }
  }
  return count;
}

/** Load every extension previously copied for this profile into the given session. */
export async function loadInstalledExtensions(ses: Session, profileId: string): Promise<Extension[]> {
  let root: string;
  try { root = extensionsRoot(profileId); } catch { return []; }
  if (!exists(root)) return [];
  const api: any = (ses as any).extensions;
  const load: (p: string, o: { allowFileAccess: boolean }) => Promise<Extension> =
    api && typeof api.loadExtension === 'function' ? api.loadExtension.bind(api) : (ses as any).loadExtension.bind(ses);
  const loaded: Extension[] = [];
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(root); } catch { return []; }
  for (const id of dirs) {
    // Imported extensions live under their 32-char id; ones added with "Load unpacked" (main.ts loadExtension)
    // keep their folder name, and used to vanish after a restart because only id-named folders were loaded.
    if (id.startsWith('.') || id !== path.basename(id)) continue;
    const dir = path.join(root, id);
    if (!exists(path.join(dir, 'manifest.json'))) continue;
    try {
      loaded.push(await load(dir, { allowFileAccess: false }));
    } catch (e: any) {
      console.warn('[import] extension failed to load:', id, e?.message || e);
    }
  }
  return loaded;
}

// ---------------------------------------------------------------------------
// importFrom
// ---------------------------------------------------------------------------

const SESSIONS_NOTE = "Signed-in sessions can't be copied from Chrome (Google locks them); sign in once in OWL and passwords autofill.";

function errMsg(e: any): string {
  return (e && e.message) ? String(e.message) : String(e);
}

export async function importFrom(
  src: ImportSource,
  profileId: string,
  what: ImportWhat,
  onProgress?: Progress,
): Promise<ImportResult> {
  const result: ImportResult = { bookmarks: 0, history: 0, passwords: 0, extensions: 0, searchEngines: 0, errors: [] };
  if (!src || !src.path || !exists(src.path)) {
    result.errors.push('Browser profile folder not found');
    return result;
  }
  const name = `${labelFor(src.browser)} (${src.profileName})`;

  if (what.bookmarks) {
    onProgress?.(`Importing bookmarks from ${name}…`);
    try { result.bookmarks = importBookmarks(src, profileId); } catch (e) { result.errors.push('Bookmarks: ' + errMsg(e)); }
  }
  if (what.history) {
    onProgress?.(`Importing history from ${name}…`);
    try { result.history = await importHistory(src, profileId); } catch (e) { result.errors.push('History: ' + errMsg(e)); }
  }
  if (what.passwords) {
    onProgress?.(`Importing passwords from ${name}…`);
    try { result.passwords = await importPasswords(src, profileId, result.errors, onProgress); } catch (e) { result.errors.push('Passwords: ' + errMsg(e)); }
  }
  if (what.extensions) {
    onProgress?.(`Copying extensions from ${name}…`);
    try { result.extensions = importExtensions(src, profileId, result.errors, onProgress); } catch (e) { result.errors.push('Extensions: ' + errMsg(e)); }
  }
  // Search engines: not imported yet (OWL uses a fixed engine list in Settings).
  if (what.searchEngines) result.searchEngines = 0;

  result.errors.push(SESSIONS_NOTE);
  onProgress?.('Import finished');
  return result;
}
