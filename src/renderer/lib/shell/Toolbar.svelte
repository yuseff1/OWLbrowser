<script lang="ts">
  import { owl } from '../api';
  import { store } from '../stores.svelte';
  import { IconButton, Menu, Popover, CompanionAvatar, Tooltip, type MenuItem } from '../ui';
  import { ArrowLeft, ArrowRight, RotateCw, X, PanelLeft, Ellipsis, Plus, AppWindow, EyeOff, Clock, Download, Bookmark, Search, Printer, Columns2, Settings, ZoomIn, ZoomOut, Code } from '@lucide/svelte';
  import Omnibox from './Omnibox.svelte';
  import AgentsIndicator from './AgentsIndicator.svelte';
  import DownloadsButton from './DownloadsButton.svelte';
  import ProfileMenu from './ProfileMenu.svelte';
  import { profile } from './profile.svelte';

  let { modern = false }: { modern?: boolean } = $props();
  const mac = owl.platform === 'darwin';
  const tab = $derived(store.activeTab);
  const comp = $derived(store.activeCompanion);
  let profileOpen = $state(false);

  const more = $derived<MenuItem[]>([
    { label: 'New tab', icon: Plus, kbd: 'Ctrl+T', onSelect: () => owl.newTab() },
    { label: 'New window', icon: AppWindow, kbd: 'Ctrl+N', onSelect: () => owl.newWindow({}) },
    { label: 'New incognito window', icon: EyeOff, kbd: 'Ctrl+Shift+N', onSelect: () => owl.newWindow({ incognito: true }) },
    { separator: true },
    { label: 'History', icon: Clock, kbd: 'Ctrl+H', onSelect: () => owl.newTab('owl://history') },
    { label: 'Downloads', icon: Download, onSelect: () => owl.newTab('owl://downloads') },
    { label: 'Bookmarks', icon: Bookmark, kbd: 'Ctrl+Shift+O', onSelect: () => owl.newTab('owl://bookmarks') },
    { separator: true },
    { label: 'Find in page', icon: Search, kbd: 'Ctrl+F', disabled: !tab || !!tab.internal, onSelect: () => (store.findOpen = true) },
    { label: 'Zoom in', icon: ZoomIn, kbd: 'Ctrl+=', disabled: !tab || !!tab.internal, onSelect: () => tab && owl.zoom(tab.id, 0.1) },
    { label: 'Zoom out', icon: ZoomOut, kbd: 'Ctrl+-', disabled: !tab || !!tab.internal, onSelect: () => tab && owl.zoom(tab.id, -0.1) },
    { label: store.win.splitTabId ? 'Exit split view' : 'Split view', icon: Columns2, kbd: 'Ctrl+Shift+S', disabled: store.win.tabs.length < 2 && !store.win.splitTabId, onSelect: splitToggle },
    { label: 'Print…', icon: Printer, kbd: 'Ctrl+P', disabled: !tab || !!tab.internal, onSelect: () => tab && owl.print(tab.id) },
    { label: 'Developer tools', icon: Code, kbd: 'F12', disabled: !tab || !!tab.internal, onSelect: () => tab && owl.devtools(tab.id) },
    { separator: true },
    { label: 'Settings', icon: Settings, onSelect: () => owl.newTab('owl://settings') },
  ]);
  function splitToggle() {
    if (store.win.splitTabId) return owl.setSplit(null);
    const other = store.win.tabs.find((t) => t.id !== store.win.activeTabId && !t.internal) ?? store.win.tabs.find((t) => t.id !== store.win.activeTabId);
    if (other) owl.setSplit(other.id);
  }
</script>

<div class="bar drag" class:modern class:mac={mac && !store.sidebarOpen}>
  {#if modern && !store.sidebarOpen}
    <div class="no-drag"><IconButton icon={PanelLeft} label="Show sidebar" kbd={'Ctrl+\\'} onclick={() => (store.sidebarOpen = true)} /></div>
  {/if}
  <div class="nav no-drag">
    <IconButton icon={ArrowLeft} label="Back" kbd="Alt+Left" disabled={!tab?.canGoBack} onclick={() => tab && owl.back(tab.id)} />
    <IconButton icon={ArrowRight} label="Forward" kbd="Alt+Right" disabled={!tab?.canGoForward} onclick={() => tab && owl.forward(tab.id)} />
    {#if tab?.loading}
      <IconButton icon={X} label="Stop loading" onclick={() => tab && owl.stop(tab.id)} />
    {:else}
      <IconButton icon={RotateCw} label="Reload" kbd="Ctrl+R" disabled={!tab || tab.internal === 'newtab'} onclick={() => tab && owl.reload(tab.id)} />
    {/if}
  </div>

  <div class="mid"><Omnibox /></div>

  <div class="right no-drag">
    <AgentsIndicator />
    <DownloadsButton />
    <Tooltip text={store.panelOpen ? `Hide ${comp?.name ?? 'companion'}` : `Ask ${comp?.name ?? 'companion'}`} kbd="Ctrl+J">
      {#snippet children(p)}
        <button {...p} class="comp" class:on={store.panelOpen} aria-pressed={store.panelOpen} aria-label="Toggle companion panel"
          onclick={() => (store.panelOpen = !store.panelOpen)}>
          <CompanionAvatar companion={comp} size={22} />
          <span>{comp?.name ?? 'Hoot'}</span>
        </button>
      {/snippet}
    </Tooltip>
    <Menu items={more} overlay width={240}>
      {#snippet trigger(p)}<IconButton icon={Ellipsis} label="More" {...p} />{/snippet}
    </Menu>
    {#if !store.sidebarOpen}
      <Popover bind:open={profileOpen} width={300}>
        {#snippet trigger(p)}
          <button {...p} class="me" aria-label="Profile and appearance">{profile.initial}</button>
        {/snippet}
        {#snippet children({ close })}<ProfileMenu {close} />{/snippet}
      </Popover>
    {/if}
  </div>
  {#if modern}<div class="wc-space" aria-hidden="true"></div>{/if}
</div>

<style>
  .bar { display: flex; align-items: center; gap: 6px; height: 44px; padding: 0 8px; flex: none; }
  .bar.modern { height: 44px; }
  .bar.modern.mac { padding-left: 80px; }
  .nav { display: flex; align-items: center; gap: 1px; }
  .mid { flex: 1; min-width: 0; display: flex; justify-content: center; padding: 0 12px; }
  .right { display: flex; align-items: center; gap: 4px; }
  .wc-space { width: 132px; flex: none; }
  :global(.platform-darwin) .wc-space { display: none; }
  .comp {
    display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 11px 0 4px; border-radius: 999px; border: 0;
    background: transparent; color: var(--ink-2); font: inherit; font-size: 12.5px; font-weight: 500;
    transition: background-color .15s, color .15s;
  }
  .comp:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); }
  .comp.on { background: var(--surface); color: var(--ink); box-shadow: 0 0 0 1px var(--line), 0 1px 2px rgba(0,0,0,.05); }
  .me { display: grid; place-items: center; width: 26px; height: 26px; margin-left: 2px; border-radius: 99px; border: 0; background: var(--accent); color: var(--accent-ink); font-size: 12px; font-weight: 600; }
  .me:hover { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
</style>
