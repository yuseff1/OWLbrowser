<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { owl } from '../api';
  import { store } from '../stores.svelte';
  import { ContextMenu, Badge } from '../ui';
  import TabIcon from './TabIcon.svelte';
  import { tabMenu, drag, runFor, dropTab } from './tabActions';
  import { hostOf } from '../api';
  import { statusLabel, runWaiting } from './prefs.svelte';
  import type { TabState, TabGroup } from '$shared/types';
  import GroupChip from './GroupChip.svelte';
  import { stripItems, groupStyle } from './groups';

  const pinned = $derived(store.win.tabs.filter((t) => t.pinned));
  const agentTabs = $derived(store.win.tabs.filter((t) => !t.pinned && t.agentId));
  const normal = $derived(store.win.tabs.filter((t) => !t.pinned && !t.agentId));
  const items = $derived(stripItems(normal, store.win.groups ?? []));
  let over = $state<{ id: number; after: boolean } | null>(null);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (drag.id < 0 || !over) return;
    dropTab(over.id, over.after);
    drag.id = -1; over = null;
  }
  function onOver(e: DragEvent, t: TabState) {
    if (drag.id < 0) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    over = { id: t.id, after: e.clientY > r.top + r.height / 2 };
  }
</script>

{#snippet row(t: TabState, g: TabGroup | null = null)}
  {@const active = t.id === store.win.activeTabId}
  {@const run = runFor(t)}
  <ContextMenu items={() => tabMenu(t)}>
    {#snippet children(cp)}
      <div {...cp} role="tab" tabindex={active ? 0 : -1} aria-selected={active} title={t.internal ? t.title : `${t.title}\n${hostOf(t.url)}`}
        class="vt" class:grouped={!!g} style={g ? groupStyle(g.color) : undefined} class:active class:sleeping={t.sleeping} class:split={t.id === store.win.splitTabId}
        class:drop-before={over?.id === t.id && !over.after} class:drop-after={over?.id === t.id && over.after}
        draggable="true" ondragstart={() => (drag.id = t.id)} ondragover={(e) => onOver(e, t)} ondrop={onDrop} ondragend={() => { drag.id = -1; over = null; }}
        onmousedown={(e) => { if (e.button === 0) owl.activateTab(t.id); else if (e.button === 1) e.preventDefault(); }}
        onauxclick={(e) => { if (e.button === 1) owl.closeTab(t.id); }}
        onkeydown={(e) => { if (e.key === 'Enter') owl.activateTab(t.id); }}>
        <TabIcon tab={t} size={15} />
        <span class="title">{t.title || t.url}</span>
        {#if run && runWaiting(run.status)}<Badge variant="warn" dot>Needs you</Badge>{:else if run}<span class="live" style:--cc={store.companions.find((c) => c.id === run.companionId)?.look.body} title={statusLabel(run.status)}></span>{/if}
        {#if t.audible || t.muted}
          <button class="mini" aria-label={t.muted ? 'Unmute tab' : 'Mute tab'} onmousedown={(e) => e.stopPropagation()} onclick={() => owl.muteTab(t.id)}>
            {#if t.muted}<Icon name="speaker-mute" size={14} />{:else}<Icon name="speaker-2" size={14} />{/if}
          </button>
        {/if}
        <button class="mini close" aria-label="Close tab" onmousedown={(e) => e.stopPropagation()} onclick={() => owl.closeTab(t.id)}><Icon name="dismiss" size={14} /></button>
      </div>
    {/snippet}
  </ContextMenu>
{/snippet}

<div class="vtabs" role="tablist" aria-orientation="vertical" aria-label="Tabs">
  {#if pinned.length}
    <div class="pins">
      {#each pinned as t (t.id)}
        <button class="pin" class:active={t.id === store.win.activeTabId} title={t.title} aria-label={t.title} onclick={() => owl.activateTab(t.id)}>
          <TabIcon tab={t} size={16} />
        </button>
      {/each}
    </div>
  {/if}

  <button class="newtab" onclick={() => owl.newTab()}><Icon name="add" size={16} />New tab</button>

  {#if agentTabs.length}
    <div class="grp">Agents at work</div>
    {#each agentTabs as t (t.id)}{@render row(t)}{/each}
    <div class="grp">Tabs</div>
  {/if}
  {#each items as it (it.kind === 'chip' ? 'g:' + it.group.id : it.tab.id)}
    {#if it.kind === 'chip'}<GroupChip group={it.group} count={it.count} vertical />{:else}{@render row(it.tab, it.group)}{/if}
  {/each}
</div>

<style>
  .vtabs { display: flex; flex-direction: column; gap: 1px; }
  .pins { display: grid; grid-template-columns: repeat(auto-fill, minmax(40px, 1fr)); gap: 4px; margin-bottom: 8px; }
  .pin { display: grid; place-items: center; height: 36px; border-radius: 10px; border: 0; background: color-mix(in srgb, var(--ink) 5%, transparent); }
  .pin:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); }
  .pin.active { background: var(--tab-active) var(--glass-sheen); box-shadow: var(--glass-rim), 0 0 0 1px var(--glass-edge), 0 1px 2px rgba(0,0,0,.06); }
  .newtab { display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 10px; border-radius: 10px; border: 0; background: transparent; color: var(--ink-2); font: inherit; font-size: 13px; }
  .newtab:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); }
  .grp { padding: 12px 10px 4px; font-size: 11.5px; font-weight: 500; color: var(--ink-3); }
  .vt { position: relative; display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 4px 0 10px; border-radius: 10px; color: var(--ink-2); font-size: 13px; }
  .vt:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); color: var(--ink); }
  .vt.active { background: var(--tab-active) var(--glass-sheen); color: var(--ink); box-shadow: var(--glass-rim), 0 0 0 1px var(--glass-edge), 0 1px 2px rgba(0,0,0,.05); }
  .vt.split:not(.active) { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 14%, transparent); }
  .vt.sleeping { opacity: .5; }
  /* grouped rows: indented under the chip with the group's colour as a rail */
  .vt.grouped { --gc: var(--gc-l); margin-left: 12px; }
  :global(.dark) .vt.grouped { --gc: var(--gc-d); }
  .vt.grouped::after { content: ''; position: absolute; left: -8px; top: 3px; bottom: 3px; width: 2px; border-radius: 2px; background: var(--gc); }
  .live { width: 7px; height: 7px; margin-right: 6px; border-radius: 99px; background: var(--cc, var(--accent)); flex: none; animation: owl-pulse 1.6s ease-in-out infinite; }
  .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mini { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; border: 0; background: transparent; color: var(--ink-2); flex: none; }
  .mini:hover { background: color-mix(in srgb, var(--ink) 9%, transparent); }
  .close { opacity: 0; }
  .vt:hover .close, .vt.active .close { opacity: 1; }
  .drop-before::before, .drop-after::before { content: ''; position: absolute; left: 8px; right: 8px; height: 2px; border-radius: 2px; background: var(--accent); }
  .drop-before::before { top: -1px; }
  .drop-after::before { bottom: -1px; }
</style>
