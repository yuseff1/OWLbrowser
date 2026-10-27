'use strict';
/**
 * Runtime test of OWL's real main process. Started by tests/main/run.js with OWL_TEST_DIST pointing at a
 * fresh tsc build (plus a link to dist/renderer). Boots dist/main/main.js exactly as the app does, waits
 * for the UI window, and calls the IPC API the way the renderer does: through window.owl in that window.
 */
const { app, BrowserWindow, webContents, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const assert = require('assert');

const DIST = process.env.OWL_TEST_DIST;
if (!DIST) { console.error('OWL_TEST_DIST not set (run via tests/main/run.js)'); process.exit(2); }
const ONLY = process.env.OWL_TEST_ONLY ? new RegExp(process.env.OWL_TEST_ONLY, 'i') : null;
const ROOT = path.resolve(__dirname, '..', '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-main-'));
const USER_DATA = path.join(tmp, 'userData');
const DOWNLOADS = path.join(tmp, 'Downloads');
const CHROME_CFG = path.join(tmp, 'config'); // fake XDG_CONFIG_HOME / LOCALAPPDATA for the Chrome import test
fs.mkdirSync(DOWNLOADS, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });
app.setPath('userData', USER_DATA);
app.setPath('downloads', DOWNLOADS);
process.env.XDG_CONFIG_HOME = CHROME_CFG;
process.env.LOCALAPPDATA = CHROME_CFG;
app.on('window-all-closed', (e) => e?.preventDefault?.());

// Small adblock engine cached on disk so the test needs no network (adblock.ts reads this cache first).
try {
  const { ElectronBlocker } = require(require.resolve('@ghostery/adblocker-electron', { paths: [ROOT] }));
  const eng = ElectronBlocker.parse('/owl-test-ad.js$script\n', { loadNetworkFilters: true, loadCosmeticFilters: true });
  fs.writeFileSync(path.join(USER_DATA, 'adblock-engine.bin'), Buffer.from(eng.serialize()));
} catch (e) { console.error('[harness] could not prebuild adblock engine', e.message); }

// boot the real app now (before 'ready', like Electron does): single-instance lock, protocols, IPC, first window
require(path.join(DIST, 'main', 'main.js'));

// ---------- local servers ----------
const hits = { ad: 0 };
const wrap = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
function pagesServer() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/owl-test-ad.js') { hits.ad++; res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end('window.adRan = true'); }
    if (p.startsWith('/dl/')) {
      const name = decodeURIComponent(p.slice(4));
      const body = (u.searchParams.get('body') || 'owl download ') .repeat(2000);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': Buffer.byteLength(body) });
      if (u.searchParams.get('slow')) { // send in two halves so two downloads overlap
        const half = Math.floor(body.length / 2);
        res.write(body.slice(0, half));
        return setTimeout(() => res.end(body.slice(half)), 900);
      }
      return res.end(body);
    }
    const pages = {
      '/a': wrap('Page A', '<h1>A page</h1><p>needle one needle two</p>'),
      '/b': wrap('Page B', '<h1>B page</h1>'),
      '/c': wrap('Page C', '<h1>C page</h1>'),
      '/login': wrap('Login', '<form id="f" onsubmit="return false"><input id="u" type="text" name="user"><input id="p" type="password" name="pw"><button id="go" type="submit">Sign in</button></form>'),
      '/ad': wrap('Ad page', '<h1>ads</h1><script src="/owl-test-ad.js"></script>'),
      '/perm': wrap('Perm page', '<h1>perm</h1>'),
    };
    const html = pages[p];
    res.writeHead(html ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html || wrap('404', 'nf'));
  });
}
function modelServer(kind) {
  // kind 'ollama': serves /api/tags and /v1/models (like real Ollama); 'lmstudio': only /v1/models
  return http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (kind === 'ollama' && p === '/api/tags') return json({ models: [{ name: 'llama3:latest' }] });
    if (p === '/v1/models') return json({ object: 'list', data: [{ id: kind === 'ollama' ? 'llama3:latest' : 'qwen-local' }] });
    res.writeHead(404); res.end('404 page not found');
  });
}
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

// ---------- fake Chrome profile ----------
async function makeChromeProfile() {
  const dir = process.platform === 'win32' ? path.join(CHROME_CFG, 'Google', 'Chrome', 'User Data') : process.platform === 'darwin' ? null : path.join(CHROME_CFG, 'google-chrome');
  if (!dir) return null;
  const prof = path.join(dir, 'Default');
  fs.mkdirSync(prof, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Fake Person' } } } }));
  fs.writeFileSync(path.join(prof, 'Bookmarks'), JSON.stringify({ roots: {
    bookmark_bar: { type: 'folder', children: [{ type: 'url', name: 'Imported One', url: 'https://imported.example/one' }, { type: 'folder', name: 'Work', children: [{ type: 'url', name: 'Imported Two', url: 'https://imported.example/two' }] }] },
    other: { type: 'folder', children: [{ type: 'url', name: 'JS', url: 'javascript:alert(1)' }] },
  } }));
  const initSqlJs = require(require.resolve('sql.js', { paths: [ROOT] }));
  const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm', { paths: [ROOT] })) });
  const h = new SQL.Database();
  h.run('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER, hidden INTEGER DEFAULT 0)');
  const wk = (ms) => (ms + 11644473600000) * 1000;
  h.run('INSERT INTO urls (url,title,visit_count,last_visit_time,hidden) VALUES (?,?,?,?,0),(?,?,?,?,0),(?,?,?,?,1)', [
    'https://hist.example/x', 'Hist X', 5, wk(Date.now() - 3600_000), 'https://hist.example/y', 'Hist Y', 1, wk(Date.now() - 7200_000), 'https://hidden.example/', 'Hidden', 1, wk(Date.now())]);
  fs.writeFileSync(path.join(prof, 'History'), Buffer.from(h.export()));
  const l = new SQL.Database();
  l.run('CREATE TABLE logins (origin_url TEXT, username_value TEXT, password_value BLOB, blacklisted_by_user INTEGER DEFAULT 0)');
  if (process.platform === 'linux') {
    const key = crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');
    const c = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
    const blob = Buffer.concat([Buffer.from('v10'), c.update('chrome-pass'), c.final()]);
    l.run('INSERT INTO logins VALUES (?,?,?,0)', ['https://login.example/', 'bob', new Uint8Array(blob)]);
  }
  fs.writeFileSync(path.join(prof, 'Login Data'), Buffer.from(l.export()));
  return prof;
}

// ---------- harness ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, what = 'condition') {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) { try { last = await fn(); if (last) return last; } catch (e) { last = e; } await sleep(50); }
  throw new Error(`timed out waiting for ${what}${last instanceof Error ? ': ' + last.message : ''}`);
}
const uiWindows = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().startsWith('owl-ui://app/') && !w.webContents.getURL().includes('popup=1'));
async function waitUi(pred, what) {
  return until(async () => {
    for (const w of uiWindows()) {
      const q = new URL(w.webContents.getURL()).searchParams;
      if (!pred(q)) continue;
      if (w.webContents.isLoading()) continue;
      if (await w.webContents.executeJavaScript('typeof window.owl === "object"').catch(() => false)) {
        await w.webContents.executeJavaScript('if(!window.__ev){window.__ev=[];window.owl.on((t,p)=>window.__ev.push({t,p}))};1');
        return w;
      }
    }
    return null;
  }, 20000, what);
}
function owlOf(win) {
  return (method, ...args) => win.webContents.executeJavaScript(`window.owl[${JSON.stringify(method)}](...${JSON.stringify(args)}).then((v)=>({ok:true,v}),(e)=>({ok:false,e:String(e&&e.message||e)}))`)
    .then((r) => { if (!r.ok) throw new Error(`owl.${method}: ${r.e}`); return r.v; });
}
const events = (win, type) => win.webContents.executeJavaScript(`window.__ev.filter(x=>x.t===${JSON.stringify(type)}).map(x=>x.p)`);
const wcForUrl = (url, ses) => webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL() === url && (!ses || w.session === ses));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const profDir = (id) => path.join(USER_DATA, 'profiles', id);

const results = [];
const T = [];
const test = (name, fn) => T.push({ name, fn });

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
let unhandled = [];
process.on('unhandledRejection', (e) => { unhandled.push(String(e && e.stack || e)); });

async function main() {
  const PAGES = await listen(pagesServer());
  const OLLAMA = await listen(modelServer('ollama'));
  const LMS = await listen(modelServer('lmstudio'));
  const fakeChrome = await makeChromeProfile();

  const req = (m) => require(path.join(DIST, 'main', m));
  const { passwords } = req('import/chromium');
  const { agentDownloads } = req('downloads');
  const { dataFor } = req('data');
  agentDownloads.setQuarantineDir(path.join(tmp, 'quarantine'));

  const main = await waitUi((q) => q.get('incognito') === '0' && q.get('profile') === 'default', 'main UI window');
  const owl = owlOf(main);
  const state = () => owl('getState');
  const tabState = async (id) => (await state()).tabs.find((t) => t.id === id);
  const loaded = (id, url) => until(async () => { const t = await tabState(id); return t && !t.loading && (!url || t.url === url) ? t : null; }, 10000, `tab ${id} to load ${url || ''}`);
  // the UI sits on onboarding (page rect 0×0); give pages a real viewport like the shell does after onboarding
  await owl('completeOnboarding', {});
  const giveBounds = (o) => o('setBounds', { x: 0, y: 80, width: 1200, height: 760 }, null);
  await giveBounds(owl);
  const defaultSes = () => require('electron').session.fromPartition('persist:owl-default');

  // ---- contract: every preload method has a handler ----
  test('contract: every window.owl call has an ipcMain handler', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'ui.ts'), 'utf8');
    const names = [...src.matchAll(/call\('([A-Za-z]+)'\)/g)].map((m) => m[1]);
    assert.ok(names.length > 80, 'parsed preload');
    const handlers = ipcMain._invokeHandlers;
    assert.ok(handlers && typeof handlers.has === 'function', 'ipcMain._invokeHandlers available');
    const missing = names.filter((n) => !handlers.has('owl:' + n));
    assert.deepStrictEqual(missing, []);
  });

  test('ipc: untrusted senders are refused', async () => {
    const id = await owl('newTab', PAGES + '/c');
    await loaded(id, PAGES + '/c');
    const wc = wcForUrl(PAGES + '/c');
    // web pages have no window.owl, and the raw channel is refused by the sender check
    assert.strictEqual(await wc.executeJavaScript('typeof window.owl'), 'undefined');
    await owl('closeTab', id);
  });

  // ---- tabs ----
  test('tabs: create / navigate / back / forward / reload / close', async () => {
    const id = await owl('newTab', PAGES + '/a');
    await loaded(id, PAGES + '/a');
    await owl('navigate', id, PAGES + '/b');
    await loaded(id, PAGES + '/b');
    let t = await tabState(id);
    assert.ok(t.canGoBack);
    await owl('back', id);
    await loaded(id, PAGES + '/a');
    await owl('forward', id);
    await loaded(id, PAGES + '/b');
    await owl('reload', id);
    await loaded(id, PAGES + '/b');
    assert.strictEqual((await state()).activeTabId, id);
    await owl('closeTab', id);
    assert.ok(!(await tabState(id)), 'tab gone');
  });

  test('tabs: search text and bare hosts are normalised', async () => {
    const id = await owl('newTab', 'owl://newtab');
    const nid = await owl('navigate', id, '127.0.0.1:' + new URL(PAGES).port + '/c');
    await loaded(nid, PAGES + '/c');
    await owl('closeTab', nid);
  });

  test('tabs: open/close 15 tabs leaks no webContents or theme listeners', async () => {
    const before = webContents.getAllWebContents().length;
    const themeBefore = nativeTheme.listenerCount('updated');
    for (let i = 0; i < 15; i++) { const id = await owl('newTab', PAGES + '/c', { background: true }); await owl('closeTab', id); }
    await sleep(500);
    assert.ok(webContents.getAllWebContents().length <= before, `webContents ${before} → ${webContents.getAllWebContents().length}`);
    assert.strictEqual(nativeTheme.listenerCount('updated'), themeBefore);
  });

  // ---- history ----
  test('history: add (by navigation) / search / remove / clear', async () => {
    const id = await owl('newTab', PAGES + '/a');
    await loaded(id, PAGES + '/a');
    await owl('navigate', id, PAGES + '/b');
    await loaded(id, PAGES + '/b');
    await until(async () => (await owl('history', 'Page B')).length, 4000, 'history title');
    const all = await owl('history');
    assert.ok(all.some((h) => h.url === PAGES + '/a') && all.some((h) => h.url === PAGES + '/b'));
    const sug = await owl('suggest', 'Page A');
    assert.ok(sug.some((s) => s.type === 'history' && s.url === PAGES + '/a'), 'suggest finds history');
    await owl('removeHistory', PAGES + '/a');
    assert.ok(!(await owl('history')).some((h) => h.url === PAGES + '/a'));
    await sleep(600);
    assert.ok(readJson(path.join(profDir('default'), 'history.json')).some((h) => h.url === PAGES + '/b'), 'history persisted');
    await owl('clearHistory');
    assert.strictEqual((await owl('history')).length, 0);
    await owl('closeTab', id);
  });

  // ---- bookmarks ----
  test('bookmarks: toggle / list / rename / isBookmarked / remove', async () => {
    const u = PAGES + '/bm';
    assert.strictEqual(await owl('toggleBookmark', u, 'BM', undefined), true);
    assert.strictEqual(await owl('isBookmarked', u), true);
    const b = (await owl('bookmarks')).find((x) => x.url === u);
    assert.ok(b);
    await owl('renameBookmark', b.id, 'Renamed');
    assert.strictEqual((await owl('bookmarks')).find((x) => x.id === b.id).title, 'Renamed');
    await owl('removeBookmark', b.id);
    assert.strictEqual(await owl('isBookmarked', u), false);
    assert.strictEqual(await owl('toggleBookmark', u, 'BM'), true);
    assert.strictEqual(await owl('toggleBookmark', u, 'BM'), false);
    const ev = await events(main, 'command');
    assert.ok(ev.some((e) => e.cmd === 'bookmark-changed'));
  });

  // ---- settings ----
  test('settings: patch round-trips to disk and broadcasts', async () => {
    const s = await owl('patchSettings', { sleepAfterMinutes: 7, searchEngine: 'duckduckgo' });
    assert.strictEqual(s.sleepAfterMinutes, 7);
    assert.strictEqual((await owl('settings')).searchEngine, 'duckduckgo');
    await sleep(600);
    const disk = readJson(path.join(USER_DATA, 'settings.json'));
    assert.strictEqual(disk.sleepAfterMinutes, 7);
    assert.ok((await events(main, 'settings')).some((x) => x.sleepAfterMinutes === 7));
    await owl('patchSettings', { searchEngine: 'google' });
  });

  // ---- downloads ----
  const dlIn = async (win, url, name) => {
    const o = owlOf(win);
    const id = await o('newTab', PAGES + '/c');
    await until(async () => { const t = (await o('getState')).tabs.find((x) => x.id === id); return t && !t.loading && t.url === PAGES + '/c'; }, 8000, 'dl tab');
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === PAGES + '/c' && w.session === (win === main ? defaultSes() : w.session) && !w.isDestroyed());
    return { id, wc, o };
  };
  test('downloads: normal download completes and is listed', async () => {
    const { id, wc } = await dlIn(main);
    wc.downloadURL(PAGES + '/dl/report.txt');
    const d = await until(async () => (await owl('downloads')).find((x) => x.filename.startsWith('report') && x.state === 'completed'), 8000, 'download done');
    assert.ok(fs.existsSync(d.path) && path.dirname(d.path) === DOWNLOADS, d.path);
    await owl('closeTab', id);
  });

  test('downloads: two simultaneous downloads with the same name do not overwrite each other', async () => {
    const { id, wc } = await dlIn(main);
    const before = (await owl('downloads')).length;
    wc.downloadURL(PAGES + '/dl/same.txt?slow=1&body=first%20');
    wc.downloadURL(PAGES + '/dl/same.txt?slow=1&body=second%20');
    const ds = await until(async () => { const l = (await owl('downloads')).filter((x) => x.filename.startsWith('same')); return l.length >= 2 && l.every((x) => x.state === 'completed') ? l : null; }, 10000, 'both downloads');
    assert.ok((await owl('downloads')).length >= before + 2);
    assert.notStrictEqual(ds[0].path, ds[1].path, 'distinct paths');
    const bodies = ds.map((d) => fs.readFileSync(d.path, 'utf8').slice(0, 6)).sort();
    assert.deepStrictEqual(bodies, ['first ', 'second'.slice(0, 6)]);
    await owl('closeTab', id);
  });

  test('downloads: agent-tab download is quarantined until approved / deleted when denied', async () => {
    const { id, wc } = await dlIn(main);
    agentDownloads.register(wc.id, 'run_test', async () => true);
    wc.downloadURL(PAGES + '/dl/agent-ok.txt');
    const ok = await until(async () => (await owl('downloads')).find((x) => x.filename.startsWith('agent-ok') && x.state === 'completed'), 8000, 'approved agent download');
    await until(() => fs.existsSync(path.join(DOWNLOADS, 'agent-ok.txt')), 4000, 'moved to Downloads');
    agentDownloads.unregisterRun('run_test');
    agentDownloads.register(wc.id, 'run_test2', async () => false);
    wc.downloadURL(PAGES + '/dl/agent-no.txt');
    await until(async () => (await owl('downloads')).find((x) => x.filename.includes('agent-no') && x.state !== 'progressing'), 8000, 'denied agent download');
    await sleep(300);
    assert.ok(!fs.existsSync(path.join(DOWNLOADS, 'agent-no.txt')));
    assert.ok(!fs.readdirSync(path.join(tmp, 'quarantine')).some((f) => f.includes('agent-no')), 'quarantine cleaned');
    agentDownloads.unregisterRun('run_test2');
    assert.ok(ok);
    await owl('closeTab', id);
  });

  // ---- incognito ----
  let inc = null;
  const getInc = async () => { if (inc && !inc.isDestroyed()) return inc; await owl('newWindow', { incognito: true }); inc = await waitUi((q) => q.get('incognito') === '1', 'incognito window'); return inc; };
  test('incognito: separate session, no history, downloads kept out of the profile', async () => {
    const w = await getInc();
    const io = owlOf(w);
    const st = await io('getState');
    assert.strictEqual(st.incognito, true);
    const id = await io('newTab', PAGES + '/a?incog=1');
    await until(async () => { const t = (await io('getState')).tabs.find((x) => x.id === id); return t && !t.loading && t.url.includes('incog=1'); }, 8000, 'incognito tab');
    const wc = wcForUrl(PAGES + '/a?incog=1');
    assert.notStrictEqual(wc.session, defaultSes(), 'incognito uses another session');
    assert.ok(!wc.session.isPersistent(), 'incognito session is in-memory');
    await sleep(500);
    assert.ok(!(await owl('history')).some((h) => h.url.includes('incog=1')), 'no history from incognito');
    wc.downloadURL(PAGES + '/dl/incog.txt');
    await until(async () => (await io('downloads')).find((x) => x.filename.startsWith('incog') && x.state === 'completed'), 8000, 'incognito download');
    assert.ok(!(await owl('downloads')).some((x) => x.filename.startsWith('incog')), 'not shown in the normal window');
    await sleep(600);
    const disk = fs.existsSync(path.join(profDir('default'), 'downloads.json')) ? readJson(path.join(profDir('default'), 'downloads.json')) : [];
    assert.ok(!disk.some((x) => x.filename.startsWith('incog')), 'not written to downloads.json');
  });

  test('incognito: closed incognito tabs are not reopened in a normal window', async () => {
    const w = await getInc();
    const io = owlOf(w);
    const id = await io('newTab', PAGES + '/b?secret-incog=1');
    await until(async () => { const t = (await io('getState')).tabs.find((x) => x.id === id); return t && !t.loading; }, 8000, 'incognito tab b');
    await io('closeTab', id);
    const n0 = (await state()).tabs.length;
    await owl('reopenClosed');
    await sleep(400);
    const st = await state();
    assert.ok(!st.tabs.some((t) => t.url.includes('secret-incog')), 'incognito URL leaked into normal window via reopen-tab');
    if (st.tabs.length > n0) await owl('closeTab', st.activeTabId);
  });

  // ---- adblock ----
  test('adblock: blocks in the normal AND the incognito session, survives off/on', async () => {
    const w = await getInc();
    const io = owlOf(w);
    const load = async (o, u) => { const id = await o('newTab', u); await until(async () => { const t = (await o('getState')).tabs.find((x) => x.id === id); return t && !t.loading && t.url === u; }, 8000, 'ad page ' + u); return id; };
    await sleep(1500); // engine loads async on session prepare
    hits.ad = 0;
    const a = await load(owl, PAGES + '/ad?n=1');
    const b = await load(io, PAGES + '/ad?i=1');
    const normalHits = hits.ad; // after both
    assert.strictEqual(normalHits, 0, `ad script fetched ${normalHits}x (normal+incognito)`);
    await owl('patchSettings', { adblock: false });
    await sleep(500);
    await owl('patchSettings', { adblock: true });
    await sleep(800);
    await load(owl, PAGES + '/ad?n=2');
    await load(io, PAGES + '/ad?i=2');
    assert.strictEqual(hits.ad, 0, `after off/on: ad script fetched ${hits.ad}x`);
    await owl('closeTab', a); await io('closeTab', b);
  });

  // ---- passwords ----
  test('passwords: saved credential autofills the login page; never in incognito', async () => {
    await giveBounds(owl);
    passwords.save('default', PAGES, 'alice', 's3cret!');
    const ids = await owl('passwords');
    assert.ok(ids.some((p) => p.username === 'alice' && !('password' in p)), 'list has no secrets');
    const id = await owl('newTab', PAGES + '/login');
    await loaded(id, PAGES + '/login');
    const wc = wcForUrl(PAGES + '/login', defaultSes());
    await until(async () => (await wc.executeJavaScript('document.getElementById("p").value')) === 's3cret!', 5000, 'autofill');
    assert.strictEqual(await wc.executeJavaScript('document.getElementById("u").value'), 'alice');
    await owl('closeTab', id);
    const w = await getInc(); const io = owlOf(w);
    const iid = await io('newTab', PAGES + '/login?i=1');
    await until(async () => { const t = (await io('getState')).tabs.find((x) => x.id === iid); return t && !t.loading; }, 8000, 'inc login');
    await sleep(1200);
    const iwc = wcForUrl(PAGES + '/login?i=1');
    assert.strictEqual(await iwc.executeJavaScript('document.getElementById("p").value'), '', 'no autofill in incognito');
    await io('closeTab', iid);
    await sleep(600);
    const raw = fs.readFileSync(path.join(USER_DATA, 'secrets.json'), 'utf8');
    assert.ok(!raw.includes('s3cret!'), 'secret not stored in plain text');
  });

  test('passwords: submitting a form prompts, savePassword stores it', async () => {
    const id = await owl('newTab', PAGES + '/login?new=1');
    await loaded(id, PAGES + '/login?new=1');
    const wc = wcForUrl(PAGES + '/login?new=1', defaultSes());
    await sleep(800); // let autofill (alice) run first
    await wc.executeJavaScript('document.getElementById("u").value="carol";document.getElementById("p").value="pw-carol-1";document.getElementById("go").click();1');
    const pr = await until(async () => (await events(main, 'password-prompt')).find((p) => p.username === 'carol'), 5000, 'password prompt');
    await owl('savePassword', pr.id, true);
    assert.ok((await owl('passwords')).some((p) => p.username === 'carol'));
    await owl('closeTab', id);
  });

  // ---- profiles ----
  let work = null;
  test('profiles: create / switch use a separate session partition and data dir', async () => {
    const p = await owl('createProfile', 'Work', '#22C3A6');
    assert.ok(p && p.id && p.name === 'Work');
    work = p;
    const ww = await waitUi((q) => q.get('profile') === p.id && q.get('incognito') === '0', 'work window');
    const wo = owlOf(ww);
    assert.strictEqual((await wo('profiles')).current, p.id);
    const id = await wo('newTab', PAGES + '/a?work=1');
    await until(async () => { const t = (await wo('getState')).tabs.find((x) => x.id === id); return t && !t.loading && t.url.includes('work=1'); }, 8000, 'work tab');
    const wc = wcForUrl(PAGES + '/a?work=1');
    assert.notStrictEqual(wc.session, defaultSes(), 'work tab not in the default session');
    assert.strictEqual(wc.session.storagePath && path.basename(wc.session.storagePath), 'owl-' + p.id);
    await until(async () => (await wo('history')).some((h) => h.url.includes('work=1')), 4000, 'work history');
    assert.ok(!(await owl('history')).some((h) => h.url.includes('work=1')), 'not in default profile history');
    await sleep(600);
    assert.ok(readJson(path.join(profDir(p.id), 'history.json')).some((h) => h.url.includes('work=1')));
    await wo('toggleBookmark', PAGES + '/workbm', 'W');
    assert.ok(!(await owl('bookmarks')).some((b) => b.url.endsWith('/workbm')));
    await owl('openProfile', p.id); // focuses the existing window, no throw
    await assert.rejects(owl('openProfile', '../../evil'), /Unknown profile/);
  });

  // ---- chrome import ----
  test('import: Chrome profile (bookmarks, history, passwords) into the current profile', async () => {
    if (!fakeChrome) return 'skipped (macOS)';
    const srcs = await owl('importSources');
    const src = srcs.find((s) => s.path === fakeChrome);
    assert.ok(src, 'fake Chrome profile detected: ' + JSON.stringify(srcs));
    const r = await owl('importFrom', src, { bookmarks: true, history: true, passwords: true, extensions: false });
    assert.strictEqual(r.bookmarks, 2, JSON.stringify(r));
    assert.strictEqual(r.history, 2, JSON.stringify(r));
    const bms = await owl('bookmarks');
    assert.ok(bms.some((b) => b.url === 'https://imported.example/two' && b.folder === 'Bookmarks bar / Work'));
    assert.ok(!bms.some((b) => b.url.startsWith('javascript:')));
    const hs = await owl('history');
    assert.ok(hs.some((h) => h.url === 'https://hist.example/x' && h.visits === 5 && Math.abs(h.lastVisit - (Date.now() - 3600_000)) < 120_000), 'history time converted');
    if (process.platform === 'linux') {
      assert.strictEqual(r.passwords, 1, JSON.stringify(r));
      const pw = (await owl('passwords')).find((p) => p.username === 'bob');
      assert.ok(pw && pw.origin === 'https://login.example');
      assert.strictEqual(passwords.get('default', pw.id).password, 'chrome-pass');
    }
    if (work) assert.ok(!passwords.list(work.id).some((p) => p.username === 'bob'), 'not imported into another profile');
    await assert.rejects(owl('importFrom', { path: '/etc' }, { bookmarks: true }), /Unknown browser profile/);
  });

  // ---- memory saver ----
  test('memory saver: sleepTab frees a background tab, activate wakes it', async () => {
    const bg = await owl('newTab', PAGES + '/b?sleep=1', { background: true });
    await until(async () => { const t = await tabState(bg); return t && !t.loading && t.url.includes('sleep=1'); }, 8000, 'bg tab');
    await owl('sleepTab', bg);
    await until(async () => (await tabState(bg)).sleeping, 4000, 'tab asleep');
    assert.ok(!wcForUrl(PAGES + '/b?sleep=1'), 'renderer closed');
    const ms = await owl('memoryStats');
    assert.ok(ms.tabs.some((t) => t.id === bg && t.sleeping));
    await owl('activateTab', bg);
    await until(async () => { const t = await tabState(bg); return !t.sleeping && !t.loading && t.url.includes('sleep=1'); }, 8000, 'tab awake');
    await owl('closeTab', bg);
  });

  // ---- find / zoom ----
  test('find / zoom: find-result events and per-tab zoom, bad input does not throw', async () => {
    const id = await owl('newTab', PAGES + '/a?find=1');
    await loaded(id, PAGES + '/a?find=1');
    await owl('find', id, 'needle', {});
    const r = await until(async () => (await events(main, 'find-result')).find((x) => x.tabId === id && x.total >= 2), 5000, 'find-result');
    assert.ok(r.total >= 2);
    await owl('stopFind', id);
    await owl('zoom', id, 0.1);
    assert.strictEqual((await tabState(id)).zoom, 1.1);
    await owl('zoom', id, 'reset');
    assert.strictEqual((await tabState(id)).zoom, 1);
    await owl('zoom', id, 'bogus').catch(() => {});
    const z = (await tabState(id)).zoom;
    assert.ok(Number.isFinite(z) && z > 0, 'zoom stays finite: ' + z);
    await owl('closeTab', id);
  });

  // ---- permissions ----
  test('permissions: undecided sites do not get silent notification / device-label access', async () => {
    const id = await owl('newTab', PAGES + '/perm');
    await loaded(id, PAGES + '/perm');
    const wc = wcForUrl(PAGES + '/perm', defaultSes());
    const res = await wc.executeJavaScript(`(async()=>({ notif: Notification.permission, q: (await navigator.permissions.query({name:'notifications'})).state, geo: (await navigator.permissions.query({name:'geolocation'})).state }))()`);
    await owl('closeTab', id);
    assert.notStrictEqual(res.notif, 'granted', 'Notification.permission is granted without asking: ' + JSON.stringify(res));
  });

  // ---- providers ----
  test('providers: discover models for Ollama / LM Studio root URLs', async () => {
    await owl('upsertProvider', { id: 'oll-root', kind: 'ollama', baseUrl: OLLAMA });
    assert.deepStrictEqual(await owl('discoverModels', 'oll-root'), ['llama3:latest']);
    await owl('upsertProvider', { id: 'oll-v1', kind: 'ollama', baseUrl: OLLAMA + '/v1' });
    assert.deepStrictEqual(await owl('discoverModels', 'oll-v1'), ['llama3:latest']);
    await owl('upsertProvider', { id: 'lms-root', kind: 'lmstudio', baseUrl: LMS + '/' });
    assert.deepStrictEqual(await owl('discoverModels', 'lms-root'), ['qwen-local']);
    await assert.rejects(owl('upsertProvider', { kind: 'openai', baseUrl: 'http://evil.example/v1' }), /https/);
    assert.ok((await owl('providers')).find((p) => p.id === 'oll-root').models.includes('llama3:latest'));
  });

  // ---- MCP ----
  const mcpScript = path.join(tmp, 'mcp-server.js');
  fs.writeFileSync(mcpScript, `
    const rl = require('readline').createInterface({ input: process.stdin });
    const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
    rl.on('line', (l) => { let m; try { m = JSON.parse(l); } catch { return; }
      if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } });
      else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: {} } }] } });
      else if (m.method === 'tools/call') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'echo:' + JSON.stringify(m.params.arguments) }] } });
      else if (m.id != null) send({ jsonrpc: '2.0', id: m.id, result: {} });
    });`);
  const mcpCfg = (id) => ({ id, name: 'Fake ' + id, transport: 'stdio', command: process.execPath, args: [mcpScript], env: { ELECTRON_RUN_AS_NODE: '1' } });
  test('mcp: stdio server start / list tools / stop', async () => {
    const cfg = await owl('saveApp', mcpCfg('fake-mcp'));
    const r = await owl('connectApp', cfg.id);
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(r.tools, 1);
    assert.strictEqual((await owl('apps')).find((a) => a.id === cfg.id).status, 'connected');
    await owl('disconnectApp', cfg.id);
    assert.strictEqual((await owl('apps')).find((a) => a.id === cfg.id).status, 'off');
    await owl('removeApp', cfg.id);
    assert.ok(!(await owl('apps')).some((a) => a.id === cfg.id));
  });
  test('mcp: the same app id in two profiles keeps two connections', async () => {
    if (!work) throw new Error('needs the profiles test');
    const ww = await waitUi((q) => q.get('profile') === work.id && q.get('incognito') === '0', 'work window');
    const wo = owlOf(ww);
    await owl('saveApp', mcpCfg('shared-id'));
    await wo('saveApp', mcpCfg('shared-id'));
    assert.ok((await owl('connectApp', 'shared-id')).ok);
    assert.ok((await wo('connectApp', 'shared-id')).ok);
    assert.strictEqual((await owl('apps')).find((a) => a.id === 'shared-id').status, 'connected', 'default profile connection was dropped by the work profile');
    await wo('disconnectApp', 'shared-id');
    assert.strictEqual((await owl('apps')).find((a) => a.id === 'shared-id').status, 'connected', 'disconnect in one profile closed the other');
    await owl('removeApp', 'shared-id'); await wo('removeApp', 'shared-id');
  });

  // ---- routines ----
  test('routines: save validates the schedule, run starts a run, remove', async () => {
    const r = await owl('saveRoutine', { name: 'Brief', task: 'say hi', schedule: { type: 'daily', time: '08:30' } });
    assert.ok(r.id && r.nextRunAt > Date.now());
    const bad = await owl('saveRoutine', { name: 'Bad', task: 'x', schedule: { type: 'daily' } }).catch((e) => e);
    if (!(bad instanceof Error)) assert.ok(Number.isFinite(bad.nextRunAt), 'bad schedule produced nextRunAt=' + bad.nextRunAt);
    const iv = await owl('saveRoutine', { name: 'Iv', task: 'x', schedule: { type: 'interval', minutes: 'abc' } }).catch((e) => e);
    if (!(iv instanceof Error)) assert.ok(Number.isFinite(iv.nextRunAt), 'interval NaN nextRunAt=' + iv.nextRunAt);
    const n0 = (await owl('runs')).length;
    await owl('runRoutine', r.id);
    await until(async () => (await owl('runs')).length > n0, 3000, 'routine run');
    const run = (await owl('runs'))[0];
    await owl('stopRun', run.id);
    await owl('removeRoutine', r.id);
    if (!(bad instanceof Error)) await owl('removeRoutine', bad.id);
    if (!(iv instanceof Error)) await owl('removeRoutine', iv.id);
    assert.ok(!(await owl('routines')).some((x) => x.id === r.id));
  });

  // ---- extensions ----
  test('extensions: an unpacked extension added with "Load unpacked" is loaded again after a restart', async () => {
    const { loadInstalledExtensions } = req('import/chromium');
    const dir = path.join(USER_DATA, 'extensions', 'default', 'my-unpacked-ext');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Owl Test Ext', version: '1.0.0' }));
    const ses = require('electron').session.fromPartition('persist:owl-ext-restart-test'); // a fresh session = a fresh start (extensions need a persistent one)
    const loaded = await loadInstalledExtensions(ses, 'default');
    assert.ok(loaded.some((e) => e.name === 'Owl Test Ext'), 'loaded: ' + loaded.map((e) => e.name).join(','));
  });

  // ---- store robustness ----
  test('store: a corrupt or wrong-shape JSON file is kept aside, not overwritten', () => {
    const { JsonStore } = req('store');
    const dir = path.join(tmp, 'storetest'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bad.json'), '{"truncated": ');
    const a = new JsonStore('bad', [], dir);
    assert.deepStrictEqual(a.get(), []);
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('bad.json.corrupt-')), 'backup kept');
    fs.writeFileSync(path.join(dir, 'shape.json'), '{"not":"an array"}');
    const b = new JsonStore('shape', [], dir);
    assert.ok(Array.isArray(b.get()), 'array store never gets an object');
    b.update((l) => { l.push(1); }); b.flush();
    assert.deepStrictEqual(readJson(path.join(dir, 'shape.json')), [1]);
  });

  test('profiles: removing a profile drops its saved passwords and closes its windows', async () => {
    if (!work) throw new Error('needs the profiles test');
    passwords.save(work.id, 'https://work.example', 'w', 'work-secret');
    assert.strictEqual(passwords.list(work.id).length, 1);
    await owl('removeProfile', work.id);
    await until(() => !uiWindows().some((w) => new URL(w.webContents.getURL()).searchParams.get('profile') === work.id), 5000, 'work windows closed');
    assert.ok(!(await owl('profiles')).profiles.some((p) => p.id === work.id));
    assert.strictEqual(passwords.list(work.id).length, 0);
    await sleep(600);
    assert.ok(!fs.readFileSync(path.join(USER_DATA, 'secrets.json'), 'utf8').includes('pw:' + work.id), 'secrets removed');
    await assert.rejects(owl('removeProfile', 'default').then(() => owl('profiles')).then((r) => { if (!r.profiles.some((p) => p.id === 'default')) throw new Error('default removed'); throw new Error('ok'); }), /ok/);
  });

  // ---- robustness: garbage input never kills main ----
  test('ipc fuzz: safe handlers with missing/garbage args reject or return, main stays alive', async () => {
    const skip = new Set(['windowControl', 'removeProfile', 'newWindow', 'createProfile', 'openProfile', 'revealPassword', 'importPasswordsCsv', 'loadExtension', 'exportArtifact', 'setDefaultBrowser', 'installUpdate', 'checkForUpdates', 'importFrom', 'importSources', 'clearBrowsingData', 'clearMemory', 'clearHistory', 'startRun', 'chat', 'testModel', 'discoverModels', 'connectApp', 'refreshMemoryProfile', 'command', 'devtools', 'print', 'openWebStore', 'openDownload', 'showDownload', 'setOverlay', 'setBounds', 'completeOnboarding', 'patchSettings', 'removeExtension', 'reopenClosed', 'duplicateTab', 'openArtifact', 'followUp', 'answerRun', 'saveCompanion', 'saveSkill', 'saveRoutine', 'saveApp', 'saveChat', 'addMemory', 'upsertProvider', 'removeProvider', 'runRoutine', 'activateTab', 'closeTab', 'navigate', 'newTab']);
    const src = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'ui.ts'), 'utf8');
    const names = [...src.matchAll(/call\('([A-Za-z]+)'\)/g)].map((m) => m[1]).filter((n) => !skip.has(n));
    const garbage = [[], [null], [{}], ['x', 'y'], [12345, { a: 1 }]];
    const crashed = [];
    for (const n of names) for (const g of garbage) {
      await owl(n, ...g).catch(() => {});
      const alive = await owl('getState').then(() => true, () => false);
      if (!alive) { crashed.push(n); break; }
    }
    assert.deepStrictEqual(crashed, []);
  });

  test('process: no unhandled promise rejections during the run', () => {
    const real = unhandled.filter((u) => !/ERR_ABORTED|net::ERR/.test(u));
    assert.deepStrictEqual(real, []);
  });

  // ---------- run ----------
  for (const t of T) {
    if (ONLY && !ONLY.test(t.name)) continue;
    const t0 = Date.now();
    try {
      const note = await Promise.race([Promise.resolve().then(t.fn), sleep(45000).then(() => { throw new Error('test timed out (45s)'); })]);
      results.push({ name: t.name, ok: true, ms: Date.now() - t0, note });
      console.log(`  ✓ ${t.name}${typeof note === 'string' ? ' — ' + note : ''} (${Date.now() - t0}ms)`);
    } catch (e) {
      results.push({ name: t.name, ok: false, ms: Date.now() - t0, err: e });
      console.log(`  ✗ ${t.name} (${Date.now() - t0}ms)\n      ${String(e && e.message || e).split('\n').join('\n      ')}`);
    }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} main-process tests passed`);
  setTimeout(() => app.exit(failed.length ? 1 : 0), 100);
}
