<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { onMount } from 'svelte';
  import type { TabState, Bookmark } from '$shared/types';
  import { owl, hostOf, faviconFor, timeAgo } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Input, Dialog, IconButton, Empty } from '$lib/ui';
  import Page from './kit/Page.svelte';
  import Field from './kit/Field.svelte';
  import Skel from './kit/Skel.svelte';
  import Note from './kit/Note.svelte';

  let { tab }: { tab: TabState } = $props();

  const ALL = '__all__', NONE = '__none__';
  let items = $state<Bookmark[]>([]);
  let loading = $state(true);
  let error = $state('');
  let q = $state('');
  let folder = $state(ALL);
  let broken = $state<Record<string, boolean>>({});

  async function load() {
    error = '';
    try { items = ((await owl.bookmarks()) as Bookmark[]) || []; } catch (e: any) { error = e?.message || 'Couldn’t load bookmarks.'; }
    loading = false;
  }
  onMount(() => { load(); });

  const folders = $derived.by(() => {
    const m = new Map<string, number>();
    for (const b of items) if (b.folder) m.set(b.folder, (m.get(b.folder) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (a[0] === 'Bookmarks bar' ? -1 : b[0] === 'Bookmarks bar' ? 1 : a[0].localeCompare(b[0])));
  });
  const unsorted = $derived(items.filter((b) => !b.folder).length);
  const shown = $derived.by(() => {
    const n = q.trim().toLowerCase();
    return items
      .filter((b) => (n ? true : folder === ALL ? true : folder === NONE ? !b.folder : b.folder === folder))
      .filter((b) => !n || (b.title + ' ' + b.url).toLowerCase().includes(n))
      .sort((a, b) => b.createdAt - a.createdAt);
  });
  const heading = $derived(q.trim() ? `Results for “${q.trim()}”` : folder === ALL ? 'All bookmarks' : folder === NONE ? 'Other bookmarks' : folder);

  async function remove(b: Bookmark) {
    const prev = items;
    items = items.filter((x) => x.id !== b.id);
    try { await owl.removeBookmark(b.id); store.toast('Bookmark removed'); } catch (e: any) { items = prev; store.toast('Couldn’t remove the bookmark', e?.message, 'error'); }
  }
  function open(b: Bookmark, e: MouseEvent) {
    if (e.ctrlKey || e.metaKey || e.button === 1) owl.newTab(b.url, { background: true });
    else owl.navigate(tab.id, b.url);
  }

  // ---- rename
  let editOpen = $state(false);
  let editing = $state<Bookmark | null>(null);
  let title = $state('');
  let saving = $state(false);
  function rename(b: Bookmark) { editing = b; title = b.title; editOpen = true; }
  async function saveRename() {
    const b = editing; const t = title.trim();
    if (!b || !t) return;
    saving = true;
    try {
      const api = owl as any;
      if (typeof api.renameBookmark === 'function') await api.renameBookmark(b.id, t);
      else { await owl.removeBookmark(b.id); await owl.toggleBookmark(b.url, t, b.favicon); }
      await load();
      editOpen = false;
    } catch (e: any) { store.toast('Couldn’t rename', e?.message, 'error'); }
    saving = false;
  }
</script>

<Page title="Bookmarks" description="Sites you saved. Press Ctrl+D on any page to add it." width={980}>
  {#snippet actions()}
    <Button variant="secondary" icon="arrow-download" onclick={() => owl.newTab('owl://settings#import')}>Import from another browser</Button>
  {/snippet}
  {#snippet toolbar()}
    <Input bind:value={q} icon="search" pill placeholder="Search bookmarks" class="w-[340px]" type="search" aria-label="Search bookmarks" />
  {/snippet}

  {#if error}<Note kind="error" text={error} retry={load} class="mb-4" />{/if}

  <div class="grid grid-cols-[208px_1fr] gap-8">
    <nav aria-label="Folders" class="flex flex-col gap-0.5">
      {#if loading}
        {#each Array(4) as _, i (i)}<div class="flex h-9 items-center gap-2 px-3"><Skel w={15} h={15} r={4} /><Skel w="60%" h={12} /></div>{/each}
      {:else}
        {#each [{ id: ALL, label: 'All bookmarks', n: items.length, icon: 'star' as const }, ...folders.map(([f, n]) => ({ id: f, label: f, n, icon: folder === f ? 'folder-open' as const : 'folder' as const })), ...(unsorted ? [{ id: NONE, label: 'Other bookmarks', n: unsorted, icon: 'folder' as const }] : [])] as f (f.id)}
          <button type="button" onclick={() => { folder = f.id; q = ''; }} aria-current={folder === f.id && !q.trim() ? 'page' : undefined}
            class="flex h-9 items-center gap-2.5 rounded-[10px] px-3 text-left text-[13.5px] {folder === f.id && !q.trim() ? 'bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] font-medium text-ink' : 'text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] hover:text-ink'}">
            <Icon name={f.icon} size={16} class="shrink-0" />
            <span class="min-w-0 flex-1 truncate">{f.label}</span>
            <span class="tnum text-[12px] text-ink-2">{f.n}</span>
          </button>
        {/each}
      {/if}
    </nav>

    <section aria-label={heading} class="min-w-0">
      <h2 class="owl-group-label">{heading}</h2>
      {#if loading}
        <div class="owl-sheet">{#each Array(6) as _, i (i)}<div class="flex items-center gap-3 px-4 py-3"><Skel w={16} h={16} r={4} /><div class="flex flex-1 flex-col gap-1.5"><Skel w="40%" h={13} /><Skel w="25%" h={11} /></div></div>{/each}</div>
      {:else if !shown.length}
        {#if q.trim()}<Empty icon="search" title="No bookmarks match" compact />
        {:else if !items.length}
          <Empty icon="bookmark" title="No bookmarks yet" body="Press Ctrl+D or the star in the address bar to save a page.">
            {#snippet actions()}<Button variant="secondary" icon="arrow-download" onclick={() => owl.newTab('owl://settings#import')}>Import bookmarks</Button>{/snippet}
          </Empty>
        {:else}<Empty icon="folder" title="This folder is empty" compact />{/if}
      {:else}
        <ul class="owl-sheet">
          {#each shown as b (b.id)}
            {@const fav = faviconFor(b.url, b.favicon)}
            <li class="owl-hoverable flex items-center gap-3 px-4 py-2.5">
              <span class="grid size-4 shrink-0 place-items-center">{#if fav && !broken[b.id]}<img src={fav} alt="" class="size-4 rounded-[3px]" loading="lazy" onerror={() => (broken[b.id] = true)} />{:else}<Icon name="globe" size={14} class="text-ink-2" />{/if}</span>
              <a href={b.url} onclick={(e) => { e.preventDefault(); open(b, e); }} onauxclick={(e) => { e.preventDefault(); open(b, e); }} class="min-w-0 flex-1">
                <span class="block truncate text-[13.5px] hover:underline hover:underline-offset-2">{b.title || b.url}</span>
                <span class="block truncate text-[12px] text-ink-2">{hostOf(b.url)}{q.trim() && b.folder ? ` · ${b.folder}` : ''}</span>
              </a>
              <span class="shrink-0 text-[12px] text-ink-2">{timeAgo(b.createdAt)}</span>
              <span class="owl-hover-actions flex items-center gap-0.5">
                <IconButton icon="edit" label="Rename" size="sm" onclick={() => rename(b)} />
                <IconButton icon="delete" label="Remove bookmark" size="sm" onclick={() => remove(b)} />
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</Page>

<Dialog bind:open={editOpen} title="Rename bookmark" width={440}>
  <form id="bm-form" onsubmit={(e) => { e.preventDefault(); saveRename(); }}>
    <Field label="Name" for="bm-title" hint={editing ? hostOf(editing.url) : undefined}><Input id="bm-title" bind:value={title} /></Field>
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (editOpen = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="bm-form" loading={saving} disabled={!title.trim()}>Save</Button>
  {/snippet}
</Dialog>
