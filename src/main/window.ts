import { BrowserWindow, WebContentsView, WebContents, nativeTheme, app, Menu, clipboard, shell, screen } from 'electron';
import * as path from 'path';
import { sessionFor } from './profiles';
import { settings } from './settings';
import { history, bookmarks } from './data';
import type { TabState, WindowState } from '../shared/types';

export type InternalPage = NonNullable<TabState['internal']>;

let nextTabId = 1;

export class Tab {
  id = nextTabId++;
  view: WebContentsView | null = null;
  url: string;
  title = 'New Tab';
  favicon?: string;
  loading = false;
  pinned = false;
  muted = false;
  zoom = 1;
  lastActive = Date.now();
  agentId?: string;
  agentRunId?: string;
  internal?: InternalPage;
  artifactId?: string;
  groupColor?: string;
  /** tabs created by agents in the background are hidden from the strip until opened */
  hidden = false;

  constructor(public win: OwlWindow, url: string, opts: { internal?: InternalPage; agentId?: string; runId?: string; artifactId?: string } = {}) {
    this.url = url;
    this.internal = opts.internal;
    this.agentId = opts.agentId;
    this.agentRunId = opts.runId;
    this.artifactId = opts.artifactId;
    if (opts.internal) this.title = titleForInternal(opts.internal);
  }

  get wc(): WebContents | null { return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null; }
  get sleeping() { return !this.internal && !this.view; }

  /** create the renderer process for this tab (wake) */
  wake() {
    if (this.internal || this.view) return;
    const ses = sessionFor(this.win.profileId, this.win.incognito);
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        preload: path.join(__dirname, '..', 'preload', 'web.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true,
        backgroundThrottling: !this.agentId,
        safeDialogs: true,
        autoplayPolicy: 'document-user-activation-required',
      },
    });
    view.setBackgroundColor('#ffffff');
    view.setBorderRadius?.(10);
    this.view = view;
    this.win.wireWebContents(this, view.webContents);
    if (this.zoom !== 1) view.webContents.setZoomFactor(this.zoom);
    view.webContents.setAudioMuted(this.muted);
    if (this.url && this.url !== 'about:blank') view.webContents.loadURL(this.url).catch(() => {});
  }

  /** free the renderer process; keeps url/title so it can be restored instantly */
  sleep() {
    if (!this.view || this.agentId) return;
    const wc = this.view.webContents;
    this.url = wc.getURL() || this.url;
    try { this.win.win.contentView.removeChildView(this.view); } catch {}
    try { wc.close({ waitForBeforeUnload: false }); } catch {}
    this.view = null;
    this.loading = false;
  }

  destroy() {
    if (this.view) {
      try { this.win.win.contentView.removeChildView(this.view); } catch {}
      try { this.view.webContents.close(); } catch {}
      this.view = null;
    }
  }

  state(): TabState {
    const wc = this.wc;
    return {
      id: this.id,
      url: this.internal ? `owl://${this.internal}` : (wc?.getURL() || this.url),
      title: this.title,
      favicon: this.favicon,
      loading: this.loading,
      canGoBack: !!wc?.navigationHistory.canGoBack(),
      canGoForward: !!wc?.navigationHistory.canGoForward(),
      pinned: this.pinned,
      muted: this.muted,
      audible: !!wc?.isCurrentlyAudible(),
      sleeping: this.sleeping,
      zoom: this.zoom,
      agentId: this.agentId,
      agentRunId: this.agentRunId,
      internal: this.internal,
      artifactId: this.artifactId,
      groupColor: this.groupColor,
    };
  }
}

function titleForInternal(p: InternalPage) {
  return ({ newtab: 'New Tab', settings: 'Settings', companions: 'Companions', history: 'History', downloads: 'Downloads', bookmarks: 'Bookmarks', memory: 'Memory', routines: 'Routines', artifact: 'Artifact', skills: 'Skills', apps: 'Apps', library: 'Library', chats: 'Chats', agents: 'Agents' } as Record<string, string>)[p] || 'OWL';
}

export type Bounds = { x: number; y: number; width: number; height: number };

export interface WindowHooks {
  onState(w: OwlWindow): void;
  onClosed(w: OwlWindow): void;
  onCommand(w: OwlWindow, cmd: string, arg?: any): void;
  onPasswordSubmit(w: OwlWindow, tab: Tab, data: { origin: string; username: string; password: string }): void;
  onNewWindowRequest(w: OwlWindow, url: string, disposition: string): void;
}

export class OwlWindow {
  win: BrowserWindow;
  tabs: Tab[] = [];
  activeId: number | null = null;
  splitId: number | null = null;
  bounds: Bounds = { x: 0, y: 0, width: 800, height: 600 };
  splitBounds: Bounds | null = null;
  overlay = false;
  private stateTimer: NodeJS.Timeout | null = null;

  constructor(public profileId: string, public incognito: boolean, private hooks: WindowHooks, initial?: { bounds?: Electron.Rectangle }) {
    const dark = nativeTheme.shouldUseDarkColors;
    const work = screen.getPrimaryDisplay().workAreaSize;
    this.win = new BrowserWindow({
      width: initial?.bounds?.width ?? Math.min(1440, Math.round(work.width * 0.86)),
      height: initial?.bounds?.height ?? Math.min(920, Math.round(work.height * 0.88)),
      x: initial?.bounds?.x, y: initial?.bounds?.y,
      minWidth: 520, minHeight: 400,
      show: false,
      frame: process.platform === 'darwin',
      titleBarStyle: 'hidden',
      titleBarOverlay: process.platform === 'win32' ? { color: '#00000000', symbolColor: dark ? '#e8e6ef' : '#26232f', height: 38 } : undefined,
      trafficLightPosition: { x: 14, y: 13 },
      backgroundColor: dark ? '#141317' : '#f4f3f7',
      backgroundMaterial: process.platform === 'win32' ? 'mica' : undefined,
      vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
      icon: path.join(__dirname, '..', 'renderer', 'art', 'owl-icon.png'),
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'ui.js'),
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { query: { profile: profileId, incognito: incognito ? '1' : '0' } });
    this.win.once('ready-to-show', () => this.win.show());
    this.win.on('closed', () => { this.tabs.forEach((t) => t.destroy()); this.hooks.onClosed(this); });
    this.win.on('focus', () => this.pushState());
    nativeTheme.on('updated', () => this.updateTitleBar());
    this.win.webContents.on('before-input-event', (e, input) => this.handleShortcut(e, input));
  }

  get id() { return this.win.id; }
  get active(): Tab | null { return this.tabs.find((t) => t.id === this.activeId) ?? null; }
  tab(id: number) { return this.tabs.find((t) => t.id === id) ?? null; }

  updateTitleBar() {
    if (process.platform !== 'win32' || this.win.isDestroyed()) return;
    const s = settings.get().theme;
    const dark = s === 'dark' || (s === 'system' && nativeTheme.shouldUseDarkColors);
    try { this.win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#e8e6ef' : '#26232f', height: 38 }); } catch {}
  }

  send(type: string, payload?: any) {
    if (!this.win.isDestroyed()) this.win.webContents.send('owl:event', type, payload);
  }

  pushState() {
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      if (this.win.isDestroyed()) return;
      this.send('state', this.state());
      this.hooks.onState(this);
    }, 16);
  }

  state(): WindowState {
    return {
      windowId: this.id,
      profileId: this.profileId,
      incognito: this.incognito,
      tabs: this.tabs.filter((t) => !t.hidden).map((t) => t.state()),
      activeTabId: this.activeId,
      splitTabId: this.splitId,
    };
  }

  newTab(url = 'owl://newtab', opts: { background?: boolean; index?: number; agentId?: string; runId?: string; hidden?: boolean; artifactId?: string; openerId?: number } = {}): Tab {
    const internal = parseInternal(url);
    const t = new Tab(this, internal ? 'about:blank' : url, { internal, agentId: opts.agentId, runId: opts.runId, artifactId: opts.artifactId });
    t.hidden = !!opts.hidden;
    let index = opts.index ?? this.tabs.length;
    if (opts.openerId != null && opts.index == null) {
      const oi = this.tabs.findIndex((x) => x.id === opts.openerId);
      if (oi >= 0) index = oi + 1;
    }
    this.tabs.splice(index, 0, t);
    if (!internal) t.wake();
    if (!opts.background) this.activate(t.id);
    else this.layout();
    this.pushState();
    return t;
  }

  activate(id: number) {
    const t = this.tab(id);
    if (!t) return;
    t.hidden = false;
    this.activeId = id;
    t.lastActive = Date.now();
    if (t.sleeping) t.wake();
    if (this.splitId === id) this.splitId = null;
    this.layout();
    this.pushState();
    if (t.wc && !this.overlay) t.wc.focus();
  }

  close(id: number) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const t = this.tabs[i];
    if (!t.internal && t.url !== 'about:blank') this.hooks.onCommand(this, '__closed', t.wc?.getURL() || t.url);
    t.destroy();
    this.tabs.splice(i, 1);
    if (this.splitId === id) this.splitId = null;
    if (this.activeId === id) {
      const visible = this.tabs.filter((x) => !x.hidden);
      const next = visible[Math.min(i, visible.length - 1)] ?? visible[visible.length - 1];
      if (next) this.activate(next.id);
      else { this.activeId = null; if (!this.tabs.some((x) => !x.hidden)) { this.win.close(); return; } }
    }
    this.layout();
    this.pushState();
  }

  move(id: number, toIndex: number) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const [t] = this.tabs.splice(i, 1);
    this.tabs.splice(Math.max(0, Math.min(toIndex, this.tabs.length)), 0, t);
    this.pushState();
  }

  setSplit(id: number | null) {
    this.splitId = id && id !== this.activeId ? id : null;
    const t = this.splitId ? this.tab(this.splitId) : null;
    if (t?.sleeping) t.wake();
    this.layout();
    this.pushState();
  }

  setBounds(b: Bounds, split?: Bounds | null) {
    this.bounds = b;
    this.splitBounds = split ?? null;
    this.layout();
  }

  setOverlay(on: boolean) {
    this.overlay = on;
    this.layout();
  }

  /** attach the visible views; agent tabs stay attached underneath so they keep rendering */
  layout() {
    if (this.win.isDestroyed()) return;
    const cv = this.win.contentView;
    const active = this.active;
    const split = this.splitId ? this.tab(this.splitId) : null;
    const want: Tab[] = [];
    // background agent tabs first (bottom of the stack)
    for (const t of this.tabs) if (t.view && t.agentId && t !== active && t !== split) want.push(t);
    if (split?.view) want.push(split);
    if (active?.view) want.push(active);
    const attached = new Set(cv.children);
    for (const t of this.tabs) {
      if (t.view && attached.has(t.view) && !want.includes(t)) { try { cv.removeChildView(t.view); } catch {} }
    }
    for (const t of want) {
      const v = t.view!;
      cv.addChildView(v); // re-adding moves it to the top
      let b = this.bounds;
      if (split && this.splitBounds) b = t === split ? this.splitBounds : this.bounds;
      v.setBounds(roundB(b));
      const show = !this.overlay && (t === active || t === split);
      v.setVisible(show || !!t.agentId);
      if (!show && t.agentId) v.setBounds(roundB(this.bounds)); // keep rendering size for agents
    }
    // when the overlay is up, hide even agent views so UI menus render on top
    if (this.overlay) for (const t of want) t.view!.setVisible(false);
  }

  wireWebContents(t: Tab, wc: WebContents) {
    const update = () => { this.pushState(); };
    wc.on('page-title-updated', (_e, title) => {
      t.title = title || t.title;
      if (!this.incognito) history.updateTitle(this.profileId, wc.getURL(), t.title, t.favicon);
      update();
    });
    wc.on('page-favicon-updated', (_e, favs) => { t.favicon = favs[0]; update(); });
    wc.on('did-start-loading', () => { t.loading = true; update(); });
    wc.on('did-stop-loading', () => { t.loading = false; t.url = wc.getURL(); update(); });
    wc.on('did-navigate', (_e, url) => {
      t.url = url; t.favicon = undefined;
      if (!this.incognito) history.add(this.profileId, url, wc.getTitle(), t.favicon);
      update();
    });
    wc.on('did-navigate-in-page', (_e, url, isMain) => { if (isMain) { t.url = url; if (!this.incognito) history.add(this.profileId, url, wc.getTitle()); update(); } });
    wc.on('audio-state-changed', update);
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (!isMain || code === -3) return;
      wc.executeJavaScript(`document.documentElement.innerHTML = ${JSON.stringify(errorPage(desc, url))}`).catch(() => {});
    });
    wc.on('found-in-page', (_e, r) => this.send('find-result', { tabId: t.id, active: r.activeMatchOrdinal, total: r.matches }));
    wc.on('zoom-changed', (_e, dir) => { this.zoomTab(t.id, dir === 'in' ? 0.1 : -0.1); });
    wc.on('enter-html-full-screen', () => { this.win.setFullScreen(true); this.send('fullscreen', true); });
    wc.on('leave-html-full-screen', () => { this.win.setFullScreen(false); this.send('fullscreen', false); });
    wc.on('before-input-event', (e, input) => this.handleShortcut(e, input));
    wc.on('context-menu', (_e, p) => this.contextMenu(t, p));
    wc.on('render-process-gone', () => { t.view = null; t.loading = false; update(); });
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (disposition === 'new-window' && /popup|width=/.test('')) return { action: 'allow' };
      this.hooks.onNewWindowRequest(this, url, disposition);
      if (disposition === 'foreground-tab' || disposition === 'background-tab' || disposition === 'new-window' || disposition === 'default') {
        this.newTab(url, { background: disposition === 'background-tab', openerId: t.id });
        return { action: 'deny' };
      }
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    });
    wc.ipc.on('owl-web:password', (_e, data) => this.hooks.onPasswordSubmit(this, t, data));
  }

  zoomTab(id: number, delta: number | 'reset') {
    const t = this.tab(id);
    if (!t?.wc) return;
    t.zoom = delta === 'reset' ? 1 : Math.max(0.25, Math.min(5, Math.round((t.zoom + delta) * 100) / 100));
    t.wc.setZoomFactor(t.zoom);
    this.pushState();
  }

  private contextMenu(t: Tab, p: Electron.ContextMenuParams) {
    const wc = t.wc!;
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (p.linkURL) {
      items.push(
        { label: 'Open link in new tab', click: () => this.newTab(p.linkURL, { background: true, openerId: t.id }) },
        { label: 'Open link in split view', click: () => { const n = this.newTab(p.linkURL, { background: true }); this.setSplit(n.id); } },
        { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) },
        { type: 'separator' },
      );
    }
    if (p.hasImageContents && p.srcURL) {
      items.push(
        { label: 'Open image in new tab', click: () => this.newTab(p.srcURL, { background: true }) },
        { label: 'Save image as…', click: () => wc.downloadURL(p.srcURL) },
        { label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) },
        { label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) },
        { type: 'separator' },
      );
    }
    if (p.selectionText) {
      const sel = p.selectionText.trim().slice(0, 2000);
      items.push(
        { label: 'Copy', role: 'copy' },
        { label: `Search for “${sel.slice(0, 24)}${sel.length > 24 ? '…' : ''}”`, click: () => this.newTab(searchUrl(sel), { openerId: t.id }) },
        { label: 'Ask companion about selection', click: () => this.hooks.onCommand(this, 'ask', `About this text from ${wc.getURL()}:\n"${sel}"\n\n`) },
        { type: 'separator' },
      );
    }
    if (p.isEditable) {
      items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' }, { type: 'separator' });
      for (const s of p.dictionarySuggestions.slice(0, 4)) items.unshift({ label: s, click: () => wc.replaceMisspelling(s) });
    }
    if (!p.linkURL && !p.selectionText && !p.isEditable) {
      items.push(
        { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: 'Reload', click: () => wc.reload() },
        { type: 'separator' },
        { label: 'Summarize this page', click: () => this.hooks.onCommand(this, 'ask', 'Summarize this page in a few bullet points.') },
        { label: 'Save page as…', click: () => this.hooks.onCommand(this, 'save-page') },
        { label: 'Print…', click: () => wc.print() },
        { label: 'View page source', click: () => this.newTab('view-source:' + wc.getURL(), { openerId: t.id }) },
        { type: 'separator' },
      );
    }
    items.push({ label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  handleShortcut(e: Electron.Event, input: Electron.Input) {
    if (input.type !== 'keyDown') return;
    const ctrl = process.platform === 'darwin' ? input.meta : input.control;
    const k = input.key.toLowerCase();
    let cmd: string | null = null; let arg: any;
    if (ctrl && !input.shift && k === 't') cmd = 'new-tab';
    else if (ctrl && input.shift && k === 't') cmd = 'reopen-tab';
    else if (ctrl && k === 'w') cmd = 'close-tab';
    else if (ctrl && input.shift && k === 'n') cmd = 'incognito';
    else if (ctrl && !input.shift && k === 'n') cmd = 'new-window';
    else if (ctrl && (k === 'l' || k === 'e') || (input.alt && k === 'd')) cmd = 'focus-omnibox';
    else if ((ctrl && k === 'r') || k === 'f5') cmd = input.shift ? 'hard-reload' : 'reload';
    else if (ctrl && k === 'f') cmd = 'find';
    else if (ctrl && k === 'd') cmd = 'bookmark';
    else if (ctrl && k === 'j') cmd = 'toggle-companion';
    else if (ctrl && k === 'k') cmd = 'palette';
    else if (ctrl && k === 'h') cmd = 'history';
    else if (ctrl && input.shift && k === 'b') cmd = 'toggle-bookmarks-bar';
    else if (ctrl && input.shift && k === 'o') cmd = 'bookmarks';
    else if (ctrl && input.shift && k === 'j' ) cmd = 'downloads';
    else if (ctrl && (k === '=' || k === '+')) cmd = 'zoom-in';
    else if (ctrl && k === '-') cmd = 'zoom-out';
    else if (ctrl && k === '0') cmd = 'zoom-reset';
    else if (ctrl && k === 'tab') cmd = input.shift ? 'prev-tab' : 'next-tab';
    else if (ctrl && /^[1-9]$/.test(k)) { cmd = 'goto-tab'; arg = Number(k); }
    else if (input.alt && k === 'arrowleft') cmd = 'back';
    else if (input.alt && k === 'arrowright') cmd = 'forward';
    else if (k === 'f12' || (ctrl && input.shift && k === 'i')) cmd = 'devtools';
    else if (ctrl && k === 'p') cmd = 'print';
    else if (ctrl && k === 's') cmd = 'save-page';
    else if (ctrl && k === 'u') cmd = 'view-source';
    else if (k === 'escape' && this.win.isFullScreen()) cmd = 'exit-fullscreen';
    else if (ctrl && input.shift && k === 's') cmd = 'toggle-split';
    else if (ctrl && k === '\\') cmd = 'toggle-sidebar';
    if (cmd) { e.preventDefault(); this.hooks.onCommand(this, cmd, arg); }
  }
}

function roundB(b: Bounds): Electron.Rectangle {
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(1, Math.round(b.width)), height: Math.max(1, Math.round(b.height)) };
}

export function parseInternal(url: string): InternalPage | undefined {
  const m = url.match(/^owl:\/\/([a-z]+)/);
  if (!m) return undefined;
  const p = m[1] as InternalPage;
  return ['newtab', 'settings', 'companions', 'history', 'downloads', 'bookmarks', 'memory', 'routines', 'artifact', 'skills', 'apps', 'library', 'chats', 'agents'].includes(p) ? p : 'newtab';
}

export function searchUrl(q: string) {
  const e = settings.get().searchEngine;
  const enc = encodeURIComponent(q);
  return ({
    google: `https://www.google.com/search?q=${enc}`,
    duckduckgo: `https://duckduckgo.com/?q=${enc}`,
    bing: `https://www.bing.com/search?q=${enc}`,
    brave: `https://search.brave.com/search?q=${enc}`,
    perplexity: `https://www.perplexity.ai/search?q=${enc}`,
    kagi: `https://kagi.com/search?q=${enc}`,
  } as Record<string, string>)[e] || `https://www.google.com/search?q=${enc}`;
}

export function normalizeInput(input: string): string {
  const s = input.trim();
  if (!s) return 'owl://newtab';
  if (/^(https?|file|owl|view-source|about|data|chrome-extension):/i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
  if (/^[^\s]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(s)) return 'https://' + s;
  return searchUrl(s);
}

function errorPage(desc: string, url: string) {
  const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
  return `<head><title>Can't reach this page</title><style>body{font:15px/1.5 "Segoe UI Variable Text","SF Pro Text",system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f6f5f9;color:#25222c}@media(prefers-color-scheme:dark){body{background:#151418;color:#e9e7ef}}div{max-width:460px;padding:24px}h1{font-size:22px;margin:0 0 8px}code{opacity:.6;font-size:12px}button{margin-top:16px;border:0;border-radius:999px;padding:9px 18px;background:#25222c;color:#fff;font:inherit;cursor:pointer}</style></head><body><div><h1>This page didn't load</h1><p>${esc(url)} couldn't be reached.</p><code>${esc(desc)}</code><br><button onclick="location.reload()">Try again</button></div></body>`;
}

export { app, shell, bookmarks };
