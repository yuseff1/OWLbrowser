import type { TabState } from '$shared/types';
import type { MenuItem } from '../ui/Menu.svelte';
import { owl } from '../api';
import { store } from '../stores.svelte';
import { Plus, RotateCw, Copy, Pin, PinOff, Volume2, VolumeX, Moon, Columns2, X, XSquare, Bot } from '@lucide/svelte';

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
  items.push(
    { separator: true },
    { label: 'Close', icon: X, kbd: 'Ctrl+W', onSelect: () => owl.closeTab(t.id) },
    { label: 'Close other tabs', icon: XSquare, disabled: store.win.tabs.length < 2, onSelect: () => store.win.tabs.filter((x) => x.id !== t.id && !x.pinned).forEach((x) => owl.closeTab(x.id)) },
  );
  return items;
}

/** live run for an agent-controlled tab */
export function runFor(t: TabState) {
  return t.agentRunId ? store.runs.find((r) => r.id === t.agentRunId) ?? null : null;
}

/** shared drag-to-reorder state between tab rows */
export const drag = { id: -1 };
