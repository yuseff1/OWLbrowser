<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { onMount } from 'svelte';
  import type { TabState, DownloadItem } from '$shared/types';
  import { owl, hostOf } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Input, IconButton, Empty } from '$lib/ui';
  import Page from './kit/Page.svelte';
  import Skel from './kit/Skel.svelte';
  import Note from './kit/Note.svelte';
  import { groupByDay, fmtBytes, clock } from './kit/util';

  let { tab }: { tab: TabState } = $props();

  let items = $state<DownloadItem[]>([]);
  let loading = $state(true);
  let error = $state('');
  let q = $state('');
  const speed = new Map<string, { t: number; b: number; bps: number }>();

  async function load() {
    error = '';
    try { items = ((await owl.downloads()) as DownloadItem[]) || []; } catch (e: any) { error = e?.message || 'Couldn’t load downloads.'; }
    loading = false;
  }
  onMount(() => {
    load();
    const off = owl.on((type, p) => {
      if (type !== 'download') return;
      const d = p as DownloadItem;
      const prev = speed.get(d.id), now = Date.now();
      if (prev && now - prev.t > 400) speed.set(d.id, { t: now, b: d.received, bps: (d.received - prev.b) / ((now - prev.t) / 1000) * 0.5 + prev.bps * 0.5 });
      else if (!prev) speed.set(d.id, { t: now, b: d.received, bps: 0 });
      const i = items.findIndex((x) => x.id === d.id);
      if (i >= 0) items[i] = d; else items = [d, ...items];
    });
    return () => off?.();
  });

  const shown = $derived(items.filter((d) => !q.trim() || (d.filename + ' ' + d.url).toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => b.startedAt - a.startedAt));
  const groups = $derived(groupByDay(shown, (d) => d.startedAt));
  const finished = $derived(items.filter((d) => d.state !== 'progressing').length);

  function iconFor(name: string) {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (['zip', 'rar', '7z', 'gz', 'tar', 'exe', 'msi'].includes(ext)) return 'folder-zip';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return 'image';
    if (['mp4', 'mov', 'webm', 'mkv'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'flac', 'm4a'].includes(ext)) return 'music-note-2';
    if (['pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'xlsx'].includes(ext)) return 'document-text';
    if (['js', 'ts', 'json', 'html', 'css', 'py', 'gguf'].includes(ext)) return 'code-block';
    return 'document';
  }
  function detail(d: DownloadItem) {
    if (d.state === 'progressing') {
      const bps = speed.get(d.id)?.bps ?? 0;
      const left = d.total > 0 && bps > 0 ? Math.round((d.total - d.received) / bps) : null;
      return `${fmtBytes(d.received)} of ${d.total > 0 ? fmtBytes(d.total) : 'unknown size'}${bps > 0 ? ` · ${fmtBytes(bps)}/s` : ''}${left != null ? ` · ${left < 60 ? left + ' s' : Math.round(left / 60) + ' min'} left` : ''}`;
    }
    if (d.state === 'completed') return `${fmtBytes(d.total || d.received)} · ${hostOf(d.url)}`;
    if (d.state === 'cancelled') return `Cancelled · ${hostOf(d.url)}`;
    return `Failed at ${fmtBytes(d.received)}${d.total ? ' of ' + fmtBytes(d.total) : ''} · ${hostOf(d.url)}`;
  }
  async function cancel(d: DownloadItem) { try { await owl.cancelDownload(d.id); items = items.map((x) => (x.id === d.id ? { ...x, state: 'cancelled' } : x)); } catch (e: any) { store.toast('Couldn’t cancel', e?.message, 'error'); } }
  async function clearAll() { try { await owl.clearDownloads(); items = items.filter((d) => d.state === 'progressing'); } catch (e: any) { store.toast('Couldn’t clear the list', e?.message, 'error'); } }
</script>

<Page title="Downloads" description="Files saved from the web. Clearing the list keeps the files on disk.">
  {#snippet actions()}
    {#if finished}<Button variant="secondary" icon="delete" onclick={clearAll}>Clear list</Button>{/if}
  {/snippet}
  {#snippet toolbar()}
    <Input bind:value={q} icon="search" pill placeholder="Search downloads" class="w-[340px]" type="search" aria-label="Search downloads" />
  {/snippet}

  {#if error}<Note kind="error" text={error} retry={load} class="mb-4" />{/if}

  {#if loading}
    <div class="owl-sheet">{#each Array(4) as _, i (i)}<div class="flex items-center gap-3.5 px-4 py-3.5"><Skel w={36} h={36} r={10} /><div class="flex flex-1 flex-col gap-2"><Skel w="45%" h={13} /><Skel w="30%" h={11} /></div></div>{/each}</div>
  {:else if !shown.length}
    {#if q.trim()}<Empty icon="search" title="No downloads match “{q}”" compact />{:else}<Empty icon="arrow-download" title="No downloads" body="Files you download appear here with their progress." />{/if}
  {:else}
    <div class="flex flex-col gap-6">
      {#each groups as g (g.key)}
        <section aria-label={g.label}>
          <h2 class="owl-group-label">{g.label}</h2>
          <ul class="owl-sheet">
            {#each g.items as d (d.id)}
              {@const ic = iconFor(d.filename)}
              {@const pct = d.total > 0 ? Math.min(100, (d.received / d.total) * 100) : 0}
              <li class="flex items-center gap-3.5 px-4 py-3" class:opacity-60={d.state === 'cancelled'}>
                <span class="owl-tile size-9 text-ink-2"><Icon name={ic} size={20} /></span>
                <div class="min-w-0 flex-1">
                  <div class="flex items-baseline gap-2">
                    {#if d.state === 'completed'}
                      <button type="button" class="truncate text-left text-[13.5px] font-medium hover:underline hover:underline-offset-2" onclick={() => owl.openDownload(d.id)}>{d.filename}</button>
                    {:else}
                      <span class="truncate text-[13.5px] font-medium" class:line-through={d.state === 'cancelled'}>{d.filename}</span>
                    {/if}
                    <span class="tnum ml-auto shrink-0 whitespace-nowrap text-[12px] text-ink-2">{clock(d.startedAt)}</span>
                  </div>
                  {#if d.state === 'progressing'}
                    <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink)_9%,transparent)]" role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                      <div class="h-full rounded-full bg-accent transition-[width] duration-300 {d.total > 0 ? '' : 'w-1/3 animate-pulse-soft'}" style:width={d.total > 0 ? pct + '%' : undefined}></div>
                    </div>
                  {/if}
                  <div class="tnum mt-1 truncate text-[12px] {d.state === 'interrupted' ? 'text-[#c4242a] dark:text-[#ff7a7e]' : 'text-ink-2'}">{detail(d)}</div>
                </div>
                <div class="flex shrink-0 items-center gap-0.5">
                  {#if d.state === 'progressing'}
                    <IconButton icon="dismiss" label="Cancel download" size="sm" onclick={() => cancel(d)} />
                  {:else if d.state === 'completed'}
                    <IconButton icon="folder-open" label="Show in folder" size="sm" onclick={() => owl.showDownload(d.id)} />
                  {:else}
                    <IconButton icon="arrow-counterclockwise" label="Download again" size="sm" onclick={() => owl.newTab(d.url, { background: true })} />
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}
</Page>
