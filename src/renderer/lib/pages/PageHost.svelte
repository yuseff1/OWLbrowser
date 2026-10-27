<script lang="ts">
  /**
   * Internal page router (owned by the shell). Maps tab.internal → page component, loaded lazily.
   * import.meta.glob means a page that does not exist yet never breaks the build; it shows a quiet placeholder.
   */
  import type { Component } from 'svelte';
  import type { TabState } from '$shared/types';
  import { Spinner, Empty } from '../ui';

  let { tab }: { tab: TabState } = $props();

  const modules = import.meta.glob('./*.svelte') as Record<string, () => Promise<{ default: Component<any> }>>;
  const NAMES: Record<string, string> = {
    newtab: 'NewTab', settings: 'Settings', companions: 'Companions', history: 'History', downloads: 'Downloads',
    bookmarks: 'Bookmarks', memory: 'Memory', routines: 'Routines', artifact: 'Artifact', skills: 'Skills',
    apps: 'Apps', library: 'Library', chats: 'Chats', agents: 'Agents',
  };
  const cache = new Map<string, Promise<Component<any> | null>>();
  function load(name: string) {
    if (!cache.has(name)) {
      const imp = modules[`./${name}.svelte`];
      cache.set(name, imp ? imp().then((m) => m.default).catch((e) => { console.error('[owl] page failed to load', name, e); return null; }) : Promise.resolve(null));
    }
    return cache.get(name)!;
  }
  const name = $derived(NAMES[tab.internal ?? ''] ?? '');
  const page = $derived(name ? load(name) : Promise.resolve(null));
</script>

<div class="host">
  {#await page}
    <div class="grid h-full place-items-center text-ink-3"><Spinner size={18} /></div>
  {:then Page}
    {#if Page}
      <Page {tab} />
    {:else}
      <Empty icon="wrench-screwdriver" title="{name || 'This page'} is on its way" body="This part of OWL isn’t built yet." class="h-full" />
    {/if}
  {/await}
</div>

<style>
  .host { position: absolute; inset: 0; overflow: auto; }
</style>
