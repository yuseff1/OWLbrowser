<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { owl } from '../api';
  import { store } from '../stores.svelte';
  import { IconButton, Popover, CompanionAvatar } from '../ui';
  import OwlMark from './OwlMark.svelte';
  import VerticalTabs from './VerticalTabs.svelte';
  import ProfileMenu from './ProfileMenu.svelte';
  import { profile } from './profile.svelte';
  import { threads } from '../threads.svelte';

  let { modern = false }: { modern?: boolean } = $props();
  let profileOpen = $state(false);
  const mac = owl.platform === 'darwin';
  const internal = $derived(store.activeTab?.internal);
  const live = $derived(store.liveRuns.length);

  const nav = [
    { id: 'chats', label: 'Chat history', icon: 'chat-multiple' },
    { id: 'agents', label: 'Agents', icon: 'bot' },
    { id: 'routines', label: 'Routines', icon: 'arrow-repeat-all' },
    { id: 'skills', label: 'Skills', icon: 'sparkle' },
    { id: 'apps', label: 'Apps', icon: 'apps' },
    { id: 'library', label: 'Library', icon: 'library' },
  ] as const;

  function openPage(id: string) {
    const existing = store.win.tabs.find((t) => t.internal === id);
    if (existing) owl.activateTab(existing.id);
    else if (store.activeTab?.internal === 'newtab') owl.navigate(store.activeTab.id, `owl://${id}`);
    else owl.newTab(`owl://${id}`);
  }
  function newChat() { threads.clear(); store.panelOpen = true; store.panelPrefill = ''; }
  function openThread(id: string) { threads.open(id); store.panelOpen = true; }
</script>

<aside class="side" aria-label="Sidebar">
  <div class="head drag" class:modern class:mac>
    <span class="brand"><OwlMark size={20} /><span>OWL</span></span>
    <span class="no-drag ml-auto">
      <IconButton icon="panel-left-contract" label="Hide sidebar" kbd={'Ctrl+\\'} size="sm" onclick={() => (store.sidebarOpen = false)} />
    </span>
  </div>

  <nav class="nav" aria-label="OWL">
    <button class="item" onclick={newChat}><Icon name="compose" size={16} /><span>New chat</span></button>
    {#each nav as n (n.id)}
      <button class="item" class:active={internal === n.id} aria-current={internal === n.id ? 'page' : undefined} onclick={() => openPage(n.id)}>
        <Icon name={n.icon} size={16} filled={internal === n.id} /><span>{n.label}</span>
        {#if n.id === 'agents' && live}<span class="count tnum" aria-label="{live} running">{live}</span>{/if}
      </button>
    {/each}
  </nav>

  <div class="scroll">
    {#if modern}
      <VerticalTabs />
    {:else}
      <div class="grp">Recent chats</div>
      {#if store.win.incognito}
        <p class="empty">Recent chats are hidden in incognito.</p>
      {:else if threads.recent.length}
        {#each threads.recent as t (t.id)}
          <button class="chat" class:active={store.panelOpen && threads.currentId === t.id} onclick={() => openThread(t.id)} title={t.title}>
            <CompanionAvatar companion={t.companionId} size={16} />
            <span class="truncate">{t.title}</span>
          </button>
        {/each}
      {:else}
        <p class="empty">Chats with your companions show up here.</p>
      {/if}
    {/if}
  </div>

  <div class="foot">
    <Popover bind:open={profileOpen} side="top" align="start" width={300}>
      {#snippet trigger(p)}
        <button {...p} class="me" data-profile-button aria-label="Profile and appearance">
          <span class="av">{profile.initial}</span>
          <span class="min-w-0 flex-1 text-left">
            <span class="block truncate text-[13px] font-medium text-ink">{profile.name}</span>
            <span class="block truncate text-[11.5px] text-ink-3">{store.win.incognito ? 'Incognito' : profile.subtitle}</span>
          </span>
          <Icon name="chevron-up-down" size={14} class="text-ink-3" />
        </button>
      {/snippet}
      {#snippet children({ close })}<ProfileMenu {close} />{/snippet}
    </Popover>
  </div>
</aside>

<style>
  .side { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; padding: 0 8px 8px; }
  .head { display: flex; align-items: center; height: 38px; padding: 0 2px 0 8px; flex: none; }
  .head.modern { height: 44px; }
  .head.mac { padding-left: 76px; }
  .head.mac .brand span { display: none; }
  .brand { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-display); font-weight: 650; font-size: 14px; letter-spacing: 0.02em; color: var(--ink); }
  .nav { display: flex; flex-direction: column; gap: 1px; padding-bottom: 6px; }
  .item { display: flex; align-items: center; gap: 11px; height: 34px; padding: 0 10px; border-radius: 10px; border: 0; background: transparent; color: var(--ink-2); font: inherit; font-size: 13.5px; text-align: left; }
  .item:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); color: var(--ink); }
  .item.active { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink); }
  .item :global(svg) { flex: none; }
  .count { margin-left: auto; min-width: 20px; height: 18px; padding: 0 6px; border-radius: 99px; background: var(--accent); color: var(--accent-ink); font-size: 11px; font-weight: 600; line-height: 18px; text-align: center; }
  .scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; margin: 0 -4px; padding: 4px 4px 8px; border-top: 1px solid var(--line); }
  .grp { padding: 10px 10px 4px; font-size: 11.5px; font-weight: 500; color: var(--ink-3); }
  .chat { display: flex; align-items: center; gap: 10px; width: 100%; height: 32px; padding: 0 10px; border-radius: 10px; border: 0; background: transparent; color: var(--ink-2); font: inherit; font-size: 13px; text-align: left; }
  .chat:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); color: var(--ink); }
  .chat.active { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink); }
  .empty { padding: 6px 10px; font-size: 12.5px; color: var(--ink-3); line-height: 1.45; }
  .foot { flex: none; padding-top: 6px; border-top: 1px solid var(--line); }
  .me { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 8px; border-radius: 12px; border: 0; background: transparent; font: inherit; }
  .me:hover, .me[data-state='open'] { background: color-mix(in srgb, var(--ink) 5%, transparent); }
  .av { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 99px; background: var(--accent); color: var(--accent-ink); font-size: 13px; font-weight: 600; flex: none; }
</style>
