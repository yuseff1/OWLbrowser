<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { onMount } from 'svelte';
  import type { TabState, Artifact } from '$shared/types';
  import { owl, timeAgo } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Input, Select, Menu, Empty, CompanionAvatar } from '$lib/ui';
  import Page from './kit/Page.svelte';
  import Skel from './kit/Skel.svelte';
  import Note from './kit/Note.svelte';

  let { tab }: { tab: TabState } = $props();

  let items = $state<Artifact[]>([]);
  let loading = $state(true);
  let error = $state('');
  let q = $state('');
  let who = $state('all');

  async function load() {
    error = '';
    try { items = ((await owl.artifacts()) as Artifact[]) || []; } catch (e: any) { error = e?.message || 'Couldn’t load your library.'; }
    loading = false;
  }
  onMount(() => { load(); });

  const companionItems = $derived([{ value: 'all', label: 'Everyone' }, ...store.companions.filter((c) => items.some((a) => a.companionId === c.id)).map((c) => ({ value: c.id, label: c.name }))]);
  const shown = $derived(items.filter((a) => (who === 'all' || a.companionId === who) && (!q.trim() || a.title.toLowerCase().includes(q.trim().toLowerCase()))).sort((a, b) => b.createdAt - a.createdAt));

  async function exp(a: Artifact) { try { await owl.exportArtifact(a.id); } catch (e: any) { store.toast('Couldn’t export', e?.message, 'error'); } }
  async function del(a: Artifact) {
    try { await owl.removeArtifact(a.id); items = items.filter((x) => x.id !== a.id); store.toast(`“${a.title}” deleted`); }
    catch (e: any) { store.toast('Couldn’t delete', e?.message, 'error'); }
  }
  /** static, script-free thumbnail */
  const thumb = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, '') + '<style>html,body{overflow:hidden!important}</style>';
</script>

<Page title="Library" description="Pages, charts and documents your companions built for you." width={1000}>
  {#snippet actions()}
    <Button variant="primary" icon="add" onclick={() => { store.panelPrefill = 'Build me a page that '; store.panelOpen = true; }}>Ask for an artifact</Button>
  {/snippet}
  {#snippet toolbar()}
    <Input bind:value={q} icon="search" pill placeholder="Search by title" class="w-[300px]" type="search" aria-label="Search artifacts" />
    <Select items={companionItems} bind:value={who} label="Made by" class="w-[170px]" />
  {/snippet}

  {#if error}<Note kind="error" text={error} retry={load} class="mb-4" />{/if}

  {#if loading}
    <div class="grid grid-cols-3 gap-4">{#each Array(6) as _, i (i)}<div class="owl-sheet overflow-hidden"><div class="aspect-[3/2] bg-surface-2"></div><div class="flex items-center gap-2 p-3.5"><Skel w={22} h={22} r={99} /><Skel w="60%" h={13} /></div></div>{/each}</div>
  {:else if !shown.length}
    {#if q || who !== 'all'}
      <Empty icon="search" title="Nothing matches" body="Try another title or show everyone’s work." compact>
        {#snippet actions()}<Button size="sm" variant="secondary" onclick={() => { q = ''; who = 'all'; }}>Clear filters</Button>{/snippet}
      </Empty>
    {:else}
      <Empty icon="library" title="Your library is empty" body="Ask a companion for a chart, a comparison table or a one-page report; it lands here.">
        {#snippet actions()}<Button variant="primary" icon="add" onclick={() => { store.panelPrefill = 'Build me a page that '; store.panelOpen = true; }}>Ask for an artifact</Button>{/snippet}
      </Empty>
    {/if}
  {:else}
    <ul class="grid grid-cols-3 gap-4">
      {#each shown as a (a.id)}
        {@const c = store.companions.find((x) => x.id === a.companionId)}
        <li class="owl-sheet group relative overflow-hidden transition-shadow hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--ink)_18%,transparent),0_8px_24px_-12px_rgba(0,0,0,.25)]">
          <div class="relative aspect-[3/2] overflow-hidden border-b border-line bg-white">
            <iframe title="Preview of {a.title}" srcdoc={thumb(a.html)} sandbox="" loading="lazy" tabindex="-1" aria-hidden="true"
              class="pointer-events-none absolute left-0 top-0 origin-top-left border-0" style="width:250%;height:250%;transform:scale(.4)"></iframe>
          </div>
          <div class="flex items-center gap-2.5 p-3.5">
            {#if a.companionId}<CompanionAvatar companion={a.companionId} size={22} />{/if}
            <div class="min-w-0 flex-1">
              <button type="button" onclick={() => owl.openArtifact(a.id)} class="block w-full truncate text-left text-[13.5px] font-medium after:absolute after:inset-0 after:content-['']">{a.title}</button>
              <div class="text-[12px] text-ink-2">{c ? `${c.name} · ` : ''}{timeAgo(a.createdAt)}</div>
            </div>
            <div class="relative">
              <Menu items={[{ label: 'Open', icon: 'open', onSelect: () => owl.openArtifact(a.id) }, { label: 'Export as HTML…', icon: 'arrow-download', onSelect: () => exp(a) }, { separator: true }, { label: 'Delete', icon: 'delete', danger: true, onSelect: () => del(a) }]}>
                {#snippet trigger(p)}<button {...p} type="button" aria-label="More for {a.title}" class="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink"><Icon name="more-horizontal" size={16} /></button>{/snippet}
              </Menu>
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</Page>
