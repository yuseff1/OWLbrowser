/**
 * Session restore + tab sleeping (memory saver) helpers.
 *
 * - Restored background tabs are created WITHOUT a renderer (a Tab with view=null is "sleeping");
 *   the renderer is created on first activation (OwlWindow.activate → Tab.wake). Only the active tab
 *   loads at startup.
 * - Sleeping a tab discards its WebContents (Tab.sleep closes it). Before that we capture the scroll
 *   position, and when the tab wakes and its page finishes loading at the same URL we scroll back.
 * - Scroll positions of awake tabs are sampled by the memory-saver tick so a restart restores them too.
 *
 * Lives outside window.ts on purpose (that file is owned by the window/tab code); it only uses
 * Tab/OwlWindow's public surface.
 */
import { app, type WebContents } from 'electron';
import { Tab, parseInternal, type OwlWindow } from './window';
import { isWebUrl } from './net-guard';
import type { TabGroup } from '../shared/types';

export interface Scroll { url: string; x: number; y: number }
export interface SavedWindow {
  urls: string[];
  active: number;
  /** optional, parallel to urls (older sessions don't have them) */
  titles?: string[];
  scroll?: Array<{ x: number; y: number } | null>;
  /** pinned flags and tab-group ids, parallel to urls; groups of the window (since 0.1.15) */
  pinned?: boolean[];
  group?: Array<string | null>;
  groups?: TabGroup[];
}

/** scroll to re-apply after the next load of `url` (set when a tab sleeps or is restored) */
const pending = new WeakMap<Tab, Scroll>();
/** last sampled scroll of an awake tab (used when saving the session) */
const sampled = new WeakMap<Tab, Scroll>();

const READ_SCROLL = `({ x: Math.round(scrollX), y: Math.round(scrollY) })`;
const SCROLL_BACK = (x: number, y: number) => `(async () => {
  // pages often grow after load (lazy content, SPAs): wait a little for enough height, never fight the user
  for (let i = 0; i < 10; i++) {
    if (scrollY > 0) return false;
    if (document.documentElement.scrollHeight >= ${y} + innerHeight * 0.5 || i === 9) { scrollTo(${x}, ${y}); return true; }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
})()`;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(() => null);
}

async function readScroll(wc: WebContents): Promise<{ x: number; y: number } | null> {
  if (wc.isDestroyed() || wc.isLoading()) return null;
  const r = await withTimeout(wc.executeJavaScript(READ_SCROLL, false) as Promise<{ x: number; y: number }>, 400);
  return r && Number.isFinite(r.x) && Number.isFinite(r.y) ? r : null;
}

/** Sample scroll of awake web tabs (cheap; called from the memory-saver tick). */
export async function sampleScroll(tabs: Tab[]) {
  await Promise.all(tabs.map(async (t) => {
    const wc = t.wc;
    if (!wc || t.internal) return;
    const url = wc.getURL();
    if (!isWebUrl(url)) return;
    const s = await readScroll(wc);
    if (s) sampled.set(t, { url, ...s });
  }));
}

/**
 * Put a tab to sleep (discard its renderer) after remembering its scroll position.
 * `stillEligible` is re-checked after the async scroll read (the user may have activated it meanwhile).
 * Returns true when the tab was discarded.
 */
export async function sleepTab(t: Tab, stillEligible: () => boolean = () => true): Promise<boolean> {
  const wc = t.wc;
  if (!wc || t.internal || t.agentId) return false;
  const url = wc.getURL();
  const s = isWebUrl(url) ? await readScroll(wc) : null;
  if (!stillEligible() || t.wc !== wc) return false;
  if (s && (s.x || s.y)) pending.set(t, { url, ...s }); else pending.delete(t);
  t.sleep();
  return !t.view;
}

/**
 * Re-apply a remembered scroll position when a woken tab finishes loading the same URL.
 * Call once at startup; `tabFor` maps a WebContents back to its Tab.
 */
export function installScrollRestore(tabFor: (wc: WebContents) => Tab | null) {
  app.on('web-contents-created', (_e, wc) => {
    wc.on('did-finish-load', () => {
      const t = tabFor(wc);
      if (!t) return;
      const p = pending.get(t);
      if (!p) return;
      pending.delete(t); // one shot: a different page or a second load must not jump
      if (sameDoc(wc.getURL(), p.url)) wc.executeJavaScript(SCROLL_BACK(p.x, p.y), true).catch(() => {});
    });
  });
}

function sameDoc(a: string, b: string) {
  try { const x = new URL(a), y = new URL(b); return x.origin === y.origin && x.pathname === y.pathname && x.search === y.search; } catch { return a === b; }
}

/** Snapshot of one window for the session store (visible, non-agent tabs only). */
export function snapshotWindow(w: OwlWindow): SavedWindow {
  const visible = w.tabs.filter((t) => !t.hidden && !t.agentId);
  const urls: string[] = [], titles: string[] = [], scroll: SavedWindow['scroll'] = [], pinned: boolean[] = [], group: Array<string | null> = [];
  for (const t of visible) {
    pinned.push(!!t.pinned);
    group.push(t.groupId ?? null);
    const url = t.internal ? `owl://${t.internal}${t.hash || ''}` : t.wc?.getURL() || t.url;
    urls.push(url);
    titles.push(t.title || '');
    const s = pending.get(t) || sampled.get(t);
    scroll.push(s && s.url === url && (s.x || s.y) ? { x: s.x, y: s.y } : null);
  }
  const groups = w.groups.filter((g) => group.includes(g.id)).map((g) => ({ ...g }));
  return { urls, active: Math.max(0, visible.findIndex((t) => t.id === w.activeId)), titles, scroll, pinned, group, groups };
}

/**
 * Recreate a saved window's tabs. Web tabs are created asleep (no WebContents); only the active
 * tab gets a renderer, via activate(). Internal pages (owl://…) never have a renderer anyway.
 */
export function restoreTabs(w: OwlWindow, saved: SavedWindow) {
  // keep indexes aligned with the parallel arrays (titles/scroll/pinned/group) while skipping bad entries
  const idx = saved.urls.map((u, i) => (typeof u === 'string' && u ? i : -1)).filter((i) => i >= 0);
  const urls = idx.map((i) => saved.urls[i]);
  const now = Date.now();
  const groupIds = new Set((Array.isArray(saved.groups) ? saved.groups : []).filter((g) => g && typeof g.id === 'string').map((g) => g.id));
  w.groups = (Array.isArray(saved.groups) ? saved.groups : []).filter((g) => g && typeof g.id === 'string').map((g) => ({ id: g.id, title: String(g.title ?? '').slice(0, 60), color: g.color || 'grey', collapsed: !!g.collapsed }));
  urls.forEach((url, j) => {
    const i = idx[j];
    let t: Tab;
    if (parseInternal(url)) {
      t = w.newTab(url, { background: true });
    } else {
      t = new Tab(w, url);
      t.title = saved.titles?.[i] || hostOf(url);
      w.tabs.push(t);
      const s = saved.scroll?.[i];
      if (s && (s.x || s.y)) pending.set(t, { url, x: s.x, y: s.y });
    }
    t.lastActive = now - (urls.length - j) * 1000; // keep strip order as LRU order for the memory saver
    if (saved.pinned?.[i]) t.pinned = true;
    const g = saved.group?.[i];
    if (g && groupIds.has(g) && !t.pinned) t.groupId = g;
  });
  // pinned tabs first (as the strip always shows them)
  w.tabs.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const active = w.tabs[Math.min(Math.max(0, saved.active | 0), w.tabs.length - 1)];
  if (active) w.activate(active.id);
  else { w.layout(); w.pushState(); }
}

function hostOf(u: string) { try { return new URL(u).hostname || u; } catch { return u; } }
