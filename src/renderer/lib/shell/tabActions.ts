import type { TabState } from '$shared/types';
import type { MenuItem } from '../ui/Menu.svelte';
import { owl } from '../api';
import { store } from '../stores.svelte';
import { Plus, RotateCw, Copy, Pin, PinOff, Volume2, VolumeX, Moon, Columns2, X, XSquare, Bot, ArrowRightToLine, History, Link, Star } from '@lucide/svelte';

export function tabMenu(t: TabState): MenuItem[] {
  const idx = store.win.tabs.findIndex((x) => x.id === t.id);
  const isSplit = store.win.splitTabId === t.id;
  const items: MenuItem[] = [
    { label: 'New tab to the right', icon: Plus, onSelect: async () => { const id = (await owl.newTab('owl://newtab')) as number; if (id != null) owl.moveTab(id, idx + 1); } },
    { separator: true },
    { label: 'Reload', icon: RotateCw, kbd: 'Ctrl+R', disabled: !!t.internal, onSelect: () => owl.reload(t.id) },
    { label: 'Duplicate', icon: Copy, onSelect: () => owl.duplicateTab(t.id) },
    { label: t.pinned ? 'Unpin' : 'Pin', icon: t.pinned ? PinOff : Pin, onSelect: () => owl.pinTab(t.id) },
    { label: t.muted ? 'Unmute site' : 'Mute site', icon: t.muted ? Volume2 : VolumeX, disabled: !!t.internal, onSelect: () => owl.muteTab(t.id) },
    { label: 'Sleep tab (free memory)', icon: Moon, disabled: t.sleeping || t.id === store.win.activeTabId || !!t.internal, onSelect: () => owl.sleepTab(t.id) },
    { label: isSplit ? 'Close split view' : 'Split view with this tab', icon: Columns2, disabled: t.id === store.win.activeTabId && !isSplit, onSelect: () => owl.setSplit(isSplit ? null : t.id) },
  ];
  if (t.agentRunId) items.push({ separator: true }, { label: 'Stop agent in this tab', icon: Bot, onSelect: () => owl.stopRun(t.agentRunId) });
  const right = store.win.tabs.slice(idx + 1).filter((x) => !x.pinned);
  const others = store.win.tabs.filter((x) => x.id !== t.id && !x.pinned);
  items.push(
    { separator: true },
    { label: 'Copy link', icon: Link, disabled: !!t.internal, onSelect: () => navigator.clipboard?.writeText(t.url).then(() => store.toast('Link copied'), () => {}) },
    { label: 'Bookmark tab', icon: Star, disabled: !!t.internal, onSelect: () => owl.toggleBookmark(t.url, t.title, t.favicon).then((on: any) => store.toast(on ? 'Bookmarked' : 'Bookmark removed', on ? t.title : undefined, on ? 'success' : 'info')) },
    { separator: true },
    { label: 'Close', icon: X, kbd: 'Ctrl+W', onSelect: () => owl.closeTab(t.id) },
    { label: 'Close other tabs', icon: XSquare, disabled: !others.length, onSelect: () => others.forEach((x) => owl.closeTab(x.id)) },
    { label: 'Close tabs to the right', icon: ArrowRightToLine, disabled: !right.length, onSelect: () => right.forEach((x) => owl.closeTab(x.id)) },
    { separator: true },
    { label: 'Reopen closed tab', icon: History, kbd: 'Ctrl+Shift+T', onSelect: () => owl.reopenClosed() },
  );
  return items;
}

/** live run for an agent-controlled tab */
export function runFor(t: TabState) {
  return t.agentRunId ? store.runs.find((r) => r.id === t.agentRunId) ?? null : null;
}

/** shared drag-to-reorder state between tab rows */
export const drag = { id: -1 };

/** move the dragged tab next to `overId`; pinned and unpinned tabs stay in their own groups */
export function dropTab(overId: number, after: boolean) {
  const tabs = store.win.tabs;
  const from = tabs.findIndex((x) => x.id === drag.id);
  if (from < 0) return;
  let to = tabs.findIndex((x) => x.id === overId) + (after ? 1 : 0);
  if (from < to) to--;
  const pinnedCount = tabs.filter((x) => x.pinned).length;
  to = tabs[from].pinned ? Math.min(to, pinnedCount - 1) : Math.max(to, pinnedCount);
  if (from !== to && to >= 0) owl.moveTab(drag.id, to);
}
