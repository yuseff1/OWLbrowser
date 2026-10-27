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
    if (p === '/doc.pdf') {
      const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': Buffer.byteLength(pdf) });
      return res.end(pdf);
    }
    const pages = {
      '/a': wrap('Page A', '<h1>A page</h1><p>needle one needle two</p>'),
      '/b': wrap('Page B', '<h1>B page</h1>'),
      '/c': wrap('Page C', '<h1>C page</h1>'),
      '/login': wrap('Login', '<form id="f" onsubmit="return false"><input id="u" type="text" name="user"><input id="p" type="password" name="pw"><button id="go" type="submit">Sign in</button></form>'),
      '/ad': wrap('Ad page', '<h1>ads</h1><script src="/owl-test-ad.js"></script>'),
      '/perm': wrap('Perm page', '<h1>perm</h1>'),
      '/article': wrap('The owl that read the web — Test Times', '<meta property="og:site_name" content="Test Times"><meta name="author" content="Ada Writer"><nav class="menu"><a href="/a">Home</a><a href="/b">World</a><a href="/c">Sport</a></nav><div class="sidebar promo"><a href="/x">Subscribe now</a><p>Buy our newsletter, it is great, really, honestly.</p></div><article class="post-content"><h1>The owl that read the web</h1>' +
        Array.from({ length: 9 }, (_, i) => `<p onclick="window.hacked=1">Paragraph ${i + 1}: owls are birds of prey, and this one, unlike the others, learned to read long articles, skim the noise, and keep only what matters, which is what reader mode does for you as well.</p>`).join('') +
        '<figure><img src="/img.png" alt="An owl" width="300" height="200"><figcaption>An owl, reading.</figcaption></figure><script>window.articleScript = 1</script><div class="share social"><a href="/s">Share</a></div></article><footer>© Test Times</footer>'),
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

  test('tab groups: group / add / move / collapse / ungroup / close keep groups contiguous', async () => {
    const ids = [];
    for (const q of ['g1', 'g2', 'g3', 'g4']) ids.push(await owl('newTab', PAGES + '/c?' + q, { background: true }));
    const order = async () => (await state()).tabs.map((t) => t.id).filter((id) => ids.includes(id));
    const grp = async (id) => (await tabState(id)).groupId;
    // new group from tabs 1 and 3: 3 moves next to 1
    const gid = await owl('groupTabs', [ids[0], ids[2]], undefined, { title: 'Research', color: 'yellow' });
    assert.ok(typeof gid === 'string', 'group id returned');
    let st = await state();
    assert.deepStrictEqual(st.groups.find((g) => g.id === gid), { id: gid, title: 'Research', color: 'yellow', collapsed: false });
    assert.deepStrictEqual(await order(), [ids[0], ids[2], ids[1], ids[3]], 'grouped tabs are contiguous');
    // add to existing group: lands after its last tab
    await owl('groupTabs', [ids[3]], gid);
    assert.deepStrictEqual(await order(), [ids[0], ids[2], ids[3], ids[1]]);
    // a second group gets the next unused colour
    const gid2 = await owl('groupTabs', [ids[1]]);
    st = await state();
    assert.notStrictEqual(st.groups.find((g) => g.id === gid2).color, 'yellow', 'auto colour avoids used ones');
    // rename / recolour / bad patch ignored
    await owl('updateGroup', gid, { title: 'x'.repeat(200), color: 'neon' });
    st = await state();
    assert.strictEqual(st.groups.find((g) => g.id === gid).title.length, 60, 'title capped');
    assert.strictEqual(st.groups.find((g) => g.id === gid).color, 'yellow', 'unknown colour rejected');
    // collapsing the group of the active tab moves focus outside it; activating a hidden tab expands it
    await owl('activateTab', ids[2]);
    await owl('updateGroup', gid, { collapsed: true });
    st = await state();
    assert.ok(st.groups.find((g) => g.id === gid).collapsed, 'collapsed');
    assert.ok(![ids[0], ids[2], ids[3]].includes(st.activeTabId), 'active tab left the collapsed group');
    await owl('activateTab', ids[0]);
    assert.strictEqual((await state()).groups.find((g) => g.id === gid).collapsed, false, 'activating expands');
    // a tab opened from a grouped opener / inside a group joins it
    const inner = await owl('newTab', PAGES + '/c?inner', { background: true });
    await owl('moveTab', inner, (await state()).tabs.findIndex((t) => t.id === ids[2]));
    assert.strictEqual(await grp(inner), gid, 'dropped between two grouped tabs joins the group');
    await owl('moveTab', inner, (await state()).tabs.length - 1);
    assert.strictEqual(await grp(inner), undefined, 'dragged out of the group leaves it');
    // pinning removes a tab from its group
    await owl('pinTab', ids[3]);
    assert.strictEqual(await grp(ids[3]), undefined, 'pinned tab ungrouped');
    assert.strictEqual(await owl('groupTabs', [ids[3]]), null, 'pinned tabs cannot be grouped');
    await owl('pinTab', ids[3]);
    // ungroup the whole group keeps strip order; empty group disappears
    const before = (await order()).filter((id) => [ids[0], ids[2]].includes(id));
    await owl('ungroupTabs', [ids[0], ids[2]]);
    assert.deepStrictEqual((await order()).filter((id) => [ids[0], ids[2]].includes(id)), before, 'order kept');
    assert.ok(!(await state()).groups.some((g) => g.id === gid), 'empty group pruned');
    // closing a group closes its tabs
    await owl('closeGroup', gid2);
    assert.ok(!(await tabState(ids[1])), 'group tab closed');
    assert.ok(!(await state()).groups.some((g) => g.id === gid2));
    // garbage never throws
    await owl('groupTabs', 'nope'); await owl('updateGroup', 'nope', null); await owl('ungroupTabs', [9e9]); await owl('closeGroup', 42);
    for (const id of [ids[0], ids[2], ids[3], inner]) await owl('closeTab', id);
  });

  test('reader mode: article extracted, chrome stripped, attributes sanitized; exit reloads; non-articles refuse', async () => {
    const id = await owl('newTab', PAGES + '/article');
    await loaded(id, PAGES + '/article');
    const wc = wcForUrl(PAGES + '/article', defaultSes());
    assert.strictEqual(await owl('toggleReader', id), true);
    assert.strictEqual((await tabState(id)).reader, true, 'TabState.reader');
    const r = await wc.executeJavaScript(`({ reader: document.documentElement.getAttribute('data-owl-reader'), h1: document.querySelector('.owl-r h1')?.textContent, site: document.querySelector('.owl-r-site')?.textContent, meta: document.querySelector('.owl-r-meta')?.textContent, ps: document.querySelectorAll('.owl-r-body p').length, nav: !!document.querySelector('nav, .sidebar, footer, script, .share'), onclick: document.querySelectorAll('[onclick]').length, img: document.querySelector('.owl-r-body img')?.src, cap: document.querySelector('.owl-r-body figcaption')?.textContent, bar: document.querySelectorAll('.owl-r-bar button').length })`);
    assert.ok(['light', 'dark'].includes(r.reader), 'reader page: ' + JSON.stringify(r));
    assert.strictEqual(r.h1, 'The owl that read the web');
    assert.strictEqual(r.site, 'Test Times');
    assert.ok(/Ada Writer/.test(r.meta) && /min read/.test(r.meta), r.meta);
    assert.strictEqual(r.ps, 9, 'all paragraphs kept, title h1 not duplicated');
    assert.strictEqual(r.nav, false, 'nav / sidebar / footer / scripts / share removed');
    assert.strictEqual(r.onclick, 0, 'attributes stripped');
    assert.strictEqual(r.img, PAGES + '/img.png', 'images kept with absolute URLs');
    assert.strictEqual(r.cap, 'An owl, reading.');
    assert.ok(r.bar >= 5, 'reader toolbar');
    // the theme buttons work (isolated-world listeners)
    await wc.executeJavaScript(`document.querySelector('.owl-r-sepia').click()`);
    assert.strictEqual(await wc.executeJavaScript(`document.documentElement.getAttribute('data-owl-reader')`), 'sepia');
    // exit: back to the real page
    assert.strictEqual(await owl('toggleReader', id), false);
    await until(async () => { const t = await tabState(id); return t && !t.reader && !t.loading ? t : null; }, 8000, 'reader off');
    await until(() => wc.executeJavaScript(`!!document.querySelector('nav') && !document.documentElement.hasAttribute('data-owl-reader')`), 8000, 'original page back');
    // a navigation turns the flag off too
    await owl('toggleReader', id);
    await owl('navigate', id, PAGES + '/a');
    await until(async () => { const t = await tabState(id); return t && !t.reader && t.url === PAGES + '/a' ? t : null; }, 8000, 'flag reset by navigation');
    // not an article: refused, page untouched
    assert.strictEqual(await owl('toggleReader', id), false);
    assert.ok(!(await tabState(id)).reader);
    assert.strictEqual(await owl('toggleReader', 'x'), false);
    await owl('closeTab', id);
  });

  test('task manager: rows with memory / CPU per process, tab renderers mapped, end process discards the tab', async () => {
    const id = await owl('newTab', PAGES + '/c?tm', { background: true });
    await owl('activateTab', id);
    await loaded(id, PAGES + '/c?tm');
    const wc = wcForUrl(PAGES + '/c?tm', defaultSes());
    const pid = wc.getOSProcessId();
    let snap = await owl('taskManager');
    assert.ok(snap.rows.some((r) => r.kind === 'browser'), 'browser process listed');
    assert.ok(snap.rows.some((r) => r.kind === 'ui'), 'UI renderer listed');
    const row = snap.rows.find((r) => r.pid === pid);
    assert.ok(row && row.kind === 'tab' && row.canEnd && row.tabs.some((t) => t.id === id), 'tab row: ' + JSON.stringify(row));
    assert.ok(row.memMB > 0, 'memory reported');
    assert.ok(snap.totalMB >= row.memMB);
    assert.strictEqual(snap.rows.find((r) => r.kind === 'browser').canEnd, false, 'browser process cannot be ended');
    // guard rails
    assert.strictEqual(await owl('endProcess', process.pid), false, 'never the browser process');
    assert.strictEqual(await owl('endProcess', -1), false);
    assert.strictEqual(await owl('endProcess', 'x'), false);
    // end it: renderer gone, tab kept (discarded), reload on activate
    const other = await owl('newTab', PAGES + '/a', { background: true });
    assert.strictEqual(await owl('endProcess', pid), true);
    await until(async () => (await tabState(id))?.sleeping, 8000, 'tab discarded after its process ended');
    await owl('activateTab', other);
    await owl('activateTab', id);
    await loaded(id, PAGES + '/c?tm');
    await owl('closeTab', id); await owl('closeTab', other);
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

  test('downloads: pause / resume, cancel + retry, remove from list; agent downloads cannot be resumed past the gate', async () => {
    const { id, wc } = await dlIn(main);
    const find = async (name) => (await owl('downloads')).find((x) => x.filename.startsWith(name));
    wc.downloadURL(PAGES + '/dl/pausable.bin?slow=1&body=pause%20');
    let d = await until(async () => { const x = await find('pausable'); return x && x.state === 'progressing' && x.received > 0 ? x : null; }, 8000, 'download started');
    assert.strictEqual(await owl('pauseDownload', d.id), true);
    d = await find('pausable');
    assert.strictEqual(d.paused, true, 'paused flag');
    await sleep(1500); // the server finished sending meanwhile; a paused item must not complete
    assert.strictEqual((await find('pausable')).state, 'progressing', 'paused download did not complete');
    assert.strictEqual(await owl('resumeDownload', d.id), true);
    d = await until(async () => { const x = await find('pausable'); return x && x.state === 'completed' ? x : null; }, 8000, 'resumed download completes');
    assert.ok(!d.paused);
    assert.strictEqual(fs.readFileSync(d.path, 'utf8').slice(0, 6), 'pause ');
    // remove from list keeps the file
    assert.strictEqual(await owl('removeDownload', d.id), true);
    assert.ok(!(await find('pausable')), 'removed from list');
    assert.ok(fs.existsSync(d.path), 'file kept on disk');
    // cancel + retry downloads the same URL again
    wc.downloadURL(PAGES + '/dl/retry.bin?slow=1');
    let r = await until(async () => { const x = await find('retry'); return x && x.state === 'progressing' ? x : null; }, 8000, 'retry download started');
    await owl('cancelDownload', r.id);
    r = await until(async () => { const x = await find('retry'); return x && x.state === 'cancelled' ? x : null; }, 8000, 'cancelled');
    assert.strictEqual(await owl('retryDownload', r.id), true);
    await until(async () => { const l = (await owl('downloads')).filter((x) => x.filename.startsWith('retry')); return l.length === 1 && l[0].state === 'completed' && l[0].id !== r.id ? l : null; }, 10000, 'retried download completes, old row replaced');
    // guards
    assert.strictEqual(await owl('pauseDownload', 'nope'), false);
    assert.strictEqual(await owl('resumeDownload', 42), false);
    assert.strictEqual(await owl('retryDownload', 'nope'), false);
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
    // while held for approval the bubble can't resume it past the quarantine
    let release; const held = new Promise((r) => (release = r));
    agentDownloads.register(wc.id, 'run_test3', () => held);
    wc.downloadURL(PAGES + '/dl/agent-hold.txt');
    const h = await until(async () => (await owl('downloads')).find((x) => x.filename.includes('agent-hold') && x.awaitingApproval), 8000, 'held agent download flagged');
    assert.strictEqual(await owl('resumeDownload', h.id), false, 'no resume past the gate');
    assert.strictEqual(await owl('pauseDownload', h.id), false);
    release(false);
    await until(async () => (await owl('downloads')).find((x) => x.filename.includes('agent-hold') && x.state !== 'progressing'), 8000, 'held download denied');
    agentDownloads.unregisterRun('run_test3');
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
    // Chrome's undecided state: 'default' / 'prompt', never 'denied' (sites then never ask) or 'granted'
    assert.deepStrictEqual(res, { notif: 'default', q: 'prompt', geo: 'prompt' });
  });

  test('permissions: non-modal bubble — dismiss asks again, allow / block are remembered, navigation cancels', async () => {
    const id = await owl('newTab', PAGES + '/perm2');
    await loaded(id, PAGES + '/perm2');
    const wc = wcForUrl(PAGES + '/perm2', defaultSes());
    const origin = new URL(PAGES).origin;
    const pending = (perm) => until(async () => (await owl('permissionPrompts')).find((p) => p.permission === perm && p.tabId === id), 6000, perm + ' prompt');
    // 1. dismissed (×): not remembered, still 'default'
    let req = wc.executeJavaScript('Notification.requestPermission()', true);
    let p = await pending('notifications');
    assert.strictEqual(p.label, 'Show notifications');
    assert.strictEqual(p.origin, origin);
    assert.strictEqual(await owl('answerPermission', p.id, 'dismiss'), true);
    await req;
    assert.strictEqual(await wc.executeJavaScript('Notification.permission'), 'default', 'dismiss is not a decision');
    assert.ok(!(await owl('permissionPrompts')).some((x) => x.id === p.id), 'prompt gone');
    // 2. allowed: remembered, page sees granted
    req = wc.executeJavaScript('Notification.requestPermission()', true);
    p = await pending('notifications');
    await owl('answerPermission', p.id, 'allow');
    assert.strictEqual(await req, 'granted');
    assert.strictEqual(await wc.executeJavaScript('Notification.permission'), 'granted');
    assert.strictEqual(await owl('answerPermission', p.id, 'allow'), false, 'answered once');
    // 3. geolocation request reaches the bubble (undecided check = false must not short-circuit it); block is remembered
    wc.executeJavaScript('new Promise((r) => navigator.geolocation.getCurrentPosition(() => r(1), () => r(0)))', true).catch(() => {});
    p = await pending('geolocation');
    assert.strictEqual(p.label, 'Know your location');
    await owl('answerPermission', p.id, 'block');
    assert.strictEqual(await wc.executeJavaScript(`navigator.permissions.query({name:'geolocation'}).then((s) => s.state)`), 'denied');
    const s = (await owl('siteSettings')).find((x) => x.origins?.includes(origin) || x.site === '127.0.0.1');
    assert.ok(s && s.perms.notifications === true && s.perms.geolocation === false, 'decisions listed in site settings: ' + JSON.stringify(s));
    // 4. a pending prompt is cancelled when the page navigates away
    await owl('setSitePermission', origin, 'notifications', null);
    wc.executeJavaScript('Notification.requestPermission()', true).catch(() => {});
    p = await pending('notifications');
    await owl('navigate', id, PAGES + '/c');
    await until(async () => !(await owl('permissionPrompts')).some((x) => x.id === p.id), 6000, 'prompt cancelled by navigation');
    // garbage answers are ignored
    assert.strictEqual(await owl('answerPermission', 'nope', 'allow'), false);
    await owl('setSitePermission', origin, 'geolocation', null);
    await owl('closeTab', id);
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
    // its data folder (history.json…) and its extensions folder are deleted; the Chromium partition is
    // deleted too, or (if still locked by the live session on this OS) queued for the next start
    await until(() => !fs.existsSync(profDir(work.id)), 5000, 'profile data folder deleted');
    assert.ok(!fs.existsSync(path.join(USER_DATA, 'extensions', work.id)), 'extensions folder deleted');
    const part = path.join(USER_DATA, 'Partitions', 'owl-' + work.id);
    const pending = fs.existsSync(path.join(USER_DATA, 'profiles-pending-delete.json')) ? readJson(path.join(USER_DATA, 'profiles-pending-delete.json')).ids : [];
    assert.ok(!fs.existsSync(part) || pending.includes(work.id), 'partition deleted or queued');
    await sleep(800); // a late debounced write must not recreate the folder
    assert.ok(!fs.existsSync(path.join(profDir(work.id), 'history.json')), 'no store wrote into the removed folder');
    await assert.rejects(owl('removeProfile', 'default').then(() => owl('profiles')).then((r) => { if (!r.profiles.some((p) => p.id === 'default')) throw new Error('default removed'); throw new Error('ok'); }), /ok/);
  });

  // ---- secrets: OS encryption + migration of base64-only values ----
  test('secrets: base64-only and legacy values are re-encrypted once OS encryption is available', () => {
    const { secrets } = req('secrets');
    const dir = path.join(tmp, 'secretstest'); fs.mkdirSync(dir, { recursive: true });
    // what an older build wrote where no keychain was available, plus a legacy unprefixed value
    fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ 'provider:a': 'p:' + Buffer.from('sk-alpha').toString('base64'), 'provider:b': 'legacy-beta' }));
    const fake = (on) => ({ available: () => on, backend: () => 'fake', encrypt: (v) => Buffer.from('ENC' + Buffer.from(v).toString('hex')), decrypt: (b) => { const t = b.toString(); if (!t.startsWith('ENC')) throw new Error('bad'); return Buffer.from(t.slice(3), 'hex').toString(); } });
    const restore = secrets.__test({ dir, cipher: fake(false) });
    try {
      assert.strictEqual(secrets.migrate(), 0, 'nothing to do without encryption');
      assert.strictEqual(secrets.get('provider:a'), 'sk-alpha');
      assert.strictEqual(secrets.status().encrypted, false);
      secrets.set('provider:c', 'sk-gamma'); secrets.flush();
      assert.ok(readJson(path.join(dir, 'secrets.json'))['provider:c'].startsWith('p:'), 'fallback is marked p:');
      secrets.__test({ cipher: fake(true) });
      assert.strictEqual(secrets.migrate(), 3);
      const disk = readJson(path.join(dir, 'secrets.json'));
      assert.ok(Object.values(disk).every((v) => v.startsWith('e:')), JSON.stringify(disk));
      assert.ok(!JSON.stringify(disk).includes('sk-alpha') && !JSON.stringify(disk).includes(Buffer.from('sk-alpha').toString('base64')), 'no plaintext/base64 left');
      assert.deepStrictEqual(['provider:a', 'provider:b', 'provider:c'].map((k) => secrets.get(k)), ['sk-alpha', 'legacy-beta', 'sk-gamma']);
      assert.strictEqual(secrets.migrate(), 0, 'idempotent');
      assert.deepStrictEqual(secrets.status(), { encrypted: true, backend: 'fake', plainCount: 0 });
      // an undecryptable value (other OS user / broken keychain) is kept on disk, not deleted
      secrets.__test({ cipher: { ...fake(true), decrypt: () => { throw new Error('locked'); } } });
      assert.strictEqual(secrets.get('provider:a'), null);
      secrets.set('provider:d', 'x'); secrets.flush();
      assert.ok(readJson(path.join(dir, 'secrets.json'))['provider:a'].startsWith('e:'), 'kept');
    } finally { restore(); }
  });

  test('secrets: appInfo reports whether secrets are really encrypted on this machine', async () => {
    const i = await owl('appInfo');
    assert.ok(i.secrets && typeof i.secrets.encrypted === 'boolean' && typeof i.secrets.backend === 'string', JSON.stringify(i.secrets));
    if (process.platform === 'win32' || process.platform === 'darwin') assert.strictEqual(i.secrets.encrypted, true);
  });

  // ---- omnibox suggestions ----
  test('suggest: rows are de-duplicated by normalised URL, typed URL not repeated, favicons borrowed', async () => {
    const { history: hist, bookmarks: bms } = req('data');
    hist.add('default', 'https://www.wikipedia.org/', 'Wikipedia', 'data:image/png;base64,AAAA');
    hist.add('default', 'https://wikipedia.org', 'Wikipedia');
    hist.add('default', 'http://wikipedia.org/#top', 'Wikipedia');
    hist.add('default', 'https://wikipedia.org/wiki/Owl', 'Owl - Wikipedia');
    bms.toggle('default', 'https://en.wikipedia.org/wiki/Owl', 'Owl (bookmark)');
    const rows = await owl('suggest', 'wikipedia');
    const keys = rows.filter((r) => r.type !== 'search' && r.type !== 'tab').map((r) => r.url.replace(/^https?:\/\/(www\.)?/, '').replace(/[/#].*$|\/$/, '') + new URL(r.url).pathname.replace(/\/$/, ''));
    assert.strictEqual(new Set(keys).size, keys.length, 'no duplicate pages: ' + JSON.stringify(rows.map((r) => r.type + ' ' + r.url)));
    const home = rows.filter((r) => /^https?:\/\/(www\.)?wikipedia\.org\/?(#.*)?$/.test(r.url));
    assert.strictEqual(home.length, 1, 'one wikipedia.org row: ' + JSON.stringify(rows.map((r) => r.type + ' ' + r.url)));
    const owlRow = rows.find((r) => r.url === 'https://wikipedia.org/wiki/Owl');
    assert.ok(owlRow && owlRow.favicon === 'data:image/png;base64,AAAA', 'history row without favicon borrows the site favicon');
    // inline autocomplete only when asked, never for searches with spaces
    const inl = await owl('suggest', 'wikip', { inline: true });
    assert.strictEqual(inl[0].type, 'url'); assert.strictEqual(inl[0].inline, 'wikipedia.org'); assert.strictEqual(inl[0].url, 'https://wikipedia.org');
    assert.ok(!(await owl('suggest', 'wikip'))[0].inline, 'no inline unless requested');
    assert.ok(!(await owl('suggest', 'wiki pedia', { inline: true }))[0].inline, 'no inline with spaces');
  });

  test('suggest: unit — urlKey / dedupeSuggestions / inlineCompletion', () => {
    const { urlKey, dedupeSuggestions, inlineCompletion } = req('suggest');
    assert.strictEqual(urlKey('https://www.Wikipedia.org/'), urlKey('http://wikipedia.org'));
    assert.strictEqual(urlKey('https://a.com/x/#h'), urlKey('https://a.com/x'));
    assert.notStrictEqual(urlKey('https://a.com/x?q=1'), urlKey('https://a.com/x?q=2'));
    assert.strictEqual(urlKey('https://a.com:443/'), urlKey('https://a.com'));
    assert.notStrictEqual(urlKey('http://localhost:3000/'), urlKey('http://localhost:4000/'));
    const d = dedupeSuggestions([{ type: 'url', url: 'https://a.com', title: '' }, { type: 'search', url: 's', title: '' }, { type: 'tab', url: '3', title: '' }, { type: 'history', url: 'https://www.a.com/', title: '' }, { type: 'tab', url: '3', title: '' }]);
    assert.deepStrictEqual(d.map((x) => x.type), ['url', 'search', 'tab']);
    const v = [{ url: 'https://www.youtube.com/watch?v=1', visits: 9 }, { url: 'https://yourbank.com/', visits: 1 }, { url: 'https://github.com/yuseff1/OWLbrowser', visits: 3 }];
    assert.strictEqual(inlineCompletion('you', v), 'youtube.com');
    assert.strictEqual(inlineCompletion('www.yout', v), 'youtube.com');
    assert.strictEqual(inlineCompletion('github.com/y', v), 'github.com/yuseff1');
    assert.strictEqual(inlineCompletion('y', v), null, 'too short');
    assert.strictEqual(inlineCompletion('youtube.com', v), null, 'already complete');
    assert.strictEqual(inlineCompletion('how to', v), null);
    assert.strictEqual(inlineCompletion('https://you', v), null, 'typed scheme');
    assert.strictEqual(inlineCompletion('local', [{ url: 'http://localhost:5173/app', visits: 2 }]), 'localhost:5173', 'keeps the port');
  });

  // ---- downloads from popups / quarantined files ----
  test('downloads: a popup opened by an agent tab is quarantined too; quarantined files never open', async () => {
    const { id, wc } = await dlIn(main);
    let asked = 0;
    agentDownloads.register(wc.id, 'run_popup', async () => { asked++; return false; });
    const before = BrowserWindow.getAllWindows().length;
    await wc.executeJavaScript(`window.open(${JSON.stringify(PAGES + '/c?popup=1')}, 'p', 'popup,width=320,height=240'); 1`, true);
    const pop = await until(() => webContents.getAllWebContents().find((w) => !w.isDestroyed() && w.getURL() === PAGES + '/c?popup=1'), 8000, 'popup window');
    assert.ok(BrowserWindow.getAllWindows().length > before, 'opened as a real popup window');
    pop.downloadURL(PAGES + '/dl/from-popup.txt');
    await until(() => asked > 0, 8000, 'popup download asked for approval');
    await sleep(500);
    assert.ok(!fs.existsSync(path.join(DOWNLOADS, 'from-popup.txt')), 'denied popup download not saved');
    agentDownloads.unregisterRun('run_popup');
    try { BrowserWindow.fromWebContents(pop)?.destroy(); } catch {}
    // a pending (unapproved) agent download is listed but refuses to open
    let release;
    agentDownloads.register(wc.id, 'run_pending', () => new Promise((r) => { release = r; }));
    wc.downloadURL(PAGES + '/dl/pending.txt');
    const d = await until(async () => (await owl('downloads')).find((x) => x.filename.includes('pending')), 8000, 'pending download listed');
    assert.ok(agentDownloads.isQuarantined(d.path), 'sits in quarantine');
    assert.strictEqual(await owl('openDownload', d.id), false, 'quarantined download does not open');
    release(false);
    agentDownloads.unregisterRun('run_pending');
    await owl('closeTab', id);
  });

  // ---- incognito agents ----
  test('incognito: agent runs started there use the incognito session and are never persisted', async () => {
    const mainMod = require(path.join(DIST, 'main', 'main.js'));
    const w = await getInc();
    const io = owlOf(w);
    const host = mainMod.__hostForTests('default', true);
    const t = await host.openTab(PAGES + '/a?agent-incog=1', { background: true, agentId: 'hoot', runId: 'run_x' });
    await until(() => t.wc.getURL().includes('agent-incog=1'), 8000, 'agent tab loaded');
    assert.ok(!t.wc.session.isPersistent(), 'agent tab is in the in-memory incognito session');
    assert.notStrictEqual(t.wc.session, defaultSes());
    assert.ok(host.listTabs().some((x) => x.id === t.id), 'listed by the incognito host');
    assert.ok(!mainMod.__hostForTests('default', false).listTabs().some((x) => x.id === t.id), 'invisible to normal runs');
    host.closeTab(t.id);
    // a run started from the incognito window (it fails fast: no model) is listed only there and not saved
    const r = await io('startRun', 'hoot', 'incognito secret task', {});
    await until(async () => (await io('runs')).some((x) => x.id === r.id), 4000, 'run listed in incognito');
    assert.ok(!(await owl('runs')).some((x) => x.id === r.id), 'not listed in the normal window');
    await until(async () => ['failed', 'done', 'stopped'].includes((await io('runs')).find((x) => x.id === r.id)?.status), 8000, 'run ended');
    await sleep(700);
    const disk = fs.existsSync(path.join(profDir('default'), 'runs.json')) ? fs.readFileSync(path.join(profDir('default'), 'runs.json'), 'utf8') : '';
    assert.ok(!disk.includes('incognito secret task'), 'incognito run not written to runs.json');
  });

  // ---- daily-browser features ----
  test('pdf: a PDF opens in the tab (built-in viewer), it is not downloaded', async () => {
    const before = (await owl('downloads')).length;
    const id = await owl('newTab', PAGES + '/doc.pdf');
    await loaded(id, PAGES + '/doc.pdf');
    await sleep(800);
    assert.strictEqual((await owl('downloads')).length, before, 'no download started');
    assert.ok(wcForUrl(PAGES + '/doc.pdf'), 'tab shows the PDF URL');
    await owl('closeTab', id);
  });

  test('zoom: remembered per site, applied when the site is opened again, reset clears it', async () => {
    const id = await owl('newTab', PAGES + '/a');
    await loaded(id, PAGES + '/a');
    await owl('zoom', id, 0.25);
    await owl('zoom', id, 0.25);
    assert.strictEqual((await tabState(id)).zoom, 1.5);
    await sleep(600);
    const prefs = readJson(path.join(profDir('default'), 'site-prefs.json'));
    assert.strictEqual(prefs.zoom['127.0.0.1'], 1.5, JSON.stringify(prefs));
    const id2 = await owl('newTab', PAGES + '/b');
    await loaded(id2, PAGES + '/b');
    await until(async () => (await tabState(id2)).zoom === 1.5, 3000, 'new tab on the same site gets 1.5');
    assert.ok(Math.abs(wcForUrl(PAGES + '/b').getZoomFactor() - 1.5) < 0.01);
    const sites = await owl('siteSettings');
    assert.ok(sites.some((x) => x.site === '127.0.0.1' && x.zoom === 1.5), JSON.stringify(sites));
    await owl('zoom', id2, 'reset');
    await sleep(600);
    assert.ok(!readJson(path.join(profDir('default'), 'site-prefs.json')).zoom['127.0.0.1'], 'reset forgets the site zoom');
    await owl('closeTab', id); await owl('closeTab', id2);
  });

  test('site settings: list decided permissions, change one, reset a site', async () => {
    assert.strictEqual(await owl('setSitePermission', 'https://perm.example', 'geolocation', true), true);
    assert.strictEqual(await owl('setSitePermission', 'https://perm.example', 'notifications', false), true);
    assert.strictEqual(await owl('setSitePermission', 'javascript:alert(1)', 'geolocation', true), false, 'only web origins');
    let s = (await owl('siteSettings')).find((x) => x.site === 'perm.example');
    assert.deepStrictEqual(s.perms, { geolocation: true, notifications: false });
    await owl('setSitePermission', 'https://perm.example', 'notifications', null);
    s = (await owl('siteSettings')).find((x) => x.site === 'perm.example');
    assert.deepStrictEqual(s.perms, { geolocation: true });
    assert.strictEqual(await owl('resetSite', 'perm.example'), true);
    assert.ok(!(await owl('siteSettings')).some((x) => x.site === 'perm.example'));
    assert.strictEqual(await owl('resetSite', '../../etc'), false);
  });

  test('reopen: Ctrl+Shift+T reopens a closed window when it was closed last, then tabs', async () => {
    await owl('newWindow', {});
    const w2 = await until(() => uiWindows().find((w) => w !== main && new URL(w.webContents.getURL()).searchParams.get('incognito') === '0' && new URL(w.webContents.getURL()).searchParams.get('profile') === 'default'), 8000, 'second window');
    await waitUi((q) => true, 'ui ready');
    const o2 = owlOf(w2);
    await until(() => w2.webContents.executeJavaScript('typeof window.owl === "object"'), 8000, 'w2 api');
    const t1 = await o2('newTab', PAGES + '/a?win=1'); await until(async () => (await o2('getState')).tabs.find((x) => x.id === t1 && x.url.includes('win=1') && !x.loading), 8000, 'w2 tab1');
    const t2 = await o2('newTab', PAGES + '/b?win=2'); await until(async () => (await o2('getState')).tabs.find((x) => x.id === t2 && x.url.includes('win=2') && !x.loading), 8000, 'w2 tab2');
    await o2('groupTabs', [t1, t2], undefined, { title: 'Trip', color: 'green' });
    // a tab closed earlier in the main window, then the whole second window
    const tc = await owl('newTab', PAGES + '/c?closed-tab=1'); await loaded(tc, PAGES + '/c?closed-tab=1');
    await owl('closeTab', tc);
    await sleep(50);
    w2.close();
    await until(() => w2.isDestroyed(), 5000, 'w2 closed');
    const known = new Set(uiWindows());
    await owl('command', 'reopen-tab');
    const w3 = await until(() => uiWindows().find((w) => !known.has(w) && new URL(w.webContents.getURL()).searchParams.get('incognito') === '0'), 8000, 'window reopened');
    const o3 = owlOf(w3);
    await until(() => w3.webContents.executeJavaScript('typeof window.owl === "object"'), 8000, 'w3 api');
    const urls = await until(async () => { const u = (await o3('getState')).tabs.map((t) => t.url); return u.some((x) => x.includes('win=1')) && u.some((x) => x.includes('win=2')) ? u : null; }, 8000, 'reopened window has both tabs');
    assert.ok(urls);
    // the window's tab group comes back with it
    const st3 = await o3('getState');
    const g3 = st3.groups.find((g) => g.title === 'Trip');
    assert.ok(g3 && g3.color === 'green', 'group restored with its name and colour');
    assert.strictEqual(st3.tabs.filter((t) => t.groupId === g3.id).length, 2, 'both tabs back in the group');
    // next Ctrl+Shift+T brings back the tab closed before the window
    await owl('command', 'reopen-tab');
    await until(async () => (await state()).tabs.some((t) => t.url.includes('closed-tab=1')), 8000, 'tab reopened');
    w3.close();
    for (const t of (await state()).tabs.filter((t) => t.url.includes('closed-tab=1'))) await owl('closeTab', t.id);
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
