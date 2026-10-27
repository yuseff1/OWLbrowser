<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import type { IconName } from '../ui/icons';
  import type { TabState } from '$shared/types';
  import { faviconFor, art } from '../api';
  import { CompanionAvatar, Spinner } from '../ui';

  let { tab, size = 16 }: { tab: TabState; size?: number } = $props();
  const internalIcon = {
    settings: 'settings', history: 'clock', downloads: 'arrow-download', bookmarks: 'bookmark', memory: 'brain-circuit', routines: 'arrow-repeat-all',
    skills: 'sparkle', apps: 'apps', library: 'library', chats: 'chat-multiple', agents: 'bot', artifact: 'document-text', companions: 'people',
  } as Record<string, IconName>;
  const src = $derived(tab.internal ? '' : faviconFor(tab.url, tab.favicon));
  let broken = $state(false);
  $effect(() => { src; broken = false; });
  const ic = $derived<IconName | null>(tab.internal ? internalIcon[tab.internal] : null);
</script>

{#if tab.agentId}
  <CompanionAvatar companion={tab.agentId} size={size + 2} ring />
{:else if tab.loading}
  <span class="grid place-items-center text-ink-2" style:width="{size}px" style:height="{size}px"><Spinner size={size - 2} /></span>
{:else if tab.internal === 'newtab'}
  <img src={art.mark} alt="" width={size} height={size} class="owl-mark" draggable="false" />
{:else if ic}
  <span class="grid place-items-center text-ink-2" style:width="{size}px" style:height="{size}px"><Icon name={ic} {size} /></span>
{:else if src && !broken}
  <img {src} alt="" width={size} height={size} class="rounded-[4px]" draggable="false" onerror={() => (broken = true)} />
{:else}
  <span class="grid place-items-center text-ink-3" style:width="{size}px" style:height="{size}px"><Icon name="globe" size={size - 2} /></span>
{/if}

<style>
  img { flex: none; object-fit: contain; }
  span { flex: none; }
</style>
