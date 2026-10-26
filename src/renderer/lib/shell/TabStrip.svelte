<script lang="ts">
  import { owl } from '../api';
  import { store } from '../stores.svelte';
  import { IconButton, ContextMenu } from '../ui';
  import { PanelLeft, Plus, X, Volume2, VolumeX } from '@lucide/svelte';
  import TabIcon from './TabIcon.svelte';
  import { tabMenu, drag } from './tabActions';
  import type { TabState } from '$shared/types';

  const mac = owl.platform === 'darwin';
  let over = $state<{ id: number; after: boolean } | null>(null);

  function onAux(e: MouseEvent, t: TabState) { if (e.button === 1) { e.preventDefault(); owl.closeTab(t.id); } }
  function onDragStart(e: DragEvent, t: TabState) { drag.id = t.id; e.dataTransfer?.setData('text/owl-tab', String(t.id)); e.dataTransfer!.effectAllowed = 'move'; }
  function onDragOver(e: DragEvent, t: TabState) {
    if (drag.id < 0) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    over = { id: t.id, after: e.clientX > r.left + r.width / 2 };
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (drag.id < 0 || !over) return;
    const tabs = store.win.tabs;
    const from = tabs.findIndex((x) => x.id === drag.id);
    let to = tabs.findIndex((x) => x.id === over!.id) + (over.after ? 1 : 0);
    if (from < to) to--;
    if (from !== to) owl.moveTab(drag.id, to);
    drag.id = -1; over = null;
  }
  function onKey(e: KeyboardEvent, t: TabState) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); owl.activateTab(t.id); }
    else if (e.key === 'Delete') owl.closeTab(t.id);
  }
</script>

<div class="strip drag" class:mac={mac && !store.sidebarOpen} role="presentation" ondblclick={(e) => { if (e.target === e.currentTarget) owl.windowControl('maximize'); }}>
  {#if !store.sidebarOpen}
    <div class="no-drag flex items-center pl-1.5">
      <IconButton icon={PanelLeft} label="Show sidebar" kbd={'Ctrl+\\'} size="sm" onclick={() => (store.sidebarOpen = true)} />
    </div>
  {/if}

  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div class="tabs" role="tablist" aria-label="Tabs" ondragleave={() => (over = null)}>
    {#each store.win.tabs as t (t.id)}
      {@const active = t.id === store.win.activeTabId}
      {@const split = t.id === store.win.splitTabId}
      <ContextMenu items={() => tabMenu(t)}>
        {#snippet children(cp)}
          <div {...cp} role="tab" tabindex={active ? 0 : -1} aria-selected={active} title={t.title}
            class="tab no-drag" class:active class:split class:pinned={t.pinned} class:sleeping={t.sleeping} class:agent={!!t.agentId}
            class:drop-before={over?.id === t.id && !over.after} class:drop-after={over?.id === t.id && over.after}
            draggable="true" ondragstart={(e) => onDragStart(e, t)} ondragover={(e) => onDragOver(e, t)} ondrop={onDrop} ondragend={() => { drag.id = -1; over = null; }}
            onmousedown={(e) => { if (e.button === 0) owl.activateTab(t.id); }} onauxclick={(e) => onAux(e, t)} onkeydown={(e) => onKey(e, t)}>
            <TabIcon tab={t} size={15} />
            {#if !t.pinned}
              <span class="title">{t.title || t.url}</span>
              {#if t.audible || t.muted}
                <button class="mini" aria-label={t.muted ? 'Unmute tab' : 'Mute tab'} onmousedown={(e) => e.stopPropagation()} onclick={() => owl.muteTab(t.id)}>
                  {#if t.muted}<VolumeX size={13} strokeWidth={1.8} />{:else}<Volume2 size={13} strokeWidth={1.8} />{/if}
                </button>
              {/if}
              <button class="mini close" aria-label="Close tab" onmousedown={(e) => e.stopPropagation()} onclick={() => owl.closeTab(t.id)}>
                <X size={13} strokeWidth={2} />
              </button>
            {/if}
          </div>
        {/snippet}
      </ContextMenu>
    {/each}
    <div class="no-drag flex items-center pl-0.5">
      <IconButton icon={Plus} label="New tab" kbd="Ctrl+T" size="sm" onclick={() => owl.newTab()} />
    </div>
  </div>
  <!-- window controls (titleBarOverlay) live here on Windows -->
  <div class="wc-space" aria-hidden="true"></div>
</div>

<style>
  .strip { height: 38px; display: flex; align-items: center; gap: 4px; padding-right: 0; flex: none; }
  .strip.mac { padding-left: 78px; }
  .wc-space { width: 140px; flex: none; height: 100%; }
  .strip.mac .wc-space { width: 12px; }
  .tabs { flex: 1; min-width: 0; display: flex; align-items: center; gap: 2px; height: 100%; overflow: hidden; padding: 0 2px 0 6px; }
  .tab {
    position: relative; display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 6px 0 10px;
    flex: 1 1 200px; min-width: 44px; max-width: 220px; border-radius: 10px; color: var(--ink-2); font-size: 12.5px;
    transition: background-color .15s var(--ease-out), color .15s, opacity .2s;
  }
  .tab.pinned { flex: 0 0 38px; min-width: 38px; padding: 0; justify-content: center; }
  .tab:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); color: var(--ink); }
  .tab.active {
    background: var(--tab-active); color: var(--ink);
    box-shadow: 0 1px 2px rgba(0,0,0,.06), 0 0 0 1px var(--line), inset 0 1px 0 rgba(255,255,255,.5);
  }
  :global(.dark) .tab.active { box-shadow: 0 1px 2px rgba(0,0,0,.4), 0 0 0 1px var(--line), inset 0 1px 0 rgba(255,255,255,.05); }
  .tab.split:not(.active) { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 14%, transparent); }
  .tab.sleeping { opacity: .5; }
  .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; mask-image: linear-gradient(90deg, #000 85%, transparent); }
  .mini { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; flex: none; color: var(--ink-2); background: transparent; border: 0; }
  .mini:hover { background: color-mix(in srgb, var(--ink) 9%, transparent); color: var(--ink); }
  .close { opacity: 0; }
  .tab:hover .close, .tab.active .close, .close:focus-visible { opacity: 1; }
  .drop-before::after, .drop-after::after { content: ''; position: absolute; top: 6px; bottom: 6px; width: 2px; border-radius: 2px; background: var(--accent); }
  .drop-before::after { left: -2px; }
  .drop-after::after { right: -2px; }
</style>
