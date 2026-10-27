import { createStore, uid } from '@/lib/store';
import { loadJson, saveJson } from '@/lib/storage';
import { toUrl } from '@/lib/url';
import { appStore, app } from './app';
import type { Tab, TabRuntime } from '@/lib/types';
import type { WebViewHandle } from '@/components/WebViewBase';

export type BrowserTab = Tab & {
  /** URL requested by the user/agent; the WebView `source`. `url` is what the page currently shows. */
  src: string;
  /** bumps to force a reload of the same src */
  nonce: number;
};

export type BrowserState = {
  tabs: BrowserTab[];
  activeId: string;
  runtime: Record<string, TabRuntime>;
  /** tabs whose WebView stays mounted (most recently used first) */
  alive: string[];
  ready: boolean;
};

const MAX_ALIVE = 4;
export const EMPTY_RUNTIME: TabRuntime = { loading: false, progress: 0, canGoBack: false, canGoForward: false, blocked: 0 };

function blankTab(url = '', isPrivate = false): BrowserTab {
  const now = Date.now();
  return { id: uid('t_'), url, src: url, nonce: 0, title: '', private: isPrivate, createdAt: now, lastActive: now };
}

const first = blankTab();
export const browserStore = createStore<BrowserState>({ tabs: [first], activeId: first.id, runtime: {}, alive: [first.id], ready: false });

const tabsKey = () => `p:${appStore.get().profileId}:tabs`;

let lastPersisted = '';
function persist(delay = 800) {
  const s = browserStore.get();
  // private tabs are never written to disk
  const tabs = s.tabs.filter((t) => !t.private).map(({ nonce, ...t }) => ({ ...t, src: t.url || t.src }));
  const value = { tabs, activeId: s.activeId };
  // Navigation events fire many times per page; only touch AsyncStorage when something we store changed.
  const sig = s.activeId + '|' + tabs.map((t) => t.id + '\u0001' + t.src + '\u0001' + t.title).join('\u0002');
  if (sig === lastPersisted) return;
  lastPersisted = sig;
  saveJson(tabsKey(), value, delay);
}

// ---------- loading watchdog ----------
// Android WebView does not always send a final "finished" event (SPA history updates, redirects, blocked
// sub-frames, pages that never fire onPageFinished). Without this the progress bar and the Stop button could stay
// up forever. If a tab reports no load activity for STALL_MS while "loading", we consider the load done.
const STALL_MS = 15000;
const watchdogs = new Map<string, ReturnType<typeof setTimeout>>();
function clearWatchdog(id: string) {
  const w = watchdogs.get(id);
  if (w) { clearTimeout(w); watchdogs.delete(id); }
}
function armWatchdog(id: string) {
  clearWatchdog(id);
  watchdogs.set(id, setTimeout(() => {
    watchdogs.delete(id);
    const rt = browserStore.get().runtime[id];
    if (rt?.loading) {
      browser.setRuntime(id, { loading: false, progress: 1 });
      webviews.notifyLoaded(id);
    }
  }, STALL_MS));
}

function touchAlive(id: string, alive: string[]) {
  return [id, ...alive.filter((x) => x !== id)].slice(0, MAX_ALIVE);
}

// ---------- WebView registry: lets the toolbar and the agent reach a tab's WebView ----------
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
const refs = new Map<string, WebViewHandle | null>();
const pending = new Map<string, Pending>();
const loadWaiters = new Map<string, Array<() => void>>();

export const webviews = {
  register(tabId: string, ref: WebViewHandle | null) {
    if (ref) refs.set(tabId, ref); else refs.delete(tabId);
  },
  get(tabId: string) {
    return refs.get(tabId) || null;
  },
  /** Evaluate a JS expression in the tab and resolve with its (awaited) JSON value. */
  eval<T = any>(tabId: string, expr: string, timeoutMs = 12000): Promise<T> {
    const ref = refs.get(tabId);
    if (!ref) return Promise.reject(new Error('The tab is not loaded yet.'));
    const id = uid('e');
    const code = `(function(){
      function post(m){ try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch(e){} }
      try {
        Promise.resolve(${expr}).then(function(v){ post({ __owl: '${id}', ok: true, value: v === undefined ? null : v }); },
          function(e){ post({ __owl: '${id}', ok: false, error: String(e && e.message || e) }); });
      } catch (e) { post({ __owl: '${id}', ok: false, error: String(e && e.message || e) }); }
    })(); true;`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('The page did not respond (it may still be loading).'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      ref.injectJavaScript(code);
    });
  },
  /** Called by BrowserWebView.onMessage. Returns true when the message belonged to the bridge. */
  handleMessage(tabId: string, raw: string): boolean {
    if (!raw || raw[0] !== '{') return false;
    let m: any;
    try { m = JSON.parse(raw); } catch { return false; }
    if (m && typeof m.__owl === 'string') {
      const p = pending.get(m.__owl);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(m.__owl);
        if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error || 'Script error'));
      }
      return true;
    }
    if (m && typeof m.__owlBlocked === 'number') {
      browser.setRuntime(tabId, { blocked: Math.max(browserStore.get().runtime[tabId]?.blocked || 0, m.__owlBlocked) });
      return true;
    }
    return false;
  },
  notifyLoaded(tabId: string) {
    const l = loadWaiters.get(tabId);
    if (l) { loadWaiters.delete(tabId); l.forEach((f) => f()); }
  },
  /** Resolve when the tab finishes loading (or after timeout). */
  waitForLoad(tabId: string, timeoutMs = 15000): Promise<void> {
    return new Promise((resolve) => {
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(() => {
        const l = loadWaiters.get(tabId);
        if (l) loadWaiters.set(tabId, l.filter((f) => f !== done));
        resolve();
      }, timeoutMs);
      const l = loadWaiters.get(tabId) || [];
      l.push(done);
      loadWaiters.set(tabId, l);
    });
  },
};

// ---------- tab actions ----------
export const browser = {
  async init() {
    const saved = await loadJson<{ tabs: BrowserTab[]; activeId: string } | null>(tabsKey(), null);
    const savedTabs = saved && Array.isArray(saved.tabs) ? saved.tabs.filter((t) => t && typeof t.id === 'string') : [];
    if (saved && savedTabs.length) {
      const tabs = savedTabs.map((t) => ({ ...t, title: t.title || '', nonce: 0, src: t.url || t.src || '' }));
      const activeId = tabs.some((t) => t.id === saved.activeId) ? saved.activeId : tabs[0].id;
      browserStore.set({ tabs, activeId, alive: [activeId], runtime: {}, ready: true });
    } else {
      const t = blankTab();
      browserStore.set({ tabs: [t], activeId: t.id, alive: [t.id], runtime: {}, ready: true });
    }
  },

  /** Called after a profile switch: load that profile's tabs. */
  async reloadForProfile() {
    browserStore.set({ ready: false });
    await this.init();
  },

  active(): BrowserTab {
    const s = browserStore.get();
    return s.tabs.find((t) => t.id === s.activeId) || s.tabs[0];
  },

  newTab(input = '', opts: { private?: boolean; background?: boolean } = {}): BrowserTab {
    const url = input ? toUrl(input, appStore.get().settings.searchEngine) : '';
    const t = blankTab(url, !!opts.private);
    const s = browserStore.get();
    browserStore.set({
      tabs: [...s.tabs, t],
      activeId: opts.background ? s.activeId : t.id,
      alive: opts.background ? s.alive : touchAlive(t.id, s.alive),
    });
    persist(0);
    return t;
  },

  activate(id: string) {
    const s = browserStore.get();
    if (!s.tabs.some((t) => t.id === id)) return;
    browserStore.set({
      activeId: id,
      alive: touchAlive(id, s.alive),
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, lastActive: Date.now() } : t)),
    });
    persist();
  },

  close(id: string) {
    const s = browserStore.get();
    const idx = s.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    let tabs = s.tabs.filter((t) => t.id !== id);
    if (!tabs.length) tabs = [blankTab()];
    let activeId = s.activeId;
    if (activeId === id) activeId = (tabs[Math.min(idx, tabs.length - 1)] || tabs[0]).id;
    const runtime = { ...s.runtime };
    delete runtime[id];
    browserStore.set({ tabs, activeId, runtime, alive: touchAlive(activeId, s.alive.filter((x) => x !== id)) });
    webviews.register(id, null);
    clearWatchdog(id);
    persist(0);
  },

  closeAll(privateOnly = false) {
    const s = browserStore.get();
    const keep = privateOnly ? s.tabs.filter((t) => !t.private) : [];
    const tabs = keep.length ? keep : [blankTab()];
    const activeId = tabs.some((t) => t.id === s.activeId) ? s.activeId : tabs[tabs.length - 1].id;
    browserStore.set({ tabs, activeId, alive: [activeId], runtime: {} });
    persist();
  },

  /** Navigate a tab to typed input (URL or search words). '' goes Home. */
  navigate(id: string, input: string) {
    const url = input ? toUrl(input, appStore.get().settings.searchEngine) : '';
    const s = browserStore.get();
    browserStore.set({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, src: url, url, title: url ? t.title : '', nonce: t.src === url ? t.nonce + 1 : t.nonce } : t)),
      alive: touchAlive(id, s.alive),
      runtime: { ...s.runtime, [id]: { ...EMPTY_RUNTIME, loading: !!url } },
    });
    if (url) armWatchdog(id); else clearWatchdog(id);
    persist(0);
    return url;
  },

  /** Page reported a navigation (link click, redirect, back/forward). */
  onPageNav(id: string, nav: { url: string; title?: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }) {
    const s = browserStore.get();
    const tab = s.tabs.find((t) => t.id === id);
    if (!tab) return;
    const url = nav.url && !nav.url.startsWith('about:blank') ? nav.url : tab.url;
    const title = nav.title && !/^https?:\/\//.test(nav.title) ? nav.title : tab.title;
    const prev = s.runtime[id] || EMPTY_RUNTIME;
    const changedUrl = url !== tab.url;
    // Navigation-state events may only END a load. Android also sends them for history.pushState/replaceState
    // (doUpdateVisitedHistory) with loading=true and no matching finish event, which used to leave the progress bar
    // pinned at 100% forever. Starting a load is owned by navigate() / onLoadStart() / onLoadProgress().
    const loading = nav.loading ? prev.loading && prev.progress < 1 : false;
    if (!loading) clearWatchdog(id);
    const nextRt = { ...prev, loading, canGoBack: nav.canGoBack, canGoForward: nav.canGoForward, blocked: changedUrl ? 0 : prev.blocked };
    const sameTab = tab.url === url && tab.title === title;
    const sameRt = prev.loading === nextRt.loading && prev.canGoBack === nextRt.canGoBack && prev.canGoForward === nextRt.canGoForward && prev.blocked === nextRt.blocked && s.runtime[id] !== undefined;
    if (!sameTab || !sameRt) {
      browserStore.set({
        tabs: sameTab ? s.tabs : s.tabs.map((t) => (t.id === id ? { ...t, url, title } : t)),
        runtime: sameRt ? s.runtime : { ...s.runtime, [id]: nextRt },
      });
    }
    if (!tab.private && !nav.loading) {
      if (changedUrl) app.addHistory(url, title); else app.updateHistoryTitle(url, title);
    }
    persist();
  },

  setRuntime(id: string, patch: Partial<TabRuntime>) {
    const s = browserStore.get();
    if (!s.tabs.some((t) => t.id === id)) return; // late event from a closed tab
    const prev = s.runtime[id] || EMPTY_RUNTIME;
    const next = { ...prev, ...patch };
    // Skip no-op updates: WebViews repeat identical progress events, and every store write re-runs all selectors.
    if (s.runtime[id] && (Object.keys(patch) as (keyof TabRuntime)[]).every((k) => prev[k] === next[k])) return;
    browserStore.set({ runtime: { ...s.runtime, [id]: next } });
  },

  /** A real page load started in the WebView (main frame). */
  onLoadStart(id: string) {
    const prev = browserStore.get().runtime[id] || EMPTY_RUNTIME;
    this.setRuntime(id, { loading: true, progress: prev.loading && prev.progress < 1 ? prev.progress : 0 });
    armWatchdog(id);
  },

  /** WebView load progress (0..1). Reaching 1 ends the load; anything below keeps the watchdog alive. */
  onLoadProgress(id: string, progress: number) {
    const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    if (p >= 1) {
      clearWatchdog(id);
      this.setRuntime(id, { progress: 1, loading: false });
    } else {
      armWatchdog(id);
      this.setRuntime(id, { progress: p, loading: true });
    }
  },

  /** Load finished or failed. Always clears the loading state. */
  onLoadEnd(id: string) {
    clearWatchdog(id);
    this.setRuntime(id, { loading: false, progress: 1 });
    webviews.notifyLoaded(id);
  },

  goBack(id: string) {
    const rt = browserStore.get().runtime[id];
    if (rt?.canGoBack) webviews.get(id)?.goBack();
    else this.navigate(id, '');
  },
  goForward(id: string) { webviews.get(id)?.goForward(); },
  reload(id: string) {
    const ref = webviews.get(id);
    if (ref) ref.reload();
    else { const t = browserStore.get().tabs.find((x) => x.id === id); if (t?.url) this.navigate(id, t.url); }
  },
  stop(id: string) {
    webviews.get(id)?.stopLoading();
    // stopLoading() does not reliably emit a finish event on Android; reset the UI ourselves.
    this.onLoadEnd(id);
  },
};
