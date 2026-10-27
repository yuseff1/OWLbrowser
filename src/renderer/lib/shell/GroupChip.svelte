<script lang="ts">
  /**
   * Tab-group chip (Chrome-style). Click collapses / expands the group; right-click (or Enter) opens the
   * group editor: name, colour, new tab in group, ungroup, close group.
   */
  import Icon from '../ui/Icon.svelte';
  import { Popover } from '../ui';
  import { owl } from '../api';
  import { store } from '../stores.svelte';
  import { GROUP_COLORS, GROUP_COLOR_ORDER, groupStyle, groupLabel } from './groups';
  import type { TabGroup, TabGroupColor } from '$shared/types';

  let { group, count, vertical = false }: { group: TabGroup; count: number; vertical?: boolean } = $props();
  let open = $state(false);
  let name = $state('');
  let nameEl = $state<HTMLInputElement | null>(null);

  $effect(() => { if (open) { name = group.title; queueMicrotask(() => { nameEl?.focus(); nameEl?.select(); }); } });
  function commit() { if (name.trim() !== group.title) owl.updateGroup(group.id, { title: name.trim() }); }
  const toggle = () => owl.updateGroup(group.id, { collapsed: !group.collapsed });
  const setColor = (c: TabGroupColor) => owl.updateGroup(group.id, { color: c });
  async function newTabInGroup(close: () => void) {
    commit();
    const id = (await owl.newTab('owl://newtab')) as number;
    if (id != null) owl.groupTabs([id], group.id);
    close();
  }
  const label = $derived(groupLabel(group, count));
</script>

<Popover bind:open width={264} align="start" side={vertical ? 'right' : 'bottom'} onOpenChange={(o) => { if (!o) commit(); }}>
  {#snippet trigger(p)}
    <button {...p} type="button" class="chip no-drag" class:vertical class:collapsed={group.collapsed} class:untitled={!group.title} style={groupStyle(group.color)}
      data-group-id={group.id} aria-expanded={!group.collapsed} aria-label="{label} — tab group, {group.collapsed ? 'collapsed' : 'expanded'}. Right-click to edit"
      title={group.collapsed ? `${label} · ${count} hidden` : label}
      onclick={(e) => { e.preventDefault(); toggle(); }}
      oncontextmenu={(e) => { e.preventDefault(); open = true; }}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); open = true; } else if (e.key === ' ') { e.preventDefault(); toggle(); } }}>
      <span class="dot" aria-hidden="true"></span>
      {#if group.title}<span class="name">{group.title}</span>{:else if vertical}<span class="name muted">{label}</span>{/if}
      {#if group.collapsed && !(vertical && !group.title)}<span class="count tnum">{count}</span>{/if}
      {#if vertical}<Icon name={group.collapsed ? 'chevron-right' : 'chevron-down'} size={12} class="chev" />{/if}
    </button>
  {/snippet}
  {#snippet children({ close })}
    <div class="editor" style={groupStyle(group.color)}>
      <input bind:this={nameEl} bind:value={name} class="field" placeholder="Name this group" maxlength="60" spellcheck="false" aria-label="Group name"
        onkeydown={(e) => { if (e.key === 'Enter') { commit(); close(); } }} />
      <div class="swatches" role="radiogroup" aria-label="Group colour">
        {#each GROUP_COLOR_ORDER as c (c)}
          <button type="button" role="radio" aria-checked={group.color === c} aria-label={GROUP_COLORS[c].name} title={GROUP_COLORS[c].name}
            class="sw" class:on={group.color === c} style={groupStyle(c)} onclick={() => setColor(c)}>
            {#if group.color === c}<Icon name="checkmark" size={12} />{/if}
          </button>
        {/each}
      </div>
      <div class="acts">
        <button type="button" class="act" onclick={() => newTabInGroup(close)}><Icon name="add" size={16} />New tab in group</button>
        <button type="button" class="act" onclick={() => { commit(); toggle(); close(); }}><Icon name={group.collapsed ? 'chevron-down' : 'chevron-up'} size={16} />{group.collapsed ? 'Expand group' : 'Collapse group'}</button>
        <button type="button" class="act" onclick={() => { owl.ungroupTabs(store.win.tabs.filter((t) => t.groupId === group.id).map((t) => t.id)); close(); }}><Icon name="subtract" size={16} />Ungroup</button>
        <button type="button" class="act danger" onclick={() => { owl.closeGroup(group.id); close(); }}><Icon name="dismiss" size={16} />Close group</button>
      </div>
    </div>
  {/snippet}
</Popover>

<style>
  .chip, .editor, .sw { --gc: var(--gc-l); }
  :global(.dark) .chip, :global(.dark) .editor, :global(.dark) .sw { --gc: var(--gc-d); }
  .chip {
    position: relative; flex: none; display: inline-flex; align-items: center; gap: 6px; height: 22px; max-width: 150px; padding: 0 8px;
    border: 0; border-radius: 7px; font: inherit; font-size: 12px; font-weight: 600; letter-spacing: .005em; color: var(--ink);
    background: color-mix(in srgb, var(--gc) 20%, transparent); margin: 0 2px 0 4px;
    transition: background-color .15s var(--ease-out), transform .12s var(--ease-out);
  }
  .chip:hover { background: color-mix(in srgb, var(--gc) 30%, transparent); }
  .chip:active { transform: scale(.97); }
  .chip:focus-visible { outline: 2px solid var(--gc); outline-offset: 1px; }
  .chip.untitled:not(.vertical):not(.collapsed) { padding: 0; width: 22px; justify-content: center; }
  /* the group's underline starts under the chip and runs on under its tabs (TabStrip .grouped) */
  .chip:not(.vertical):not(.collapsed)::after { content: ''; position: absolute; left: 50%; right: -6px; bottom: -7px; height: 2px; border-radius: 2px 0 0 2px; background: var(--gc); }
  .dot { width: 8px; height: 8px; border-radius: 99px; background: var(--gc); flex: none; }
  .name { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name.muted { font-weight: 500; color: var(--ink-2); }
  .count { font-size: 11px; font-weight: 500; color: var(--ink-2); }
  .chip.vertical { display: flex; width: calc(100% - 4px); max-width: none; height: 28px; margin: 6px 2px 2px; padding: 0 8px 0 10px; border-radius: 9px; background: transparent; }
  .chip.vertical:hover { background: color-mix(in srgb, var(--gc) 14%, transparent); }
  .chip.vertical .name { flex: 1; text-align: left; }
  .chip.vertical :global(.chev) { color: var(--ink-3); flex: none; }

  .editor { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
  .field { height: 32px; padding: 0 10px; border-radius: 9px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font: inherit; font-size: 13px; outline: none; }
  .field:focus { border-color: var(--gc); box-shadow: 0 0 0 3px color-mix(in srgb, var(--gc) 22%, transparent); }
  .swatches { display: grid; grid-template-columns: repeat(9, 1fr); gap: 4px; }
  .sw { display: grid; place-items: center; aspect-ratio: 1; border-radius: 99px; border: 0; background: var(--gc); color: #fff; padding: 0; }
  .sw:hover { box-shadow: 0 0 0 2px color-mix(in srgb, var(--gc) 35%, transparent); }
  .sw.on { box-shadow: 0 0 0 2px var(--surface), 0 0 0 3.5px var(--gc); }
  .sw:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  .acts { display: flex; flex-direction: column; border-top: 1px solid var(--line); padding-top: 6px; margin: 0 -6px; }
  .act { display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 8px; border: 0; border-radius: 8px; background: transparent; color: var(--ink); font: inherit; font-size: 13px; text-align: left; }
  .act:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); }
  .act :global(svg) { color: var(--ink-2); }
  .act.danger { color: var(--danger, #c8564f); }
  .act.danger :global(svg) { color: inherit; }
</style>
