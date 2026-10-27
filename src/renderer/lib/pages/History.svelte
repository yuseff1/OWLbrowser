<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import type { TabState, HistoryEntry } from '$shared/types';
  import { owl, hostOf, faviconFor } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Input, Dialog, IconButton, Empty } from '$lib/ui';
  import Page from './kit/Page.svelte';
  import Skel from './kit/Skel.svelte';
  import Note from './kit/Note.svelte';
  import { groupByDay, clock, debounce } from './kit/util';

  let { tab }: { tab: TabState } = $props();

  const PAGE = 150;
  let items = $state<HistoryEntry[]>([]);
  let loading = $state(true);
  let more = $state(false);
  let loadingMore = $state(false);
  let error = $state('');
  let q = $state('');
  let broken = $state<Record<string, boolean>>({});

  async function fetchPage(query: string, offset: number) {
    const r = ((await owl.history(query, offset, PAGE)) as HistoryEntry[]) || [];
    more = r.length === PAGE;
    return r;
  }
  async function load(query = q) {
    error = '';
    try { items = await fetchPage(query, 0); } catch (e: any) { error = e?.message || 'Couldn’t load history.'; }
    loading = false;
  }
  const search = debounce((t: string) => load(t), 220);
  let first = true;
  $effect(() => { const t = q; if (first) { first = false; load(t); } else search(t); });

  async function loadMore() {
    loadingMore = true;
    try { items = [...items, ...(await fetchPage(q, items.length))]; } catch (e: any) { store.toast('Couldn’t load more', e?.message, 'error'); }
    loadingMore = false;
  }

  const groups = $derived(groupByDay(items, (h) => h.lastVisit));

  async function remove(h: HistoryEntry) {
    const prev = items;
    items = items.filter((x) => x.url !== h.url);
    try { await owl.removeHistory(h.url); } catch (e: any) { items = prev; store.toast('Couldn’t delete', e?.message, 'error'); }
  }
  function open(h: HistoryEntry, e: MouseEvent) {
    if (e.ctrlKey || e.metaKey || e.button === 1) owl.newTab(h.url, { background: true });
    else owl.navigate(tab.id, h.url);
  }

  // ---- clear browsing data
  let clearOpen = $state(false);
  let what = $state({ history: true, cookies: false, cache: true });
  let clearing = $state(false);
  async function clear() {
    clearing = true;
    try {
      await owl.clearBrowsingData({ ...what });
      if (what.history) items = [];
      clearOpen = false;
      store.toast('Browsing data cleared', undefined, 'success');
    } catch (e: any) { store.toast('Couldn’t clear browsing data', e?.message, 'error'); }
    clearing = false;
  }
</script>

<Page title="History" description="Pages you visited in this profile. Companions’ background tabs aren’t listed.">
  {#snippet actions()}
    <Button variant="secondary" icon="eraser" onclick={() => (clearOpen = true)}>Clear browsing data</Button>
  {/snippet}
  {#snippet toolbar()}
    <Input bind:value={q} icon="search" pill placeholder="Search history" class="w-[380px]" type="search" aria-label="Search history" />
  {/snippet}

  {#if error}<Note kind="error" text={error} retry={() => load()} class="mb-4" />{/if}

  {#if loading}
    <Skel w={80} h={12} class="mb-3" />
    <div class="owl-sheet">{#each Array(8) as _, i (i)}<div class="flex items-center gap-3 px-4 py-3"><Skel w={44} h={11} /><Skel w={16} h={16} r={4} /><Skel w="{40 + ((i * 13) % 35)}%" h={13} /></div>{/each}</div>
  {:else if !items.length}
    {#if q.trim()}
      <Empty icon="search" title="No pages match “{q}”" body="Search looks at page titles and addresses." compact />
    {:else}
      <Empty icon="history" title="No history yet" body="Pages you visit appear here, grouped by day." />
    {/if}
  {:else}
    <div class="flex flex-col gap-6">
      {#each groups as g (g.key)}
        <section aria-label={g.label}>
          <h2 class="owl-group-label">{g.label}</h2>
          <ul class="owl-sheet">
            {#each g.items as h (h.url)}
              {@const fav = faviconFor(h.url, h.favicon)}
              <li class="owl-hoverable flex items-center gap-3 px-4 py-2">
                <span class="tnum w-[64px] shrink-0 whitespace-nowrap text-[12px] text-ink-2">{clock(h.lastVisit)}</span>
                <span class="grid size-4 shrink-0 place-items-center">{#if fav && !broken[h.url]}<img src={fav} alt="" class="size-4 rounded-[3px]" loading="lazy" onerror={() => (broken[h.url] = true)} />{:else}<Icon name="globe" size={14} class="text-ink-2" />{/if}</span>
                <a href={h.url} onclick={(e) => { e.preventDefault(); open(h, e); }} onauxclick={(e) => { e.preventDefault(); open(h, e); }} class="flex min-w-0 flex-1 items-baseline gap-2 py-1 hover:underline hover:decoration-[color-mix(in_srgb,var(--ink)_25%,transparent)] hover:underline-offset-2">
                  <span class="truncate text-[13.5px]">{h.title || h.url}</span>
                  <span class="shrink-0 text-[12px] text-ink-2">{hostOf(h.url)}</span>
                </a>
                {#if h.visits > 1}<span class="tnum shrink-0 text-[12px] text-ink-2" title="Visits">{h.visits}×</span>{/if}
                <span class="owl-hover-actions"><IconButton icon="delete" label="Remove from history" size="sm" onclick={() => remove(h)} /></span>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
      {#if more}<div class="text-center"><Button variant="secondary" size="sm" loading={loadingMore} onclick={loadMore}>Load older pages</Button></div>{/if}
    </div>
  {/if}
</Page>

<Dialog bind:open={clearOpen} title="Clear browsing data" description="For this profile, on this computer." width={440}>
  <div class="owl-sheet">
    {#each [{ k: 'history', l: 'Browsing history', d: 'Every page in the list above' }, { k: 'cookies', l: 'Cookies and site data', d: 'Signs you out of most sites' }, { k: 'cache', l: 'Cached images and files', d: 'Frees space; some sites load slower once' }] as o (o.k)}
      <label class="flex items-center gap-3 px-4 py-3">
        <input type="checkbox" bind:checked={what[o.k as 'history' | 'cookies' | 'cache']} class="size-4 accent-[var(--ink)]" />
        <span class="flex-1"><span class="block text-[13.5px] font-medium">{o.l}</span><span class="block text-[12px] text-ink-2">{o.d}</span></span>
      </label>
    {/each}
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (clearOpen = false)}>Cancel</Button>
    <Button variant="danger" icon="eraser" loading={clearing} disabled={!what.history && !what.cookies && !what.cache} onclick={clear}>Clear data</Button>
  {/snippet}
</Dialog>
