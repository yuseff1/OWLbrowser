import { fatal, logLine, markStartupDone } from './crash'; // first: installs crash handlers before any other module runs
import { app, BrowserWindow, ipcMain, session, Session, dialog, shell, Notification, nativeTheme, net, webContents, protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { OwlWindow, Tab, normalizeInput, searchUrl, type Bounds } from './window';
import { profiles, sessionFor } from './profiles';
import { settings, providers, PROVIDER_PRESETS } from './settings';
import { dataFor, flushAll, history, bookmarks } from './data';
import { secrets } from './secrets';
import { JsonStore, uid } from './store';
import { AgentRuntime } from './agents/runner';
import { RoutineScheduler } from './agents/routines';
import { companions } from './agents/companions';
import { memory, flushMemory } from './agents/memory';
import { skills } from './agents/skills';
import { chat } from './agents/llm';
import { READ_SCRIPT } from './agents/page-scripts';
import { htmlToText, type BrowserHost } from './agents/browser-tools';
import { mcp, APP_CATALOG } from './mcp';
import { computer } from './agents/computer';
import { detectSources, importFrom, importPasswordsCsv, loadInstalledExtensions, passwords } from './import/chromium';
import { enableAdblock, disableAdblock } from './adblock';
import type { DownloadItem, Artifact } from '../shared/types';
import { isTrustedUiFrame } from './ui-protocol';
import { artifactUrl } from './artifact-protocol';
import { threads } from './threads';
import { isWebUrl, isPrivateHost } from './net-guard';
import { gateAgentDownload, agentDownloads } from './downloads';
import { sitePrefs, zoomKey as zoomKeyOf } from './site-prefs';
import { dedupeSuggestions, inlineCompletion, urlKey, type Suggestion } from './suggest';
import { companionChat } from './agents/companion-chat';
import { updater } from './updater';
import { restoreTabs, snapshotWindow, sleepTab, sampleScroll, installScrollRestore, type SavedWindow } from './session-restore';

// ---------- process-level performance flags (lower RAM than stock Chrome) ----------
app.commandLine.appendSwitch('enable-features', 'BackForwardCache,ReduceUserAgent,PartitionAlloc,HighEfficiencyModeAvailable,ThrottleDisplayNoneAndVisibilityHiddenCrossOriginIframes');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,MediaRouter,OptimizationHints,Translate,InterestFeedContentSuggestions');
app.commandLine.appendSwitch('renderer-process-limit', '24');
// note: '--lite-mode=false' is not a valid V8 flag (bools are --flag/--no-flag) and was rejected at every start
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
app.setAppUserModelId('tech.varsen.owl');

const isDev = process.argv.includes('--dev');
const windows = new Set<OwlWindow>();
const appState = new JsonStore<{ onboardingDone: boolean; userName?: string; companionId?: string }>('app', { onboardingDone: false });
const preparedSessions = new Set<string>();
const downloads = new Map<string, Electron.DownloadItem>();
const pendingPasswords = new Map<string, { profileId: string; origin: string; username: string; password: string }>();
/** incognito downloads live only in memory (per profile) and are dropped when its last incognito window closes */
const incognitoDownloads = new Map<string, DownloadItem[]>();
/** recently closed incognito tabs (per profile, memory only): never offered by "reopen closed tab" in a normal window */
const incognitoClosed = new Map<string, string[]>();
/** recently closed normal windows (per profile, memory only) for Ctrl+Shift+T, newest last */
const closedWindows = new Map<string, Array<{ at: number; saved: SavedWindow }>>();
/** when each entry of a closed-tabs list was closed (parallel array), to pick tab vs window on reopen */
const closedAt = new WeakMap<string[], number[]>();
function closedTabsFor(w: OwlWindow): string[] {
  if (!w.incognito) return dataFor(w.profileId).closedTabs;
  let l = incognitoClosed.get(w.profileId);
  if (!l) incognitoClosed.set(w.profileId, (l = []));
  return l;
}
function downloadStore(profileId: string, incognito: boolean): { get(): DownloadItem[]; update(fn: (l: DownloadItem[]) => DownloadItem[] | void): void } {
  if (!incognito) return dataFor(profileId).downloads;
  return {
    get: () => incognitoDownloads.get(profileId) || [],
    update: (fn) => { const cur = incognitoDownloads.get(profileId) || []; const r = fn(cur); incognitoDownloads.set(profileId, r || cur); },
  };
}
/** at most this many tabs per agent run, and across all running agents in a profile */
const MAX_AGENT_TABS_PER_RUN = 5;
const MAX_AGENT_TABS = 12;

// A second launch hands its argv to the running instance (see 'second-instance') and exits at once.
// app.exit() before 'ready' terminates immediately: no 'ready', no before-quit flush that could
// overwrite the first instance's settings/secrets with this process's stale copy.
const gotLock = app.requestSingleInstanceLock();
logLine('info', `launch pid=${process.pid} gotLock=${gotLock}`);
// Heartbeat: the instance holding the lock stamps userData/instance.json every 5 s. A second launch that
// finds the stamp stale (that instance hung before showing a window, or its event loop is frozen) or
// missing (a pre-0.1.13 zombie) kills it and relaunches, instead of exiting into nothing on every click.
const beatFile = path.join(app.getPath('userData'), 'instance.json');
function readBeat(): { pid: number; beat: number } | null {
  try { const j = JSON.parse(fs.readFileSync(beatFile, 'utf8')); return typeof j?.pid === 'number' && typeof j?.beat === 'number' ? j : null; } catch { return null; }
}
if (gotLock) {
  const stamp = () => { try { fs.writeFileSync(beatFile, JSON.stringify({ pid: process.pid, beat: Date.now() })); } catch { /* read-only profile dir */ } };
  stamp();
  setInterval(stamp, 5000).unref();
  app.on('will-quit', () => { try { const b = readBeat(); if (b?.pid === process.pid) fs.unlinkSync(beatFile); } catch { /* gone */ } });
} else {
  let b = readBeat();
  let stale = !b || Date.now() - b.beat > 20_000;
  if (stale && b) {
    // a healthy instance just waking from sleep stamps again within 5 s: give it 7 s before judging
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 7000);
    b = readBeat();
    stale = !b || Date.now() - b.beat > 20_000;
  }
  if (stale && process.platform === 'win32' && !process.argv.includes('--owl-relaunched')) {
    logLine('warn', `running instance unresponsive (beat=${b ? Date.now() - b.beat + 'ms ago' : 'missing'}); killing it and relaunching`);
    try {
      const { execFileSync } = require('child_process') as typeof import('child_process');
      const img = path.basename(process.execPath);
      const args = b && b.pid !== process.pid ? ['/F', '/PID', String(b.pid)] : ['/F', '/IM', img, '/FI', `PID ne ${process.pid}`];
      try { execFileSync('taskkill', args, { windowsHide: true, timeout: 8000 }); } catch { /* already gone */ }
      if (b) { try { execFileSync('taskkill', ['/F', '/IM', img, '/FI', `PID ne ${process.pid}`], { windowsHide: true, timeout: 8000 }); } catch { /* none left */ } }
    } catch (e) { logLine('error', 'stale instance kill', e); }
    app.relaunch({ args: [...process.argv.slice(1), '--owl-relaunched'] });
  }
  app.exit(0);
}

/** A web URL or an .html/.htm/.pdf path passed on the command line (shell "Open with", file association, default browser). */
function launchArg(argv: string[]): string | undefined {
  return argv.find((a) => !a.startsWith('-') && (/^https?:\/\//i.test(a) || /\.(html?|pdf)$/i.test(a)));
}

app.on('second-instance', (_e, argv) => {
  const url = launchArg(argv.slice(1));
  const w = focusedWindow() || [...windows][0];
  try {
    if (w) { if (w.win.isMinimized()) w.win.restore(); if (!w.win.isVisible()) w.win.show(); w.win.focus(); if (url) w.newTab(fileToUrl(url)); }
    else createWindow(profiles.lastUsed(), false, url ? [fileToUrl(url)] : undefined);
  } catch (e) { logLine('error', 'second-instance', e); }
});

app.on('open-url', (e, url) => { e.preventDefault(); const w = focusedWindow(); if (w) w.newTab(url); else app.whenReady().then(() => createWindow(profiles.lastUsed(), false, [url])); });

// pathToFileURL percent-encodes spaces, '#', '%' and non-ASCII characters (e.g. C:\Users\José\a b.html)
function fileToUrl(p: string) { if (/^https?:/i.test(p)) return p; try { return pathToFileURL(path.resolve(p)).href; } catch { return 'file:///' + p.replace(/\\/g, '/'); } }

function focusedWindow(): OwlWindow | null {
  const f = BrowserWindow.getFocusedWindow();
  for (const w of windows) if (w.win === f) return w;
  return [...windows].pop() || null;
}
/** The OWL window whose UI document sent this IPC, or null for anything else (web pages, iframes, artifacts, popups). */
function windowFor(e: Electron.IpcMainInvokeEvent): OwlWindow | null {
  if (!isTrustedUiFrame(e.senderFrame)) return null;
  for (const w of windows) if (!w.win.isDestroyed() && w.win.webContents === e.sender) return w;
  return null;
}
function knownProfile(id: unknown): string {
  if (typeof id !== 'string' || !profiles.list().some((p) => p.id === id)) throw new Error('Unknown profile');
  return id;
}

// Defence in depth for every renderer: no <webview> tags anywhere.
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (ev) => ev.preventDefault());
  // popups opened by an agent-driven page keep its download quarantine (see downloads.ts)
  wc.on('did-create-window', (child) => { try { agentDownloads.inherit(child.webContents.id, wc.id); } catch { /* closed */ } });
});
function windowsForProfile(pid: string) { return [...windows].filter((w) => w.profileId === pid && !w.incognito); }
function broadcast(profileId: string | null, type: string, payload?: any) {
  for (const w of windows) if (!profileId || w.profileId === profileId) w.send(type, payload);
}
function toast(w: OwlWindow | null, title: string, body?: string, kind = 'info') { (w ? [w] : [...windows]).forEach((x) => x.send('toast', { title, body, kind })); }

// ---------- sessions ----------
function prepareSession(profileId: string, incognito: boolean): Session {
  const ses = sessionFor(profileId, incognito);
  const key = profileId + (incognito ? ':inc' : '');
  if (preparedSessions.has(key)) return ses;
  preparedSessions.add(key);

  // Chrome-like UA (drop Electron/OWL tokens so sites treat us as Chrome)
  const ua = ses.getUserAgent().replace(/\s?Electron\/[\d.]+/, '').replace(/\s?owl-browser\/[\d.]+/i, '').replace(/\s?OWL\/[\d.]+/i, '');
  ses.setUserAgent(ua);
  ses.setSpellCheckerLanguages(['en-US', 'es-ES']);

  ses.webRequest.onBeforeSendHeaders((d, cb) => {
    const h = d.requestHeaders;
    if (settings.get().sendDoNotTrack) { h['DNT'] = '1'; h['Sec-GPC'] = '1'; }
    cb({ requestHeaders: h });
  });

  if (settings.get().adblock) enableAdblock(ses).catch((e) => console.warn('[adblock]', e.message));

  const DEVICE_PERMS = new Set(['hid', 'serial', 'usb', 'bluetooth']);
  const storedPerm = (origin: string, permission: string): boolean | undefined => {
    const perms: Record<string, boolean> | undefined = (dataFor(profileId).session.get() as any).perms;
    return perms ? perms[origin + '|' + permission] : undefined;
  };
  // Permission *checks* (navigator.permissions, device APIs): honour the user's stored choice; device APIs default to deny.
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    let origin = '';
    try { origin = new URL(requestingOrigin).origin; } catch { /* opaque */ }
    const stored = origin ? storedPerm(origin, permission) : undefined;
    if (stored !== undefined) return stored;
    if (DEVICE_PERMS.has(permission)) return false;
    // Notifications: a `true` check makes Notification.permission 'granted' and `new Notification()` shows
    // without ever reaching the request handler (verified on Electron 45), i.e. any site could post OS
    // notifications silently. Undecided → false; Notification.requestPermission() still prompts below.
    if (permission === 'notifications') return false;
    return true; // Electron's default for everything else; real grants still go through the request handler below
  });
  ses.setDevicePermissionHandler(() => false); // WebHID / WebSerial / WebUSB devices are never auto-granted
  ses.on('select-hid-device', (e, _d, cb) => { e.preventDefault(); cb(); });
  ses.on('select-serial-port', (e, _ports, _wc, cb) => { e.preventDefault(); cb(''); });
  ses.on('select-usb-device', (e, _d, cb) => { e.preventDefault(); cb(); });

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const auto = ['fullscreen', 'clipboard-sanitized-write', 'pointerLock']; // window-management (multi-screen details) now prompts, like Chrome
    if (auto.includes(permission)) return callback(true);
    const origin = (() => { try { return new URL(details.requestingUrl || wc.getURL()).origin; } catch { return 'This site'; } })();
    const store = dataFor(profileId).session as any;
    const perms: Record<string, boolean> = (store.get().perms ||= {});
    const k = origin + '|' + permission;
    if (k in perms) return callback(perms[k]);
    // Only prompt for a page that lives in a live OWL window; anything else (no window open, a window
    // that is closing, popups/background contents) is denied instead of crashing on a destroyed parent.
    const alive = (x: OwlWindow | null | undefined) => !!x && !x.win.isDestroyed();
    const owner = [...windows].find((x) => x.tabs.some((t) => t.wc === wc));
    const w = alive(owner) ? owner! : alive(focusedWindow()) ? focusedWindow()! : null;
    if (!w || DEVICE_PERMS.has(permission) || wc.isDestroyed()) return callback(false);
    let answered = false;
    const answer = (ok: boolean) => { if (answered) return; answered = true; try { callback(ok); } catch { /* request already gone */ } };
    const label = ({ media: 'use your camera/microphone', geolocation: 'know your location', notifications: 'show notifications', midi: 'use MIDI devices', 'clipboard-read': 'read your clipboard', 'display-capture': 'capture your screen' } as any)[permission] || permission;
    wc.once('destroyed', () => answer(false));
    try {
      dialog.showMessageBox(w.win, { type: 'question', buttons: ['Allow', 'Block'], defaultId: 1, cancelId: 1, message: `${origin} wants to ${label}`, checkboxLabel: 'Remember for this site', checkboxChecked: true })
        .then(({ response, checkboxChecked }) => {
          const ok = response === 0;
          if (checkboxChecked && !incognito) { perms[k] = ok; store.set(store.get()); }
          answer(ok);
        })
        .catch((e) => { logLine('warn', 'permission prompt', e); answer(false); });
    } catch (e) { logLine('warn', 'permission prompt', e); answer(false); }
  });

  ses.on('will-download', (_e, item, wc) => {
    const id = uid('d_');
    downloads.set(id, item);
    const dir = app.getPath('downloads');
    const safeName = path.basename(item.getFilename() || 'download').replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').replace(/^\.+/, '_') || 'download';
    // agent-driven tabs: quarantined + paused until the user approves (see downloads.ts)
    const gate = gateAgentDownload(item, wc, path.join(dir, safeName), uniquePath);
    let reserved: string | null = null;
    if (!gate) { reserved = uniquePath(path.join(dir, safeName)); reservedPaths.add(pathKey(reserved)); item.setSavePath(reserved); }
    const savedAt = () => (gate ? gate.currentPath() : item.getSavePath());
    const rec = (): DownloadItem => ({ id, url: item.getURL(), filename: path.basename(savedAt()), path: savedAt(), received: item.getReceivedBytes(), total: item.getTotalBytes(), state: item.getState(), startedAt: Math.round(item.getStartTime() * 1000) });
    // incognito: never written to the profile's download history, only shown to that profile's incognito windows
    const store = downloadStore(profileId, incognito);
    const targets = () => [...windows].filter((w) => w.profileId === profileId && w.incognito === incognito);
    const save = () => { const r = rec(); store.update((l) => { const i = l.findIndex((x) => x.id === id); if (i >= 0) l[i] = r; else l.unshift(r); if (l.length > 500) l.length = 500; }); targets().forEach((w) => w.send('download', r)); };
    save();
    let last = 0;
    item.on('updated', () => { if (Date.now() - last > 400) { last = Date.now(); save(); } });
    item.once('done', async (_ev, state) => { if (reserved) reservedPaths.delete(pathKey(reserved)); const kept = gate ? await gate.settled : state === 'completed'; save(); downloads.delete(id); if (kept) targets().forEach((w) => toast(w, 'Downloaded', path.basename(savedAt()), 'success')); });
  });

  if (!incognito) loadInstalledExtensions(ses, profileId).catch(() => {});
  return ses;
}

/**
 * Chromium writes to a temporary file and only creates the target at the end, so two downloads of the
 * same name started together both saw "free" and the second overwrote the first. Targets of downloads
 * in flight are reserved here until they finish. Compared case-insensitively on Windows/macOS.
 */
const reservedPaths = new Set<string>();
const pathKey = (p: string) => (process.platform === 'linux' ? p : p.toLowerCase());
function uniquePath(p: string) {
  const free = (c: string) => !fs.existsSync(c) && !reservedPaths.has(pathKey(c));
  if (free(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 1; i < 999; i++) { const c = path.join(dir, `${name} (${i})${ext}`); if (free(c)) return c; }
  return p;
}

// ---------- windows ----------
function createWindow(profileId: string, incognito = false, urls?: string[], reopen?: SavedWindow): OwlWindow {
  prepareSession(profileId, incognito);
  const w = new OwlWindow(profileId, incognito, {
    onState: () => {},
    onClosed: (ow) => {
      saveSession(ow.profileId);
      windows.delete(ow);
      if (!ow.incognito && !quitting) {
        try {
          const saved = snapshotWindow(ow);
          if (saved.urls.some((u) => /^(https?|file):/i.test(u))) {
            let l = closedWindows.get(ow.profileId); if (!l) closedWindows.set(ow.profileId, (l = []));
            l.push({ at: Date.now(), saved }); if (l.length > 10) l.shift();
          }
        } catch (e) { logLine('warn', 'closed window snapshot', e); }
      }
      if (ow.incognito && ![...windows].some((x) => x.incognito && x.profileId === ow.profileId)) { incognitoDownloads.delete(ow.profileId); incognitoClosed.delete(ow.profileId); sitePrefs.dropIncognito(ow.profileId); }
    },
    onCommand: (ow, cmd, arg) => runCommand(ow, cmd, arg),
    onPasswordSubmit: (ow, _tab, data) => {
      if (ow.incognito || !data.password) return;
      const existing = passwords.findForOrigin(ow.profileId, data.origin).find((p) => p.username === data.username);
      if (existing) { const cur = passwords.get(ow.profileId, existing.id); if (cur?.password === data.password) return; }
      const id = uid('pp_');
      pendingPasswords.set(id, { profileId: ow.profileId, ...data });
      setTimeout(() => pendingPasswords.delete(id), 15 * 60_000).unref(); // an ignored prompt must not keep the plaintext forever
      ow.send('password-prompt', { id, origin: data.origin, username: data.username, update: !!existing });
    },
    onNewWindowRequest: () => {},
  });
  windows.add(w);
  profiles.setLastUsed(profileId);
  const restore = (reopen ?? (!incognito && !urls?.length && settings.get().restoreSession ? dataFor(profileId).session.get().windows?.[0] : null)) as SavedWindow | null;
  // restored background tabs are created asleep (no renderer) and load on first activation
  if (restore?.urls?.length) restoreTabs(w, restore);
  else (urls?.length ? urls : ['owl://newtab']).forEach((u, i) => w.newTab(u, { background: i > 0 }));
  return w;
}

function saveSession(profileId: string) {
  const ws = windowsForProfile(profileId);
  if (!ws.length) return;
  dataFor(profileId).session.update((s) => { s.windows = ws.map(snapshotWindow); });
}

// ---------- browser host for agents ----------
/**
 * The tabs an agent may use. A run started in an incognito window works only in that profile's incognito
 * windows (in-memory session, no history, no cookies of the normal profile); a normal run never sees them.
 */
function hostFor(profileId: string, incognito = false): BrowserHost {
  const scope = () => (incognito ? [...windows].filter((w) => w.profileId === profileId && w.incognito && !w.win.isDestroyed()) : windowsForProfile(profileId));
  const pickWindow = () => scope()[0] || createWindow(profileId, incognito);
  const allTabs = () => scope().flatMap((w) => w.tabs);
  return {
    async openTab(url, opts) {
      const w = pickWindow();
      // cap agent tabs: a run recycles its own least-recently-used tab; a profile-wide flood is refused
      const agentTabs = allTabs().filter((t) => t.agentId);
      const mine = agentTabs.filter((t) => t.agentRunId === opts.runId).sort((a, b) => a.lastActive - b.lastActive);
      if (mine.length >= MAX_AGENT_TABS_PER_RUN) {
        const victim = mine.find((t) => !scope().some((x) => x.activeId === t.id || x.splitId === t.id));
        if (victim) { for (const x of scope()) if (x.tab(victim.id)) x.close(victim.id); }
        else throw new Error(`This task already has ${mine.length} tabs open. Close one with close_tab or reuse one with navigate.`);
      } else if (agentTabs.length >= MAX_AGENT_TABS) {
        throw new Error(`Agents already have ${agentTabs.length} tabs open. Close one with close_tab or reuse one with navigate.`);
      }
      const t = w.newTab(url, { background: opts.background, agentId: opts.agentId, runId: opts.runId });
      return { id: t.id, wc: t.wc! };
    },
    getTab(id) {
      const t = allTabs().find((x) => x.id === id);
      if (!t) return null;
      if (t.sleeping) t.wake();
      if (!t.wc) return null;
      return { id: t.id, wc: t.wc, url: t.wc.getURL(), title: t.title };
    },
    listTabs() { return allTabs().filter((t) => !t.internal).map((t) => ({ id: t.id, url: t.wc?.getURL() || t.url, title: t.title, agentId: t.agentId })); },
    closeTab(id) { for (const w of scope()) if (w.tab(id)) w.close(id); },
    focusTab(id) { for (const w of scope()) if (w.tab(id)) { w.activate(id); w.win.focus(); } },
    async fetchText(url) {
      const ses = prepareSession(profileId, incognito);
      if (!isWebUrl(url)) throw new Error('Only http(s) URLs can be fetched');
      const startPrivate = isPrivateHost(new URL(url).hostname); // caller already approved a local address
      let cur = url;
      for (let hop = 0; hop < 6; hop++) {
        const r = await ses.fetch(cur, { redirect: 'manual', headers: { 'User-Agent': ses.getUserAgent(), Accept: 'text/html,application/xhtml+xml,*/*' } });
        const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
        if (!loc) { const t = await r.text(); return t.slice(0, 2_000_000); }
        const next = new URL(loc, cur).toString();
        if (!isWebUrl(next)) throw new Error('Redirect to a non-web URL was blocked');
        if (!startPrivate && isPrivateHost(new URL(next).hostname)) throw new Error('Redirect to a local-network address was blocked');
        cur = next;
      }
      throw new Error('Too many redirects');
    },
  };
}

const runtime = new AgentRuntime({
  host: hostFor,
  openArtifact: (profileId, a, incognito) => {
    const w = incognito ? [...windows].find((x) => x.profileId === profileId && x.incognito) : windowsForProfile(profileId)[0];
    w?.newTab('owl://artifact', { artifactId: a.id, background: false });
  },
  notify: (title, body) => {
    if (Notification.isSupported()) new Notification({ title, body, silent: true, icon: path.join(__dirname, '..', 'renderer', 'art', 'owl-icon.png') }).show();
  },
});
runtime.on('update', (run) => {
  const pid = (run as any).profileId || [...windows][0]?.profileId;
  const payload = { ...run, profileId: undefined, startTab: undefined, incognito: undefined };
  // incognito runs are shown only in that profile's incognito windows; normal runs never reach them
  for (const w of windows) if (w.profileId === pid && w.incognito === !!(run as any).incognito) w.send('run', payload);
  // reflect agent ownership on tabs
  for (const w of windows) {
    let changed = false;
    for (const t of w.tabs) if (t.agentRunId === run.id && ['done', 'failed', 'stopped'].includes(run.status)) { t.agentId = undefined; t.agentRunId = undefined; changed = true; }
    if (changed) w.pushState();
  }
});

const scheduler = new RoutineScheduler(runtime, () => profiles.list().map((p) => p.id), (pid, url) => hostFor(pid).fetchText(url));

// ---------- memory saver (sleeping tabs) ----------
// Sleeping = the tab's WebContents is closed (renderer freed); URL, title and scroll are kept and
// restored on activation (see session-restore.ts). Never sleeps: active/split tabs, agent tabs,
// audible tabs, internal pages; pinned tabs get 3 h of grace.
let saverBusy = false;
setInterval(async () => {
  const s = settings.get();
  if (saverBusy) return;
  saverBusy = true;
  try {
    const now = Date.now();
    for (const w of [...windows]) {
      if (w.win.isDestroyed()) continue;
      const keep = (t: Tab) => t.id === w.activeId || t.id === w.splitId || !!t.agentId || !!t.wc?.isCurrentlyAudible();
      const awake = w.tabs.filter((t) => t.view && !t.internal);
      if (!w.incognito) await sampleScroll(awake).catch(() => {});
      if (!s.memorySaver) continue;
      const eligible = (t: Tab) => !!t.view && !keep(t) && windows.has(w);
      const victims = new Set<Tab>();
      for (const t of awake) {
        if (!eligible(t) || (t.pinned && now - t.lastActive < 3 * 3600_000)) continue;
        if (now - t.lastActive > s.sleepAfterMinutes * 60_000) victims.add(t);
      }
      const still = awake.filter((t) => eligible(t) && !victims.has(t)).sort((a, b) => a.lastActive - b.lastActive);
      const cap = Math.max(1, s.maxAwakeTabs | 0);
      while (still.length > cap) victims.add(still.shift()!);
      let changed = false;
      for (const t of victims) if (await sleepTab(t, () => eligible(t))) changed = true;
      if (changed && !w.win.isDestroyed()) w.pushState();
    }
  } catch (e) { logLine('warn', 'memory saver', e); }
  finally { saverBusy = false; }
}, 60_000);

// ---------- commands (shortcuts & menus) ----------
function runCommand(w: OwlWindow, cmd: string, arg?: any) {
  const t = w.active;
  const wc = t?.wc;
  switch (cmd) {
    case 'new-tab': w.newTab('owl://newtab'); w.send('command', { cmd: 'focus-omnibox' }); break;
    case 'close-tab': if (t) w.close(t.id); break;
    case 'focus-page': if (wc && !wc.isDestroyed() && !w.overlay) wc.focus(); break; // Escape in the omnibox hands keys back to the page
    case 'reopen-tab': {
      // Chrome: reopens whatever was closed last, a tab or a whole window
      const l = closedTabsFor(w);
      const times = closedAt.get(l) || [];
      const cw = w.incognito ? undefined : closedWindows.get(w.profileId);
      const lastWin = cw?.[cw.length - 1];
      if (lastWin && lastWin.at >= (times[times.length - 1] ?? 0)) { cw!.pop(); createWindow(w.profileId, false, undefined, lastWin.saved); break; }
      const u = l.pop(); times.pop();
      if (u) w.newTab(u);
      break;
    }
    case '__closed': {
      const l = closedTabsFor(w);
      let times = closedAt.get(l); if (!times) closedAt.set(l, (times = []));
      l.push(arg); times.push(Date.now());
      if (l.length > 50) { l.shift(); times.shift(); }
      break;
    }
    case 'new-window': createWindow(w.profileId); break;
    case 'incognito': createWindow(w.profileId, true); break;
    case 'reload': wc?.reload(); break;
    case 'hard-reload': wc?.reloadIgnoringCache(); break;
    case 'back': wc?.navigationHistory.goBack(); break;
    case 'forward': wc?.navigationHistory.goForward(); break;
    case 'zoom-in': if (t) w.zoomTab(t.id, 0.1); break;
    case 'zoom-out': if (t) w.zoomTab(t.id, -0.1); break;
    case 'zoom-reset': if (t) w.zoomTab(t.id, 'reset'); break;
    case 'next-tab': case 'prev-tab': {
      const vis = w.tabs.filter((x) => !x.hidden); const i = vis.findIndex((x) => x.id === w.activeId);
      const n = vis[(i + (cmd === 'next-tab' ? 1 : -1) + vis.length) % vis.length]; if (n) w.activate(n.id); break;
    }
    case 'goto-tab': { const vis = w.tabs.filter((x) => !x.hidden); const n = arg === 9 ? vis[vis.length - 1] : vis[arg - 1]; if (n) w.activate(n.id); break; }
    case 'devtools': wc?.toggleDevTools(); break;
    case 'print': wc?.print(); break;
    case 'view-source': if (wc) w.newTab('view-source:' + wc.getURL()); break;
    case 'save-page': if (wc) dialog.showSaveDialog(w.win, { defaultPath: (t!.title || 'page').replace(/[\\/:*?"<>|]/g, '_') + '.html' }).then((r) => { if (r.filePath) wc.savePage(r.filePath, 'HTMLComplete').catch(() => {}); }); break;
    case 'exit-fullscreen': w.win.setFullScreen(false); break;
    case 'bookmark': if (t && wc) { const on = bookmarks.toggle(w.profileId, wc.getURL(), t.title, t.favicon); toast(w, on ? 'Bookmarked' : 'Bookmark removed'); w.send('command', { cmd: 'bookmark-changed' }); } break;
    case 'history': w.newTab('owl://history'); break;
    case 'downloads': w.newTab('owl://downloads'); break;
    case 'bookmarks': w.newTab('owl://bookmarks'); break;
    case 'toggle-split': {
      if (w.splitId) w.setSplit(null);
      else { const other = w.tabs.filter((x) => !x.hidden && x.id !== w.activeId).sort((a, b) => b.lastActive - a.lastActive)[0]; if (other) w.setSplit(other.id); }
      break;
    }
    // shell: link context menu + F11 / Ctrl+Shift+W (window.ts)
    case 'open-in-window': case 'open-in-incognito': if (typeof arg === 'string' && /^(https?|file):/i.test(arg)) createWindow(w.profileId, cmd === 'open-in-incognito', [arg]); break;
    case 'toggle-fullscreen': w.win.setFullScreen(!w.win.isFullScreen()); break;
    case 'close-window': w.win.close(); break;
    default: w.send('command', { cmd, arg });
  }
}

// ---------- IPC API (see src/preload/ui.ts) ----------
type Handler = (w: OwlWindow, ...args: any[]) => any;
const api: Record<string, Handler> = {
  getState: (w) => w.state(),
  setBounds: (w, b: Bounds, split: Bounds | null) => w.setBounds(b, split),
  setOverlay: async (w, on: boolean) => {
    let shot: string | null = null;
    if (on && w.active?.wc && !w.overlay) {
      try { const img = await w.active.wc.capturePage(); shot = 'data:image/jpeg;base64,' + img.resize({ width: Math.min(1600, img.getSize().width) }).toJPEG(60).toString('base64'); } catch {}
    }
    w.setOverlay(on);
    return shot;
  },
  newTab: (w, url?: string, opts?: any) => w.newTab(url ? normalizeInput(url) : 'owl://newtab', opts || {}).id,
  closeTab: (w, id) => w.close(id),
  activateTab: (w, id) => w.activate(id),
  moveTab: (w, id, i) => w.move(id, i),
  // tab groups: ids → group (new when groupId missing); patch { title?, color?, collapsed? }
  groupTabs: (w, ids: number[], groupId?: string, opts?: any) => w.groupTabs((Array.isArray(ids) ? ids : [ids]).filter((x) => typeof x === 'number'), typeof groupId === 'string' ? groupId : undefined, opts && typeof opts === 'object' ? { title: typeof opts.title === 'string' ? opts.title : undefined, color: opts.color } : {}),
  ungroupTabs: (w, ids: number[]) => w.ungroupTabs((Array.isArray(ids) ? ids : [ids]).filter((x) => typeof x === 'number')),
  updateGroup: (w, id: string, patch: any) => { if (typeof id === 'string') w.updateGroup(id, patch); },
  closeGroup: (w, id: string) => { if (typeof id === 'string') w.closeGroup(id); },
  navigate: (w, id, input: string) => {
    const t = w.tab(id) || w.active;
    if (!t) return;
    const url = normalizeInput(input);
    if (url.startsWith('owl://')) {
      const n = w.newTab(url, { index: w.tabs.indexOf(t) });
      if (t.internal === 'newtab' || t.url === 'about:blank') w.close(t.id);
      return n.id;
    }
    if (t.internal) { t.internal = undefined; t.url = url; t.title = hostOfUrl(url); t.wake(); w.layout(); w.pushState(); return t.id; }
    if (t.sleeping) t.wake();
    t.wc?.loadURL(url).catch(() => {});
    t.wc?.focus();
    return t.id;
  },
  back: (w, id) => w.tab(id)?.wc?.navigationHistory.goBack(),
  forward: (w, id) => w.tab(id)?.wc?.navigationHistory.goForward(),
  reload: (w, id) => { const t = w.tab(id); if (t?.sleeping) t.wake(); else t?.wc?.reload(); },
  stop: (w, id) => w.tab(id)?.wc?.stop(),
  pinTab: (w, id) => { const t = w.tab(id); if (t) { t.pinned = !t.pinned; if (t.pinned && t.groupId) { t.groupId = undefined; w.pruneGroups(); } const i = w.tabs.indexOf(t); w.tabs.splice(i, 1); const lastPinned = w.tabs.filter((x) => x.pinned).length; w.tabs.splice(t.pinned ? lastPinned : lastPinned, 0, t); w.pushState(); } },
  muteTab: (w, id) => { const t = w.tab(id); if (t) { t.muted = !t.muted; t.wc?.setAudioMuted(t.muted); w.pushState(); } },
  duplicateTab: (w, id) => { const t = w.tab(id); if (t) w.newTab(t.internal ? `owl://${t.internal}` : t.wc?.getURL() || t.url, { index: w.tabs.indexOf(t) + 1 }); },
  sleepTab: async (w, id) => { const t = w.tab(id); if (t && t.id !== w.activeId) await sleepTab(t, () => t.id !== w.activeId); w.pushState(); },
  reopenClosed: (w) => runCommand(w, 'reopen-tab'),
  setSplit: (w, id) => w.setSplit(id),
  zoom: (w, id, d) => w.zoomTab(id, d),
  find: (w, id, text: string, opts: any) => { const wc = w.tab(id)?.wc; if (wc && text) wc.findInPage(text, opts || {}); },
  stopFind: (w, id) => w.tab(id)?.wc?.stopFindInPage('clearSelection'),
  devtools: (w, id) => w.tab(id)?.wc?.toggleDevTools(),
  print: (w, id) => w.tab(id)?.wc?.print(),
  command: (w, cmd, arg) => runCommand(w, cmd, arg),
  windowControl: (w, a: string) => { if (a === 'minimize') w.win.minimize(); else if (a === 'maximize') w.win.isMaximized() ? w.win.unmaximize() : w.win.maximize(); else if (a === 'close') w.win.close(); else if (a === 'fullscreen') w.win.setFullScreen(!w.win.isFullScreen()); },
  newWindow: (w, opts: any = {}) => { createWindow(opts?.profileId ? knownProfile(opts.profileId) : w.profileId, !!opts?.incognito); },
  suggest: (w, text: string, opts?: { inline?: boolean }) => suggest(w, text, !!(opts && typeof opts === 'object' && opts.inline === true)),
  pageInfo: (w, id) => { const t = w.tab(id); const url = t?.wc?.getURL() || t?.url || ''; return { url, title: t?.title, secure: url.startsWith('https:') }; },

  profiles: (w) => ({ profiles: profiles.list(), current: w.profileId }),
  createProfile: (_w, name: string, color?: string) => { const p = profiles.create(String(name ?? '').slice(0, 64), typeof color === 'string' ? color : undefined); createWindow(p.id); return p; },
  renameProfile: (_w, id, name, color) => profiles.rename(knownProfile(id), String(name ?? '').slice(0, 64), typeof color === 'string' ? color : undefined),
  removeProfile: async (_w, id) => {
    knownProfile(id);
    if (id === 'default') return; // profiles.remove refuses it too; keep its secrets
    for (const r of runtime.list(id).concat(runtime.list(id, true))) if (!['done', 'failed', 'stopped'].includes(r.status)) runtime.stop(r.id);
    const mine = () => [...windows].filter((w) => w.profileId === id);
    for (const w of mine()) w.win.close(); // incognito windows too
    // wait for its windows (and their page webContents) to go, so the partition files can be released
    for (let i = 0; i < 50 && mine().length; i++) await new Promise((r) => setTimeout(r, 100));
    for (const w of mine()) { try { w.win.destroy(); } catch { /* gone */ } }
    for (const p of passwords.list(id)) passwords.remove(id, p.id);
    for (const a of mcp.list(id)) mcp.remove(id, a.id);
    for (const k of [...secrets.keys(`pw:${id}:`), ...secrets.keys(`mcp:${id}:`)]) secrets.set(k, null);
    secrets.flush();
    preparedSessions.delete(id); preparedSessions.delete(id + ':inc');
    await profiles.remove(id);
  },
  openProfile: (_w, id) => { knownProfile(id); const ex = windowsForProfile(id)[0]; if (ex) ex.win.focus(); else createWindow(id); },

  bookmarks: (w) => bookmarks.list(w.profileId),
  toggleBookmark: (w, url, title, fav) => { const on = bookmarks.toggle(w.profileId, url, title, fav); broadcast(w.profileId, 'command', { cmd: 'bookmark-changed' }); return on; },
  removeBookmark: (w, id) => bookmarks.remove(w.profileId, id),
  renameBookmark: (w, id: string, title: string) => bookmarks.rename(w.profileId, String(id), String(title ?? '').slice(0, 500)),
  isBookmarked: (w, url) => bookmarks.has(w.profileId, url),
  history: (w, q = '', offset = 0, limit = 200) => history.list(w.profileId, Number.isFinite(offset) ? Math.max(0, offset | 0) : 0, Number.isFinite(limit) ? Math.min(5000, Math.max(1, limit | 0)) : 200, typeof q === 'string' ? q : ''),
  removeHistory: (w, url) => history.remove(w.profileId, url),
  clearHistory: (w) => history.clear(w.profileId),
  downloads: (w) => downloadStore(w.profileId, w.incognito).get(),
  openDownload: (w, id) => {
    const d = downloadStore(w.profileId, w.incognito).get().find((x) => x.id === id);
    // never open a file still waiting for approval in quarantine, or one that did not finish
    if (!d || d.state !== 'completed' || agentDownloads.isQuarantined(d.path)) return false;
    return shell.openPath(d.path).then((err) => !err);
  },
  showDownload: (w, id) => { const d = downloadStore(w.profileId, w.incognito).get().find((x) => x.id === id); if (d) shell.showItemInFolder(d.path); },
  cancelDownload: (w, id) => { if (downloadStore(w.profileId, w.incognito).get().some((x) => x.id === id)) downloads.get(id)?.cancel(); },
  clearDownloads: (w) => downloadStore(w.profileId, w.incognito).update((l) => l.filter((d) => d.state === 'progressing')),
  clearBrowsingData: async (w, o: any = {}) => {
    const ses = sessionFor(w.profileId, w.incognito);
    if (o.cache) await ses.clearCache();
    if (o.cookies) await ses.clearStorageData();
    if (o.history) history.clear(w.profileId);
    return true;
  },

  // ---- site settings (per origin): permissions the user decided, remembered zoom, stored data
  siteSettings: (w) => {
    const perms: Record<string, boolean> = (dataFor(w.profileId).session.get() as any).perms || {};
    const zoom = w.incognito ? {} : sitePrefs.zoomAll(w.profileId);
    const sites = new Map<string, { site: string; origins: string[]; perms: Record<string, boolean>; zoom?: number }>();
    const get = (host: string) => { let x = sites.get(host); if (!x) sites.set(host, (x = { site: host, origins: [], perms: {} })); return x; };
    for (const [k, v] of Object.entries(perms)) {
      const i = k.lastIndexOf('|'); if (i < 0) continue;
      const origin = k.slice(0, i), perm = k.slice(i + 1);
      let host = ''; try { host = new URL(origin).hostname.replace(/^www\./, ''); } catch { continue; }
      const x = get(host); x.perms[perm] = !!v; if (!x.origins.includes(origin)) x.origins.push(origin);
    }
    for (const [host, z] of Object.entries(zoom)) get(host).zoom = z;
    return [...sites.values()].sort((a, b) => a.site.localeCompare(b.site));
  },
  setSitePermission: (w, origin: string, permission: string, value: boolean | null) => {
    if (w.incognito || typeof origin !== 'string' || typeof permission !== 'string' || !/^[a-z-]{2,40}$/.test(permission)) return false;
    let o = ''; try { const u = new URL(origin); if (u.protocol !== 'https:' && u.protocol !== 'http:') return false; o = u.origin; } catch { return false; }
    const store = dataFor(w.profileId).session as any;
    const cur = store.get();
    cur.perms ||= {};
    if (value === null || value === undefined) delete cur.perms[o + '|' + permission]; else cur.perms[o + '|' + permission] = value === true;
    store.set(cur);
    return true;
  },
  /** forget everything about a site: decided permissions, zoom, cookies/storage/cache for its origins */
  resetSite: async (w, site: string) => {
    if (typeof site !== 'string' || !/^[a-z0-9.-]{1,253}$/i.test(site)) return false;
    const host = site.toLowerCase().replace(/^www\./, '');
    const matches = (origin: string) => { try { return new URL(origin).hostname.replace(/^www\./, '') === host; } catch { return false; } };
    const store = dataFor(w.profileId).session as any;
    if (!w.incognito) {
      const cur = store.get();
      for (const k of Object.keys(cur.perms || {})) if (matches(k.slice(0, k.lastIndexOf('|')))) delete cur.perms[k];
      store.set(cur);
      sitePrefs.clearZoom(w.profileId, host);
    }
    const ses = sessionFor(w.profileId, w.incognito);
    const origins = [`https://${host}`, `https://www.${host}`, `http://${host}`, `http://www.${host}`];
    try { await ses.clearData({ origins, dataTypes: ['cache', 'cookies', 'localStorage', 'indexedDB', 'serviceWorkers', 'fileSystems', 'webSQL', 'backgroundFetch'] }); }
    catch { for (const origin of origins) { try { await ses.clearStorageData({ origin }); } catch { /* not stored */ } } }
    for (const t of w.tabs) if (t.wc && zoomKeyOf(t.wc.getURL()) === host) { t.zoom = 1; t.wc.setZoomFactor(1); }
    w.pushState();
    return true;
  },

  passwords: (w) => passwords.list(w.profileId),
  removePassword: (w, id) => passwords.remove(w.profileId, id),
  savePassword: (_w, id: string, ok: boolean) => { const p = pendingPasswords.get(id); pendingPasswords.delete(id); if (p && ok) passwords.save(p.profileId, p.origin, p.username, p.password); },
  revealPassword: async (w, id) => {
    const r = await dialog.showMessageBox(w.win, { type: 'warning', buttons: ['Show password', 'Cancel'], defaultId: 1, message: 'Show this saved password?' });
    return r.response === 0 ? passwords.get(w.profileId, id)?.password ?? null : null;
  },

  settings: () => settings.get(),
  patchSettings: (_w, p) => {
    const before = settings.get();
    const s = settings.patch(p);
    if (p.adblock !== undefined && p.adblock !== before.adblock) for (const key of preparedSessions) { const [pid, inc] = key.split(':'); const ses = sessionFor(pid, inc === 'inc'); (p.adblock ? enableAdblock(ses) : disableAdblock(ses)).catch(() => {}); }
    if (p.theme) { nativeTheme.themeSource = p.theme; windows.forEach((w) => w.updateTitleBar()); }
    broadcast(null, 'settings', s);
    return s;
  },
  providers: () => providers.list(),
  providerPresets: () => PROVIDER_PRESETS,
  upsertProvider: (_w, p) => providers.upsert(p),
  removeProvider: (_w, id) => providers.remove(id),
  discoverModels: (_w, id) => providers.discover(id),
  testModel: async (_w, ref) => {
    const t0 = Date.now();
    try { const r = await chat({ model: ref, messages: [{ role: 'user', content: 'Reply with exactly: OWL ready' }], maxTokens: 20 }); return { ok: true, text: r.content.trim(), ms: Date.now() - t0 }; }
    catch (e: any) { return { ok: false, error: e.message, ms: Date.now() - t0 }; }
  },
  setDefaultBrowser: () => {
    app.setAsDefaultProtocolClient('http'); app.setAsDefaultProtocolClient('https');
    if (process.platform === 'win32') shell.openExternal('ms-settings:defaultapps?registeredAppUser=OWL');
    return app.isDefaultProtocolClient('https');
  },
  isDefaultBrowser: () => app.isDefaultProtocolClient('https'),
  memoryStats: async (w) => {
    const metrics = app.getAppMetrics();
    const byPid = new Map(metrics.map((m) => [m.pid, m]));
    const tabs = w.tabs.filter((t) => !t.internal).map((t) => {
      const pid = t.wc?.getOSProcessId();
      const m = pid ? byPid.get(pid) : undefined;
      return { id: t.id, title: t.title, mb: m ? Math.round((m.memory.workingSetSize || 0) / 1024) : 0, sleeping: t.sleeping };
    });
    const totalMB = Math.round(metrics.reduce((a, m) => a + (m.memory.workingSetSize || 0), 0) / 1024);
    return { totalMB, tabs };
  },
  appInfo: () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, userData: app.getPath('userData'), computerUse: computer.available(), secrets: (() => { const s = secrets.status(); return { encrypted: s.encrypted, backend: s.backend }; })() }),

  importSources: () => detectSources(),
  importFrom: async (w, src, what) => {
    const known = (await detectSources()).find((s) => s.path === src?.path);
    if (!known) throw new Error('Unknown browser profile');
    const r = await importFrom(known, w.profileId, what || {}, (msg) => w.send('toast', { title: 'Importing…', body: msg }));
    if (what?.extensions) loadInstalledExtensions(sessionFor(w.profileId), w.profileId).catch(() => {});
    return r;
  },
  importPasswordsCsv: async (w) => {
    const r = await dialog.showOpenDialog(w.win, { filters: [{ name: 'Passwords CSV', extensions: ['csv'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return 0;
    return importPasswordsCsv(fs.readFileSync(r.filePaths[0], 'utf8'), w.profileId);
  },

  extensions: (w) => {
    const ses: any = sessionFor(w.profileId);
    const list = (ses.extensions?.getAllExtensions?.() ?? ses.getAllExtensions?.() ?? []) as Electron.Extension[];
    return list.map((e) => ({ id: e.id, name: e.name, version: e.version, path: e.path }));
  },
  loadExtension: async (w) => {
    const r = await dialog.showOpenDialog(w.win, { properties: ['openDirectory'], title: 'Select an unpacked extension folder' });
    if (r.canceled || !r.filePaths[0]) return null;
    const ses: any = sessionFor(w.profileId);
    const dest = path.join(app.getPath('userData'), 'extensions', w.profileId, path.basename(r.filePaths[0]));
    fs.cpSync(r.filePaths[0], dest, { recursive: true });
    const e = await (ses.extensions?.loadExtension ? ses.extensions.loadExtension(dest, { allowFileAccess: false }) : ses.loadExtension(dest, { allowFileAccess: false }));
    return { id: e.id, name: e.name, version: e.version };
  },
  removeExtension: (w, id) => {
    const ses: any = sessionFor(w.profileId);
    const e = (ses.extensions?.getExtension ?? ses.getExtension).call(ses.extensions ?? ses, id);
    (ses.extensions?.removeExtension ?? ses.removeExtension).call(ses.extensions ?? ses, id);
    if (e?.path?.startsWith(app.getPath('userData'))) fs.rmSync(e.path, { recursive: true, force: true });
  },
  openWebStore: (w) => { w.newTab('https://chromewebstore.google.com/'); },

  companions: (w) => companions.list(w.profileId),
  saveCompanion: (w, c) => companions.save(w.profileId, c),
  removeCompanion: (w, id) => companions.remove(w.profileId, id),
  runs: (w) => runtime.list(w.profileId, w.incognito),
  startRun: (w, companionId, task, opts: any = {}) => {
    const tabId = opts.useCurrentTab && w.active && !w.active.internal ? w.active.id : null;
    if (tabId != null) { const t = w.active!; t.agentId = companionId; w.pushState(); }
    const r = runtime.start(w.profileId, companionId, task, { background: opts.background ?? !tabId, tabId, incognito: w.incognito });
    if (tabId != null) w.active!.agentRunId = r.id;
    return r;
  },
  stopRun: (_w, id) => runtime.stop(id),
  followUp: (_w, id, text) => runtime.followUp(id, text),
  answerRun: (_w, id, text) => runtime.answer(id, text),
  approveRun: (_w, id, ok) => runtime.approve(id, ok),
  takeover: (_w, id, on) => runtime.setTakeover(id, on),
  chat: async (w, companionId: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>, opts: any = {}) => {
    let page = null;
    if (opts.withPage && w.active?.wc) { try { page = await w.active.wc.executeJavaScript(READ_SCRIPT, true); } catch {} }
    return companionChat(w.profileId, companionId, messages, { page, remember: !w.incognito, onToken: (tok) => w.send('chat-token', { threadId: opts.threadId, token: tok }) });
  },

  memory: (w) => memory.list(w.profileId),
  addMemory: (w, text, kind) => memory.add(w.profileId, text, kind || 'fact', 'user'),
  updateMemory: (w, id, patch) => memory.update(w.profileId, id, patch),
  removeMemory: (w, id) => memory.remove(w.profileId, id),
  clearMemory: (w) => memory.clear(w.profileId),
  searchMemory: (w, q) => memory.search(w.profileId, q, 20),
  memoryProfile: (w) => { try { const p = memory.profile(w.profileId); return p && (p.static.length || p.dynamic.length) ? p : null; } catch { return null; } },
  refreshMemoryProfile: async (w) => { try { return await memory.refreshProfile(w.profileId); } catch { return null; } },
  chats: (w) => (w.incognito ? [] : threads.list(w.profileId)),
  saveChat: (w, t) => (w.incognito ? 0 : threads.save(w.profileId, t)),
  removeChat: (w, id: string) => threads.remove(w.profileId, String(id)),
  skills: (w) => ({ mine: skills.mine(w.profileId), official: skills.official() }),
  saveSkill: (w, s) => skills.save(w.profileId, s),
  removeSkill: (w, id) => skills.remove(w.profileId, id),
  routines: (w) => scheduler.list(w.profileId),
  saveRoutine: (w, r) => scheduler.save(w.profileId, r),
  removeRoutine: (w, id) => scheduler.remove(w.profileId, id),
  runRoutine: (w, id) => scheduler.runNow(w.profileId, id),
  apps: (w) => mcp.list(w.profileId),
  appCatalog: () => APP_CATALOG,
  saveApp: (w, cfg) => mcp.upsert(w.profileId, cfg),
  removeApp: (w, id) => mcp.remove(w.profileId, id),
  connectApp: (w, id) => mcp.connect(w.profileId, id),
  disconnectApp: (w, id) => mcp.disconnect(w.profileId, String(id)),
  artifacts: (w) => dataFor(w.profileId).artifacts.get().map((a) => ({ ...a, html: a.html.slice(0, 4000) })),
  artifact: (w, id) => dataFor(w.profileId).artifacts.get().find((a) => a.id === id) || null,
  artifactUrl: (_w, id: string) => artifactUrl(String(id)),
  removeArtifact: (w, id) => dataFor(w.profileId).artifacts.update((l) => l.filter((a) => a.id !== id)),
  openArtifact: (w, id) => { w.newTab('owl://artifact', { artifactId: id }); },
  exportArtifact: async (w, id) => {
    const a: Artifact | undefined = dataFor(w.profileId).artifacts.get().find((x) => x.id === id);
    if (!a) return false;
    const r = await dialog.showSaveDialog(w.win, { defaultPath: a.title.replace(/[\\/:*?"<>|]/g, '_') + '.html' });
    if (r.filePath) fs.writeFileSync(r.filePath, a.html);
    return !!r.filePath;
  },

  getUpdateStatus: () => updater.get(),
  checkForUpdates: () => updater.check(),
  installUpdate: (w) => {
    if (updater.install()) return true;
    const st = updater.get();
    // portable build: no in-place install, open the release page instead
    if (st.reason === 'portable' && st.version && st.version !== st.currentVersion) { w.newTab(st.downloadUrl); return false; }
    return false;
  },

  onboarding: () => ({ done: appState.get().onboardingDone, userName: appState.get().userName, companionId: appState.get().companionId }),
  completeOnboarding: (w, o: any = {}) => {
    appState.update((s) => { s.onboardingDone = true; s.userName = o.userName; s.companionId = o.companionId; });
    if (o.companionId) companions.save(w.profileId, { id: o.companionId, hired: true, ...(o.companionName ? { name: o.companionName } : {}), ...(o.look ? { look: o.look } : {}) });
    if (o.userName) memory.add(w.profileId, `The user's name is ${o.userName}.`, 'fact', 'onboarding', { isStatic: true } as any);
    if (o.defaultModel && typeof o.defaultModel.providerId === 'string' && typeof o.defaultModel.model === 'string') {
      const s = settings.patch({ defaultModel: { providerId: o.defaultModel.providerId, model: o.defaultModel.model } });
      broadcast(null, 'settings', s);
    }
    return true;
  },
};

function hostOfUrl(u: string) { try { return new URL(u).hostname; } catch { return u; } }

function suggest(w: OwlWindow, text: string, allowInline = false) {
  const q = typeof text === 'string' ? text.trim() : '';
  const out: Suggestion[] = [];
  if (!q) return out;
  const ql = q.toLowerCase();
  const hist = w.incognito ? [] : history.search(w.profileId, q, 8);
  // inline autocomplete ("wik" → wikipedia.org) from this profile's history (never in incognito)
  const inline = w.incognito || !allowInline ? null : inlineCompletion(q, history.search(w.profileId, q, 40));
  const asUrl = normalizeInput(inline ? inline : q);
  if (!asUrl.startsWith(searchUrl(''))) out.push({ type: 'url', title: asUrl, url: asUrl, ...(inline ? { inline } : {}) });
  for (const t of w.tabs) if (!t.internal && (t.title.toLowerCase().includes(ql) || (t.wc?.getURL() || '').toLowerCase().includes(ql))) out.push({ type: 'tab', title: t.title, url: String(t.id), favicon: t.favicon });
  for (const b of bookmarks.list(w.profileId)) if ((b.title + ' ' + b.url).toLowerCase().includes(ql)) out.push({ type: 'bookmark', title: b.title, url: b.url, favicon: b.favicon });
  for (const h of hist) out.push({ type: 'history', title: h.title || h.url, url: h.url, favicon: h.favicon });
  out.splice(1, 0, { type: 'search', title: q, url: searchUrl(q) });
  // a typed URL that is also a bookmark/history row shows once (as the richer row); tab/search rows stay
  const typed = out[0]?.type === 'url' ? urlKey(out[0].url) : null;
  const rows = typed && out.slice(1).some((x) => (x.type === 'bookmark' || x.type === 'history') && urlKey(x.url) === typed) && !inline ? out.slice(1) : out;
  const list = dedupeSuggestions(rows).slice(0, 9);
  // rows without a favicon borrow one this profile already saw for the same site
  if (!w.incognito && list.some((x) => !x.favicon && x.type !== 'search' && x.type !== 'tab')) {
    const byHost = new Map<string, string>();
    for (const b of bookmarks.list(w.profileId)) if (b.favicon) byHost.set(hostOfUrl(b.url).replace(/^www\./, ''), b.favicon);
    for (const h of history.search(w.profileId, '', 400)) if (h.favicon && !byHost.has(hostOfUrl(h.url).replace(/^www\./, ''))) byHost.set(hostOfUrl(h.url).replace(/^www\./, ''), h.favicon);
    for (const x of list) if (!x.favicon && x.type !== 'search' && x.type !== 'tab') { const f = byHost.get(hostOfUrl(x.url).replace(/^www\./, '')); if (f) x.favicon = f; }
  }
  return list;
}

for (const [name, fn] of Object.entries(api)) {
  ipcMain.handle('owl:' + name, async (e, ...args) => {
    const w = windowFor(e);
    if (!w) { console.warn(`[ipc] blocked owl:${name} from untrusted sender ${e.senderFrame?.url?.slice(0, 80) ?? '?'}`); throw new Error('Forbidden'); }
    try { return await fn(w, ...args); }
    catch (err: any) { console.error(`[ipc] ${name}`, err); throw new Error(err?.message || String(err)); }
  });
}

// credentials for autofill — origin taken from the requesting frame, never trusted from the page
ipcMain.handle('owl-web:credentials', (e) => {
  const frame = e.senderFrame;
  if (!frame || frame.parent) return null; // never into iframes (a third-party frame must not receive the top site's password)
  let origin = '';
  try {
    const u = new URL(frame.url);
    // https, or http on this machine (dev servers); never autofill over plain http on the network
    if (!(u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) return null;
    origin = u.origin;
  } catch { return null; }
  const w = [...windows].find((x) => x.tabs.some((t) => t.wc === e.sender));
  if (!w || w.incognito) return null;
  const list = passwords.findForOrigin(w.profileId, origin);
  if (list.length !== 1) return null;
  return passwords.get(w.profileId, list[0].id);
});

// ---------- lifecycle ----------
app.whenReady().then(async () => {
  if (!gotLock) return;
  logLine('info', `starting OWL ${app.getVersion()} (electron ${process.versions.electron}, ${process.platform}) packaged=${app.isPackaged}`);
  try { profiles.purgePending(); } catch (e) { logLine('warn', 'profiles.purgePending', e); }
  try { secrets.migrate(); } catch (e) { logLine('warn', 'secrets.migrate', e); }
  try { nativeTheme.themeSource = settings.get().theme; } catch (e) { logLine('warn', 'themeSource', e); }
  try {
    // first launch from a file association / "Open with" gets the file too, not just http(s) links
    const urlArg = launchArg(process.argv.slice(1));
    createWindow(profiles.lastUsed(), false, urlArg ? [fileToUrl(urlArg)] : undefined);
  } catch (e) {
    // Without a window the process would live on invisibly (and block the installer). Fail loudly instead.
    return fatal('creating the first window', e);
  }
  markStartupDone();
  try { installScrollRestore((wc) => { for (const w of windows) for (const t of w.tabs) if (t.wc === wc) return t; return null; }); } catch (e) { logLine('warn', 'scroll restore', e); }
  try {
    updater.start({
      onStatus: (st) => broadcast(null, 'update', st),
      onReady: (st) => {
        toast(null, `OWL ${st.version} is ready`, 'Restart OWL to update (Settings → About), or it installs when you quit.', 'success');
        if (Notification.isSupported()) {
          const n = new Notification({ title: `OWL ${st.version} is ready`, body: 'Click to restart and update.', silent: true });
          n.on('click', () => updater.install());
          n.show();
        }
      },
    });
  } catch (e) { logLine('warn', 'updater.start', e); }
  try { scheduler.start(); } catch (e) { logLine('error', 'scheduler.start', e); }
  providers.autodetectLocal().catch(() => {});
  if (isDev) console.log('[owl] dev mode');
}).catch((e) => fatal('app ready', e));

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!windows.size) createWindow(profiles.lastUsed()); });
let quitting = false;
app.on('before-quit', () => {
  if (!gotLock || quitting) return;
  quitting = true;
  // each step isolated: one failing flush must not stop the rest (or the child-process cleanup)
  const step = (name: string, fn: () => unknown) => { try { const r: any = fn(); if (r && typeof r.catch === 'function') r.catch((e: any) => logLine('warn', `quit:${name}`, e)); } catch (e) { logLine('warn', `quit:${name}`, e); } };
  step('session', () => { for (const p of profiles.list()) saveSession(p.id); });
  step('data', () => flushAll());
  step('memory', () => flushMemory());
  step('threads', () => threads.flush());
  step('settings', () => settings.flush());
  step('secrets', () => secrets.flush());
  step('site-prefs', () => sitePrefs.flush());
  step('app', () => appState.flush());
  step('scheduler', () => scheduler.stop());
  step('updater', () => updater.stop());
  step('mcp', () => mcp.disconnectAll());
  step('computer', () => computer.dispose());
  // Watchdog: whatever happens (a hung renderer refusing to close, a stuck child), the process
  // must not outlive the quit request, or the installer finds OWL.exe still running.
  setTimeout(() => { logLine('warn', 'quit watchdog fired; forcing exit'); app.exit(0); }, 6000).unref();
});
export { webContents, net, protocol, htmlToText };
/** tests only (tests/main): the agent browser host for a profile / incognito */
export { hostFor as __hostForTests };
