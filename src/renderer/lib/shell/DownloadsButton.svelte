<script lang="ts">
  import { owl } from '../api';
  import { Popover, IconButton, Button, Empty } from '../ui';
  import { Download, FolderOpen, X, FileDown } from '@lucide/svelte';
  import type { DownloadItem } from '$shared/types';

  let open = $state(false);
  let items = $state<DownloadItem[]>([]);
  owl.downloads().then((d: any) => (items = d || []));
  $effect(() => owl.on((type, d: DownloadItem) => {
    if (type !== 'download') return;
    const i = items.findIndex((x) => x.id === d.id);
    if (i >= 0) items[i] = d; else { items.unshift(d); }
  }));
  const active = $derived(items.filter((d) => d.state === 'progressing'));
  const pct = $derived(active.length ? Math.round((active.reduce((a, d) => a + d.received, 0) / Math.max(1, active.reduce((a, d) => a + d.total, 0))) * 100) : 0);
  const fmt = (b: number) => (b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
</script>

{#if items.length}
  <Popover bind:open width={340} align="end">
    {#snippet trigger(p)}
      <span class="relative inline-flex no-drag">
        <IconButton icon={Download} label="Downloads" kbd="Ctrl+Shift+J" {...p} />
        {#if active.length}
          <svg class="dlring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" pathLength="100" stroke-dasharray="{pct} 100" /></svg>
        {/if}
      </span>
    {/snippet}
    {#snippet children({ close })}
      <div class="p-2">
        <div class="px-2 pb-2 pt-1 text-[13px] font-semibold">Downloads</div>
        {#if items.length}
          <ul class="flex max-h-[320px] flex-col overflow-auto">
            {#each items.slice(0, 8) as d (d.id)}
              <li class="row">
                <FileDown size={18} strokeWidth={1.6} class="text-ink-3" />
                <button class="min-w-0 flex-1 text-left" disabled={d.state !== 'completed'} onclick={() => owl.openDownload(d.id)}>
                  <div class="truncate text-[13px]">{d.filename}</div>
                  {#if d.state === 'progressing'}
                    <div class="bar"><span style:width="{(d.received / Math.max(1, d.total)) * 100}%"></span></div>
                    <div class="text-[11.5px] text-ink-3 tnum">{fmt(d.received)} of {fmt(d.total)}</div>
                  {:else}
                    <div class="text-[11.5px] text-ink-3">{d.state === 'completed' ? fmt(d.total) : d.state === 'cancelled' ? 'Cancelled' : 'Interrupted'}</div>
                  {/if}
                </button>
                {#if d.state === 'progressing'}
                  <IconButton icon={X} label="Cancel" size="sm" onclick={() => owl.cancelDownload(d.id)} />
                {:else if d.state === 'completed'}
                  <IconButton icon={FolderOpen} label="Show in folder" size="sm" onclick={() => owl.showDownload(d.id)} />
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <Empty compact icon={Download} title="No downloads yet" />
        {/if}
        <div class="mt-1 border-t border-line px-1 pt-2">
          <Button size="sm" variant="ghost" onclick={() => { owl.newTab('owl://downloads'); close(); }}>All downloads</Button>
        </div>
      </div>
    {/snippet}
  </Popover>
{/if}

<style>
  .dlring { position: absolute; inset: 1px; width: 30px; height: 30px; pointer-events: none; transform: rotate(-90deg); }
  .dlring circle { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 12px; }
  .row:hover { background: color-mix(in srgb, var(--ink) 4%, transparent); }
  .row button { background: transparent; border: 0; color: inherit; font: inherit; }
  .bar { height: 4px; margin: 5px 0 3px; border-radius: 99px; background: color-mix(in srgb, var(--ink) 9%, transparent); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--ink); border-radius: 99px; }
</style>
