<script lang="ts">
  import { owl, faviconFor } from '../api';
  import { store } from '../stores.svelte';
  import { ContextMenu, type MenuItem } from '../ui';
  import { ExternalLink, Trash2, Bookmark as BIcon } from '@lucide/svelte';
  import type { Bookmark } from '$shared/types';

  let items = $state<Bookmark[]>([]);
  const load = () => owl.bookmarks().then((b: any) => (items = (b || []).filter((x: Bookmark) => !x.folder || x.folder === 'bar' || x.folder === 'Bookmarks bar')));
  load();
  $effect(() => owl.on((type, p) => { if (type === 'command' && (p?.cmd === 'bookmark-added' || p?.cmd === 'bookmark-changed')) load(); }));

  function open(b: Bookmark, e: MouseEvent) {
    const tab = store.activeTab;
    if (e.ctrlKey || e.metaKey || e.button === 1) owl.newTab(b.url, { background: true });
    else if (tab && tab.internal !== 'newtab' && !tab.internal) owl.navigate(tab.id, b.url);
    else if (tab) owl.navigate(tab.id, b.url);
    else owl.newTab(b.url);
  }
  const menu = (b: Bookmark): MenuItem[] => [
    { label: 'Open in new tab', icon: ExternalLink, onSelect: () => owl.newTab(b.url) },
    { separator: true },
    { label: 'Delete', icon: Trash2, danger: true, onSelect: async () => { await owl.removeBookmark(b.id); load(); } },
  ];
</script>

<nav class="bm" aria-label="Bookmarks bar">
  {#if items.length}
    {#each items as b (b.id)}
      <ContextMenu items={() => menu(b)}>
        {#snippet children(p)}
          <button {...p} class="b" title={b.url} onclick={(e) => open(b, e)} onauxclick={(e) => open(b, e)}>
            <img src={faviconFor(b.url, b.favicon)} alt="" width="14" height="14" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
            <span>{b.title || b.url}</span>
          </button>
        {/snippet}
      </ContextMenu>
    {/each}
  {:else}
    <span class="hint"><BIcon size={13} strokeWidth={1.8} />Press Ctrl+D to bookmark a page — it shows up here.</span>
  {/if}
</nav>

<style>
  .bm { display: flex; align-items: center; gap: 2px; height: 30px; padding: 0 10px; overflow: hidden; flex: none; }
  .b { display: inline-flex; align-items: center; gap: 7px; height: 24px; max-width: 180px; padding: 0 9px; border-radius: 8px; border: 0; background: transparent; color: var(--ink-2); font: inherit; font-size: 12.5px; flex: none; }
  .b:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); }
  .b span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .b img { border-radius: 3px; flex: none; }
  .hint { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-3); padding-left: 4px; }
</style>
