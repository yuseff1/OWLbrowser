<script lang="ts">
  import type { TabState } from '$shared/types';
  import { faviconFor, art } from '../api';
  import { CompanionAvatar, Spinner } from '../ui';
  import { Globe, Settings, Clock, Download, Bookmark, Brain, Repeat, Sparkles, Blocks, Library, MessagesSquare, Bot, FileText, Users } from '@lucide/svelte';

  let { tab, size = 16 }: { tab: TabState; size?: number } = $props();
  const internalIcon = {
    settings: Settings, history: Clock, downloads: Download, bookmarks: Bookmark, memory: Brain, routines: Repeat,
    skills: Sparkles, apps: Blocks, library: Library, chats: MessagesSquare, agents: Bot, artifact: FileText, companions: Users,
  } as Record<string, any>;
  const src = $derived(tab.internal ? '' : faviconFor(tab.url, tab.favicon));
  let broken = $state(false);
  $effect(() => { src; broken = false; });
  const Ico = $derived(tab.internal ? internalIcon[tab.internal] : null);
</script>

{#if tab.agentId}
  <CompanionAvatar companion={tab.agentId} size={size + 2} ring />
{:else if tab.loading}
  <span class="grid place-items-center text-ink-2" style:width="{size}px" style:height="{size}px"><Spinner size={size - 2} /></span>
{:else if tab.internal === 'newtab'}
  <img src={art.mark} alt="" width={size} height={size} class="owl-mark" draggable="false" />
{:else if Ico}
  <span class="grid place-items-center text-ink-2" style:width="{size}px" style:height="{size}px"><Ico size={size - 2} strokeWidth={1.8} /></span>
{:else if src && !broken}
  <img {src} alt="" width={size} height={size} class="rounded-[4px]" draggable="false" onerror={() => (broken = true)} />
{:else}
  <span class="grid place-items-center text-ink-3" style:width="{size}px" style:height="{size}px"><Globe size={size - 2} strokeWidth={1.8} /></span>
{/if}

<style>
  img { flex: none; object-fit: contain; }
  span { flex: none; }
</style>
