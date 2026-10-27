import { BrowserWindow, WebContentsView, WebContents, nativeTheme, app, Menu, clipboard, shell, screen, dialog } from 'electron';
import * as path from 'path';
import { sessionFor } from './profiles';
import { settings } from './settings';
import { history, bookmarks } from './data';
import { sitePrefs, zoomKey } from './site-prefs';
import { uiUrl, isTrustedUiFrame } from './ui-protocol';
import { logLine, crashLogPath } from './crash';
import type { TabState, WindowState, TabGroup, TabGroupColor } from '../shared/types';

export type InternalPage = NonNullable<TabState['internal']>;

let nextTabId = 1;

export class Tab {
  id = nextTabId++;
  view: WebContentsView | null = null;
  url: string;
  title = 'New Tab';
  favicon?: string;
  /** the site (zoomKey) whose remembered zoom this tab last applied */
  zoomSite?: string;
  loading = false;
  pinned = false;
  muted = false;
  zoom = 1;
  lastActive = Date.now();
  agentId?: string;
  agentRunId?: string;
  internal?: InternalPage;
  artifactId?: string;
  /** '#section' of an internal URL (owl://settings#models), kept so deep links survive state round-trips */
  hash?: string;
  groupId?: string;
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
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: true,
        backgroundThrottling: !this.agentId,
        safeDialogs: true,
        autoplayPolicy: 'document-user-activation-required',
        plugins: true, // Chromium's built-in PDF viewer; without it every PDF link turned into a download
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
      url: this.internal ? `owl://${this.internal}${this.hash || ''}` : (wc?.getURL() || this.url),
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
      groupId: this.groupId,
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
  /**
   * Popup layer: a transparent WebContentsView stacked above every page view. The UI asks it to draw
   * menus and the omnibox dropdown (owl.popupShow) so they stay live over web pages instead of
   * freezing the page under a screenshot. It loads the same UI bundle in `?popup=1` mode; it gets no
   * owl:* API (windowFor() only trusts the window's own UI webContents), only the owl-popup:* channel.
   */
  private popup: WebContentsView | null = null;
  private popupReady = false;
  private popupPending: PopupSpec | null = null;
  private popupId: number | null = null;
  private popupFocus = false;
  /** a non-modal bubble (permission prompt) parked in the layer: menus may cover it, it comes back when they close */
  private bubble: PopupSpec | null = null;

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
      backgroundColor: dark ? '#141317' : '#f4f3f2',
      backgroundMaterial: process.platform === 'win32' ? 'mica' : undefined,
      vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
      icon: path.join(__dirname, '..', 'renderer', 'art', 'owl-icon.png'),
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'ui.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    this.win.loadURL(uiUrl({ profile: profileId, incognito: incognito ? '1' : '0' })).catch(() => { /* reported by did-fail-load (watchUi) */ });
    this.lockDownUi(this.win.webContents);
    this.win.once('ready-to-show', () => this.reveal());
    // Never leave the window (and with it the whole process) invisible: if ready-to-show does not
    // arrive (UI failed to load, renderer crashed, GPU trouble), show the window anyway.
    const showTimer = setTimeout(() => { if (!this.win.isDestroyed() && !this.win.isVisible()) { logLine('warn', 'ready-to-show did not fire within 5s; showing window anyway'); this.reveal(); } }, 5000);
    this.win.once('show', () => clearTimeout(showTimer));
    this.win.once('closed', () => clearTimeout(showTimer));
    this.watchUi(this.win.webContents, { profile: profileId, incognito: incognito ? '1' : '0' });
    this.win.on('closed', () => { this.tabs.forEach((t) => t.destroy()); this.hooks.onClosed(this); });
    this.win.on('focus', () => this.pushState());
    const onTheme = () => this.updateTitleBar();
    nativeTheme.on('updated', onTheme);
    this.win.once('closed', () => nativeTheme.removeListener('updated', onTheme));
    this.win.webContents.on('before-input-event', (e, input) => this.handleShortcut(e, input));
    // F11 / window fullscreen hides the chrome like Chrome does (html fullscreen already sends this)
    this.win.on('enter-full-screen', () => this.send('fullscreen', true));
    this.win.on('leave-full-screen', () => this.send('fullscreen', false));
    this.wirePopupLayer();
  }

  // ---------- popup layer ----------
  private wirePopupLayer() {
    const ui = this.win.webContents;
    ui.ipc.on('owl-popup:show', (e, spec: PopupSpec) => { if (isTrustedUiFrame(e.senderFrame)) this.showPopup(spec); });
    ui.ipc.on('owl-popup:hide', (e, id?: number) => { if (isTrustedUiFrame(e.senderFrame)) this.hidePopup(typeof id === 'number' ? id : undefined); });
    const dismiss = () => { if (this.popupId != null && this.popupId !== this.bubble?.id) { const id = this.popupId; this.hidePopup(); this.send('popup-event', { id, type: 'dismiss' }); } };
    this.win.on('blur', dismiss);
    this.win.on('resize', dismiss);
    this.win.on('move', dismiss);
    this.win.on('closed', () => { this.popup = null; });
    // prewarm after the window is up so the first menu opens instantly (one small renderer)
    this.win.once('show', () => setTimeout(() => this.ensurePopup(), 2500));
  }

  private ensurePopup(): WebContentsView | null {
    if (this.popup || this.win.isDestroyed()) return this.popup;
    const v = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'ui.js'),
        contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
        allowRunningInsecureContent: false, webviewTag: false, spellcheck: false, backgroundThrottling: false,
      },
    });
    v.setBackgroundColor('#00000000');
    v.setVisible(false);
    const wc = v.webContents;
    this.lockDownUi(wc);
    wc.ipc.on('owl-popup:ready', (e) => {
      if (!isTrustedUiFrame(e.senderFrame)) return;
      this.popupReady = true;
      const p = this.popupPending; this.popupPending = null;
      if (p) this.showPopup(p);
    });
    wc.ipc.on('owl-popup:event', (e, evt: any) => {
      if (!isTrustedUiFrame(e.senderFrame) || !evt || typeof evt !== 'object' || evt.id !== this.popupId) return;
      const out = { id: evt.id, type: String(evt.type || ''), index: typeof evt.index === 'number' ? evt.index : undefined };
      if (out.type === 'select' || out.type === 'dismiss') this.hidePopup();
      this.send('popup-event', out);
    });
    wc.on('before-input-event', (e, input) => this.handleShortcut(e, input));
    wc.on('render-process-gone', () => {
      try { this.win.contentView.removeChildView(v); } catch {}
      if (this.popup === v) { this.popup = null; this.popupReady = false; }
      if (this.popupId != null) { const id = this.popupId; this.popupId = null; this.send('popup-event', { id, type: 'dismiss' }); }
      if (this.bubble) { const id = this.bubble.id; this.bubble = null; if (id !== this.popupId) this.send('popup-event', { id, type: 'dismiss' }); }
    });
    wc.loadURL(uiUrl({ profile: this.profileId, incognito: this.incognito ? '1' : '0', popup: '1' })).catch(() => {});
    this.win.contentView.addChildView(v);
    this.popup = v;
    return v;
  }

  private showPopup(spec: PopupSpec) {
    if (this.win.isDestroyed() || !spec || typeof spec !== 'object' || typeof spec.id !== 'number') return;
    const v = this.ensurePopup();
    if (!v) return;
    this.popupId = spec.id;
    if (spec.kind === 'bubble') this.bubble = spec;
    if (!this.popupReady) { this.popupPending = spec; return; }
    const [cw, ch] = this.win.getContentSize();
    const r = spec.rect;
    const b = r && [r.x, r.y, r.width, r.height].every((n) => typeof n === 'number' && isFinite(n))
      ? clampRect(r, cw, ch)
      : { x: 0, y: 0, width: cw, height: ch };
    v.setBounds(b); // size first, so the popup renderer measures the right viewport when it places a menu
    v.webContents.send('owl:event', 'popup', { ...spec, origin: { x: b.x, y: b.y } });
    this.win.contentView.addChildView(v); // top of the stack
    v.setVisible(true);
    this.popupFocus = !!spec.focus;
    if (spec.focus) v.webContents.focus();
  }

  hidePopup(id?: number) {
    if (id != null && id !== this.popupId) { if (id === this.bubble?.id) this.bubble = null; return; } // a newer popup replaced it
    if (this.popupId != null && this.popupId === this.bubble?.id) this.bubble = null;
    this.popupId = null;
    this.popupPending = null;
    const v = this.popup;
    if (!v || this.win.isDestroyed()) return;
    v.setVisible(false);
    v.webContents.send('owl:event', 'popup', null);
    if (this.popupFocus) { this.popupFocus = false; this.win.webContents.focus(); }
    // a menu that covered a parked bubble closed: show the bubble again
    if (this.bubble) { const b = this.bubble; setTimeout(() => { if (this.bubble === b && this.popupId == null) this.showPopup(b); }, 0); }
  }

  get id() { return this.win.id; }
  get active(): Tab | null { return this.tabs.find((t) => t.id === this.activeId) ?? null; }
  tab(id: number) { return this.tabs.find((t) => t.id === id) ?? null; }

  /**
   * The UI renderer holds the privileged window.owl bridge: it must never navigate away from the
   * owl-ui:// origin or spawn windows (which would inherit its preload). Links from companion
   * messages / artifacts open as normal browser tabs instead.
   */
  private lockDownUi(wc: WebContents) {
    const openAsTab = (url: string) => { if (/^(https?|mailto):/i.test(url) || url.startsWith('owl://')) this.newTab(url, { openerId: this.activeId ?? undefined }); };
    wc.setWindowOpenHandler(({ url }) => { openAsTab(url); return { action: 'deny' }; });
    // will-navigate / will-redirect fire for the main frame only (artifact iframes are sandboxed separately)
    wc.on('will-navigate', (e, url) => {
      if (url.startsWith('owl-ui://app/')) return;
      e.preventDefault();
      openAsTab(url);
    });
    wc.on('will-redirect', (e, url) => { if (e.isMainFrame && !url.startsWith('owl-ui://app/')) e.preventDefault(); });
    wc.on('will-attach-webview', (e) => e.preventDefault());
  }

  private reveal() {
    if (this.win.isDestroyed() || this.win.isVisible()) return;
    this.win.show();
  }

  /** The UI renderer failing must be visible and recoverable, never a silent hidden window. */
  private watchUi(wc: WebContents, query: Record<string, string>) {
    let failures = 0;
    const offer = async (what: string) => {
      this.reveal();
      if (this.win.isDestroyed()) return;
      const { response } = await dialog.showMessageBox(this.win, {
        type: 'error', title: 'OWL', buttons: ['Reload', 'Close window'], defaultId: 0, cancelId: 1,
        message: `OWL's interface ${what}.`,
        detail: `Details were written to ${crashLogPath() ?? 'the log'}.`,
      }).catch(() => ({ response: 1 }));
      if (this.win.isDestroyed()) return;
      if (response === 0 && failures < 5) wc.loadURL(uiUrl(query)).catch((e) => logLine('error', 'ui reload', e));
      else this.win.close();
    };
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (!isMain || code === -3) return; // -3 = aborted (a newer navigation replaced it)
      failures++;
      logLine('error', `UI failed to load ${url}: ${code} ${desc}`);
      void offer('failed to load');
    });
    wc.on('render-process-gone', (_e, d) => {
      if (d.reason === 'clean-exit') return;
      failures++;
      logLine('error', `UI renderer gone: ${d.reason} (${d.exitCode})`);
      void offer('stopped unexpectedly');
    });
    wc.on('preload-error', (_e, p, err) => logLine('error', `UI preload failed: ${p}`, err));
    wc.on('unresponsive', () => logLine('warn', 'UI renderer unresponsive'));
    wc.on('console-message', (e: any) => {
      // only errors, to keep the log useful (single-arg form: Electron 45 deprecates the positional args)
      if (e?.level === 'error') logLine('warn', `UI console: ${String(e.message).slice(0, 500)}`);
    });
  }

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
      groups: this.groups.filter((g) => this.tabs.some((t) => t.groupId === g.id && !t.hidden)).map((g) => ({ ...g })),
    };
  }

  // ---------- tab groups (Chrome-style; grouped tabs stay contiguous) ----------
  groups: TabGroup[] = [];
  private static readonly GROUP_COLORS: TabGroupColor[] = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];

  /** puts tabs into a group (a new one when groupId is missing/unknown); returns the group id */
  groupTabs(ids: number[], groupId?: string, opts: { title?: string; color?: TabGroupColor } = {}): string | null {
    const tabs = ids.map((id) => this.tab(id)).filter((t): t is Tab => !!t && !t.pinned && !t.hidden);
    if (!tabs.length) return null;
    let g = groupId ? this.groups.find((x) => x.id === groupId) : undefined;
    if (!g) {
      const used = new Set(this.groups.map((x) => x.color));
      const color = opts.color && OwlWindow.GROUP_COLORS.includes(opts.color) ? opts.color : OwlWindow.GROUP_COLORS.find((c) => !used.has(c)) ?? 'grey';
      g = { id: 'g' + Math.random().toString(36).slice(2, 9), title: (opts.title ?? '').slice(0, 60), color, collapsed: false };
      this.groups.push(g);
    }
    const gid = g.id;
    // anchor: after the group's last tab, or where the first chosen tab is
    const members = this.tabs.filter((t) => t.groupId === gid && !tabs.includes(t));
    const anchor = members.length ? members[members.length - 1] : tabs[0];
    const moving = tabs.filter((t) => t !== anchor);
    for (const t of moving) this.tabs.splice(this.tabs.indexOf(t), 1);
    let at = this.tabs.indexOf(anchor) + 1;
    for (const t of moving) this.tabs.splice(at++, 0, t);
    for (const t of tabs) t.groupId = gid;
    g.collapsed = false;
    this.pruneGroups();
    this.pushState();
    return gid;
  }

  /** takes tabs out of their group; they move to just after the group, like Chrome */
  ungroupTabs(ids: number[]) {
    // right-to-left so ungrouping a whole group (or its tail) keeps the strip order
    const order = ids.map((id) => this.tab(id)).filter((t): t is Tab => !!t?.groupId).sort((a, b) => this.tabs.indexOf(b) - this.tabs.indexOf(a));
    for (const t of order) {
      if (!t.groupId) continue;
      const gid = t.groupId;
      t.groupId = undefined;
      const rest = this.tabs.filter((x) => x.groupId === gid);
      if (rest.length) { this.tabs.splice(this.tabs.indexOf(t), 1); this.tabs.splice(this.tabs.indexOf(rest[rest.length - 1]) + 1, 0, t); }
    }
    this.pruneGroups();
    this.pushState();
  }

  updateGroup(id: string, patch: { title?: string; color?: TabGroupColor; collapsed?: boolean }) {
    const g = this.groups.find((x) => x.id === id);
    if (!g || !patch || typeof patch !== 'object') return;
    if (typeof patch.title === 'string') g.title = patch.title.slice(0, 60);
    if (patch.color && OwlWindow.GROUP_COLORS.includes(patch.color)) g.color = patch.color;
    if (typeof patch.collapsed === 'boolean' && patch.collapsed !== g.collapsed) {
      if (patch.collapsed) {
        // the active tab can't hide inside a collapsed group: move to the nearest tab outside it (or refuse)
        const act = this.active;
        if (act?.groupId === id) {
          const vis = this.tabs.filter((t) => !t.hidden);
          const i = vis.indexOf(act);
          const next = vis.slice(i + 1).find((t) => t.groupId !== id) ?? vis.slice(0, i).reverse().find((t) => t.groupId !== id);
          if (!next) { this.pushState(); return; }
          this.activate(next.id);
        }
      }
      g.collapsed = patch.collapsed;
    }
    this.pushState();
  }

  closeGroup(id: string) {
    for (const t of this.tabs.filter((x) => x.groupId === id)) this.close(t.id);
    this.pruneGroups();
    this.pushState();
  }

  /** drops empty groups; keeps every group contiguous after moves */
  pruneGroups() {
    this.groups = this.groups.filter((g) => this.tabs.some((t) => t.groupId === g.id));
  }

  newTab(url = 'owl://newtab', opts: { background?: boolean; index?: number; agentId?: string; runId?: string; hidden?: boolean; artifactId?: string; openerId?: number } = {}): Tab {
    const internal = parseInternal(url);
    const t = new Tab(this, internal ? 'about:blank' : url, { internal, agentId: opts.agentId, runId: opts.runId, artifactId: opts.artifactId });
    if (internal) { const h = url.indexOf('#'); if (h > 0 && h < url.length - 1) t.hash = url.slice(h, h + 64); }
    t.hidden = !!opts.hidden;
    let index = opts.index ?? this.tabs.length;
    if (opts.openerId != null && opts.index == null) {
      const oi = this.tabs.findIndex((x) => x.id === opts.openerId);
      if (oi >= 0) index = oi + 1;
    }
    this.tabs.splice(index, 0, t);
    // groups stay contiguous: a tab opened inside a group (or right after a grouped opener) joins it, like Chrome
    if (!t.hidden && !opts.agentId) {
      const prev = this.tabs[index - 1], next = this.tabs[index + 1];
      const opener = opts.openerId != null ? this.tab(opts.openerId) : undefined;
      if (prev?.groupId && prev.groupId === next?.groupId) t.groupId = prev.groupId;
      else if (opener?.groupId && prev?.groupId === opener.groupId) t.groupId = opener.groupId;
    }
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
    if (t.groupId) { const g = this.groups.find((x) => x.id === t.groupId); if (g?.collapsed) g.collapsed = false; }
    this.activeId = id;
    t.lastActive = Date.now();
    if (t.sleeping) t.wake();
    if (this.splitId === id) this.splitId = null;
    this.layout();
    this.pushState();
    if (t.wc && !this.overlay) t.wc.focus();
    else if (!t.wc && !this.win.isDestroyed()) this.win.webContents.focus(); // internal page: keys go to the UI, not a hidden web view
  }

  close(id: number) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const t = this.tabs[i];
    if (!t.internal && t.url !== 'about:blank') this.hooks.onCommand(this, '__closed', t.wc?.getURL() || t.url);
    t.destroy();
    this.tabs.splice(i, 1);
    if (t.groupId && !this.tabs.some((x) => x.groupId === t.groupId)) this.groups = this.groups.filter((g) => g.id !== t.groupId);
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
    const at = Math.max(0, Math.min(toIndex, this.tabs.length));
    this.tabs.splice(at, 0, t);
    // dropped between two tabs of one group → joins it; dropped outside its own group → leaves it
    const prev = this.tabs[at - 1], next = this.tabs[at + 1];
    if (prev?.groupId && prev.groupId === next?.groupId) t.groupId = prev.groupId;
    else if (t.groupId && prev?.groupId !== t.groupId && next?.groupId !== t.groupId && this.tabs.some((x) => x !== t && x.groupId === t.groupId)) t.groupId = undefined;
    this.pruneGroups();
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
    // the shell sends a 0×0 rect while onboarding / before its first layout: draw no page then
    const empty = this.bounds.width < 1 || this.bounds.height < 1;
    for (const t of want) {
      const v = t.view!;
      cv.addChildView(v); // re-adding moves it to the top
      const show = !this.overlay && !empty && (t === active || t === split);
      if (show) {
        const b = split && this.splitBounds && t === split ? this.splitBounds : this.bounds;
        v.setBounds(roundB(b));
        v.setVisible(true);
      } else if (t.agentId) {
        // Background agent tab: keep it visible to Chromium (so it renders, paints and can be
        // screenshotted at a real size) but park it outside the window so it never draws over
        // an internal page, the onboarding screen or the frozen-overlay menus.
        const w = Math.max(800, Math.round(this.bounds.width)), h = Math.max(600, Math.round(this.bounds.height));
        v.setBounds({ x: -w - 64, y: 0, width: w, height: h });
        v.setVisible(true);
      } else {
        v.setVisible(false);
      }
    }
    // the popup layer always stays above page views
    if (this.popup && this.popupId != null) cv.addChildView(this.popup);
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
      // zoom is remembered per site (Chrome): entering another host applies that host's saved level
      const site = zoomKey(url) ?? '';
      if (site !== t.zoomSite) {
        t.zoomSite = site;
        const z = site ? sitePrefs.zoomFor(this.profileId, this.incognito, url) : 1;
        t.zoom = z;
        if (Math.abs(wc.getZoomFactor() - z) > 0.001) wc.setZoomFactor(z);
      }
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
    wc.on('render-process-gone', () => {
      const dead = t.view;
      t.view = null; t.loading = false;
      if (dead && !this.win.isDestroyed()) { try { this.win.contentView.removeChildView(dead); } catch {} }
      this.layout(); update();
    });
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      // real popups (window.open with size/popup features, e.g. OAuth / payment sign-in) need a window
      // with window.opener intact; everything else opens as a tab
      if (disposition === 'new-window' && /(^|,)\s*(popup|width|height)\b/i.test(features || '')) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
      this.hooks.onNewWindowRequest(this, url, disposition);
      if (disposition === 'foreground-tab' || disposition === 'background-tab' || disposition === 'new-window' || disposition === 'default') {
        this.newTab(url, { background: disposition === 'background-tab', openerId: t.id });
        return { action: 'deny' };
      }
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    });
    wc.ipc.on('owl-web:password', (e, data) => {
      const frame = e.senderFrame;
      if (!frame || frame.parent || !data || typeof data !== 'object') return; // top frame only
      let origin = '';
      try { const u = new URL(frame.url); if (u.protocol !== 'https:' && u.protocol !== 'http:') return; origin = u.origin; } catch { return; }
      const username = typeof data.username === 'string' ? data.username.slice(0, 512) : '';
      const password = typeof data.password === 'string' ? data.password : '';
      if (!password || password.length > 4096) return;
      this.hooks.onPasswordSubmit(this, t, { origin, username, password });
    });
  }

  zoomTab(id: number, delta: number | 'reset') {
    const t = this.tab(id);
    if (!t?.wc) return;
    if (delta !== 'reset' && !(typeof delta === 'number' && Number.isFinite(delta))) return; // NaN would reach setZoomFactor and the state JSON
    t.zoom = delta === 'reset' ? 1 : Math.max(0.25, Math.min(5, Math.round((t.zoom + delta) * 100) / 100));
    t.wc.setZoomFactor(t.zoom);
    sitePrefs.setZoom(this.profileId, this.incognito, t.wc.getURL() || t.url, t.zoom);
    // other tabs on the same site follow (Chromium already does this for same-origin views)
    const k = zoomKey(t.wc.getURL() || t.url);
    for (const o of this.tabs) if (o !== t && o.wc && k && zoomKey(o.wc.getURL()) === k) o.zoom = t.zoom;
    this.pushState();
  }

  private contextMenu(t: Tab, p: Electron.ContextMenuParams) {
    const wc = t.wc;
    if (!wc) return;
    const items: Electron.MenuItemConstructorOptions[] = [];
    const sep = () => { if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' }); };
    const ask = (prompt: string) => this.hooks.onCommand(this, 'ask', prompt);
    const engine = engineName();
    const isWeb = (u: string) => /^(https?|file|data|blob):/i.test(u);
    if (p.linkURL) {
      const link = p.linkURL;
      items.push(
        { label: 'Open link in new tab', click: () => this.newTab(link, { background: true, openerId: t.id }) },
        { label: 'Open link in split view', click: () => { const n = this.newTab(link, { background: true, openerId: t.id }); this.setSplit(n.id); } },
        { label: 'Open link in new window', click: () => this.hooks.onCommand(this, 'open-in-window', link) },
        { label: 'Open link in incognito window', click: () => this.hooks.onCommand(this, 'open-in-incognito', link) },
        { type: 'separator' },
        { label: 'Save link as…', enabled: isWeb(link), click: () => wc.downloadURL(link) },
        { label: 'Copy link address', click: () => clipboard.writeText(link) },
      );
      if (p.linkText?.trim() && !p.hasImageContents) items.push({ label: 'Copy link text', click: () => clipboard.writeText(p.linkText.trim()) });
      items.push({ label: 'Ask companion about this link', click: () => ask(`Open and summarize this link: ${link}\n\n`) });
      sep();
    }
    if (p.mediaType === 'image' && p.srcURL) {
      const src = p.srcURL;
      items.push(
        { label: 'Open image in new tab', click: () => this.newTab(src, { background: true, openerId: t.id }) },
        { label: 'Save image as…', click: () => wc.downloadURL(src) },
        { label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) },
        { label: 'Copy image address', enabled: !src.startsWith('data:'), click: () => clipboard.writeText(src) },
        { label: 'Ask companion about this image', enabled: /^https?:/i.test(src), click: () => ask(`Look at this image from ${wc.getURL()} and describe what it shows: ${src}\n\n`) },
      );
      sep();
    } else if (p.mediaType === 'video' || p.mediaType === 'audio') {
      const at = `document.elementFromPoint(${Math.round(p.x)}, ${Math.round(p.y)})`;
      const media = `(() => { let e = ${at}; while (e && !(e instanceof HTMLMediaElement)) e = e.parentElement; return e || [...document.querySelectorAll('${p.mediaType}')].find((v) => { const r = v.getBoundingClientRect(); return ${Math.round(p.x)} >= r.left && ${Math.round(p.x)} <= r.right && ${Math.round(p.y)} >= r.top && ${Math.round(p.y)} <= r.bottom; }) || null; })()`;
      const run = (body: string) => wc.executeJavaScript(`(() => { const m = ${media}; if (!m) return false; ${body}; return true; })()`, true).catch(() => false);
      const playing = !!(p.mediaFlags && !p.mediaFlags.isPaused);
      items.push(
        { label: playing ? 'Pause' : 'Play', click: () => run(playing ? 'm.pause()' : 'm.play()') },
        { label: p.mediaFlags?.isMuted ? 'Unmute' : 'Mute', click: () => run('m.muted = !m.muted') },
        { label: 'Loop', type: 'checkbox', checked: !!p.mediaFlags?.isLooping, click: () => run('m.loop = !m.loop') },
        { label: 'Show controls', type: 'checkbox', checked: !!p.mediaFlags?.isControlsVisible, click: () => run('m.controls = !m.controls') },
      );
      if (p.mediaType === 'video') items.push({ label: 'Picture in picture', enabled: p.mediaFlags?.canShowPictureInPicture !== false, click: () => run('document.pictureInPictureElement === m ? document.exitPictureInPicture() : m.requestPictureInPicture()') });
      sep();
    }
    if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL && /^https?:/i.test(p.srcURL)) {
      const src = p.srcURL;
      items.push(
        { label: `Open ${p.mediaType} in new tab`, click: () => this.newTab(src, { background: true, openerId: t.id }) },
        { label: `Save ${p.mediaType} as…`, click: () => wc.downloadURL(src) },
        { label: `Copy ${p.mediaType} address`, click: () => clipboard.writeText(src) },
      );
      sep();
    }
    const sel = p.selectionText?.trim().slice(0, 2000) || '';
    if (p.isEditable) {
      if (p.misspelledWord) {
        for (const w of p.dictionarySuggestions.slice(0, 5)) items.push({ label: w, click: () => wc.replaceMisspelling(w) });
        if (!p.dictionarySuggestions.length) items.push({ label: 'No spelling suggestions', enabled: false });
        items.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
        sep();
      }
      items.push(
        { role: 'undo', enabled: p.editFlags.canUndo }, { role: 'redo', enabled: p.editFlags.canRedo }, { type: 'separator' },
        { role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste },
        { role: 'pasteAndMatchStyle', label: 'Paste as plain text', enabled: p.editFlags.canPaste }, { role: 'selectAll' },
      );
      if (sel) items.push({ type: 'separator' }, { label: `Search ${engine} for “${clip(sel, 24)}”`, click: () => this.newTab(searchUrl(sel), { openerId: t.id }) });
      sep();
    } else if (sel) {
      const asUrl = /^\S+\.[a-z]{2,}(\/\S*)?$/i.test(sel) && !/\s/.test(sel) ? normalizeInput(sel) : null;
      items.push({ label: 'Copy', role: 'copy' });
      if (asUrl && /^https?:/.test(asUrl)) items.push({ label: `Go to ${clip(sel, 32)}`, click: () => this.newTab(asUrl, { openerId: t.id }) });
      items.push(
        { label: `Search ${engine} for “${clip(sel, 24)}”`, click: () => this.newTab(searchUrl(sel), { openerId: t.id }) },
        { label: 'Ask companion about selection', click: () => ask(`About this text from ${wc.getURL()}:\n"${sel}"\n\n`) },
        { label: 'Explain selection', click: () => ask(`Explain this simply (from ${wc.getURL()}):\n"${sel}"`) },
      );
      sep();
    }
    if (!p.linkURL && !sel && !p.isEditable && p.mediaType === 'none') {
      items.push(
        { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: 'Reload', click: () => wc.reload() },
        { type: 'separator' },
        { label: 'Summarize this page', click: () => ask('Summarize this page in a few bullet points.') },
        { label: 'Ask companion about this page', click: () => ask('') },
        { type: 'separator' },
        { label: 'Save page as…', click: () => this.hooks.onCommand(this, 'save-page') },
        { label: 'Print…', click: () => wc.print() },
        { label: 'Copy page address', click: () => clipboard.writeText(wc.getURL()) },
        { label: 'View page source', click: () => this.newTab('view-source:' + wc.getURL(), { openerId: t.id }) },
      );
      sep();
    }
    items.push({ label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  /** Chrome-parity shortcuts (Windows/Linux; Cmd on macOS). Commands main does not handle go to the UI as 'command'. */
  handleShortcut(e: Electron.Event, input: Electron.Input) {
    if (input.type !== 'keyDown') return;
    const mac = process.platform === 'darwin';
    const ctrl = mac ? input.meta : input.control;
    const shift = input.shift, alt = input.alt;
    const k = input.key.toLowerCase();
    let cmd: string | null = null; let arg: any;
    if (ctrl && !shift && k === 't') cmd = 'new-tab';
    else if (ctrl && shift && k === 't') cmd = 'reopen-tab';
    else if (ctrl && shift && k === 'w') cmd = 'close-window';
    else if ((ctrl && k === 'w') || (ctrl && k === 'f4')) cmd = 'close-tab';
    else if (ctrl && shift && k === 'n') cmd = 'incognito';
    else if (ctrl && !shift && k === 'n') cmd = 'new-window';
    else if ((ctrl && (k === 'l' || k === 'e')) || (alt && k === 'd') || k === 'f6') cmd = 'focus-omnibox';
    else if ((ctrl && k === 'r') || k === 'f5') cmd = shift || (ctrl && k === 'f5') ? 'hard-reload' : 'reload';
    else if (ctrl && !shift && k === 'f') cmd = 'find';
    else if (k === 'f3' || (ctrl && k === 'g')) cmd = shift ? 'find-prev' : 'find-next';
    else if (ctrl && k === 'd') cmd = 'bookmark';
    else if (ctrl && shift && k === 'j') cmd = 'toggle-companion';
    else if (ctrl && k === 'j') cmd = 'downloads';
    else if (ctrl && shift && k === 'a') cmd = 'palette';
    else if (ctrl && k === 'k') cmd = 'palette';
    else if (ctrl && k === 'h' && !mac) cmd = 'history';
    else if (mac && input.meta && k === 'y') cmd = 'history';
    else if (ctrl && shift && k === 'b') cmd = 'toggle-bookmarks-bar';
    else if (ctrl && shift && k === 'o') cmd = 'bookmarks';
    else if (ctrl && shift && k === 'delete') cmd = 'clear-data';
    else if (ctrl && (k === '=' || k === '+')) cmd = 'zoom-in';
    else if (ctrl && (k === '-' || k === '_')) cmd = 'zoom-out';
    else if (ctrl && k === '0') cmd = 'zoom-reset';
    else if (ctrl && k === 'tab') cmd = shift ? 'prev-tab' : 'next-tab';
    else if (ctrl && shift && (k === 'pageup' || k === 'pagedown')) cmd = k === 'pageup' ? 'move-tab-left' : 'move-tab-right';
    else if (ctrl && (k === 'pageup' || k === 'pagedown')) cmd = k === 'pageup' ? 'prev-tab' : 'next-tab';
    else if (mac && input.meta && alt && (k === 'arrowleft' || k === 'arrowright')) cmd = k === 'arrowleft' ? 'prev-tab' : 'next-tab';
    else if (ctrl && /^[1-9]$/.test(k)) { cmd = 'goto-tab'; arg = Number(k); }
    else if ((alt && !ctrl && k === 'arrowleft') || (mac && input.meta && k === '[')) cmd = 'back';
    else if ((alt && !ctrl && k === 'arrowright') || (mac && input.meta && k === ']')) cmd = 'forward';
    else if (alt && k === 'home') cmd = 'home';
    else if (k === 'f12' || (ctrl && shift && (k === 'i' || k === 'c'))) cmd = 'devtools';
    else if (k === 'f11' || (mac && input.meta && input.control && k === 'f')) cmd = 'toggle-fullscreen';
    else if (ctrl && k === 'p') cmd = 'print';
    else if (ctrl && shift && k === 's') cmd = 'toggle-split';
    else if (ctrl && k === 's') cmd = 'save-page';
    else if (ctrl && k === 'u') cmd = 'view-source';
    else if (alt && !ctrl && (k === 'f' || k === 'e')) cmd = 'app-menu';
    else if (k === 'escape' && this.win.isFullScreen()) cmd = 'exit-fullscreen';
    else if (ctrl && k === '\\') cmd = 'toggle-sidebar';
    if (cmd) {
      e.preventDefault();
      // commands that put the caret in the chrome (omnibox, find bar, palette, menu) must move OS keyboard
      // focus off the web view first, or the next keystrokes land in the page
      if (UI_FOCUS_CMDS.has(cmd) && !this.win.isDestroyed()) this.win.webContents.focus();
      this.hooks.onCommand(this, cmd, arg);
    }
  }
}

const UI_FOCUS_CMDS = new Set(['focus-omnibox', 'find', 'palette', 'app-menu', 'new-tab']);

/** What the UI asks the popup layer to draw (see src/renderer/lib/ui/popup.ts). rect: window-relative CSS px, omitted = whole window. */
export type PopupSpec = { id: number; kind: string; rect?: Bounds; focus?: boolean; [k: string]: any };

function clampRect(r: Bounds, cw: number, ch: number): Electron.Rectangle {
  const x = Math.max(0, Math.min(Math.round(r.x), cw - 1)), y = Math.max(0, Math.min(Math.round(r.y), ch - 1));
  return { x, y, width: Math.max(1, Math.min(Math.round(r.width), cw - x)), height: Math.max(1, Math.min(Math.round(r.height), ch - y)) };
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

function clip(s: string, n: number) { return s.length > n ? s.slice(0, n) + '…' : s; }

export function engineName() {
  return ({ google: 'Google', duckduckgo: 'DuckDuckGo', bing: 'Bing', brave: 'Brave', perplexity: 'Perplexity', kagi: 'Kagi' } as Record<string, string>)[settings.get().searchEngine] || 'Google';
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
