<script lang="ts">
  /**
   * Toolbar downloads button + bubble (Chrome's download bubble): overall progress ring on the button, a
   * dot when something finished since the bubble was last opened, and per file: progress, speed and time
   * left, pause / resume, cancel, retry, open, show in folder, remove from the list.
   */
  import Icon from '../ui/Icon.svelte';
  import { owl } from '../api';
  import { store } from '../stores.svelte';
  import { Popover, IconButton, Button, Empty } from '../ui';
  import type { DownloadItem } from '$shared/types';

  let open = $state(false);
  let items = $state<DownloadItem[]>([]);
  let unseen = $state(false);
  /** bytes/s per download, smoothed from successive updates */
  let speed = $state<Record<string, number>>({});
  const lastSample = new Map<string, { t: number; b: number }>();

  owl.downloads().then((d: any) => (items = d || []));
  $effect(() => owl.on((type, d: DownloadItem) => {
    if (type !== 'download') return;
    const i = items.findIndex((x) => x.id === d.id);
    const prev = i >= 0 ? items[i] : null;
    if (i >= 0) items[i] = d;
    else { items.unshift(d); if (d.state === 'progressing' && !d.awaitingApproval) store.toast('Downloading', d.filename); }
    // speed: exponential moving average over updates
    const now = Date.now(), s = lastSample.get(d.id);
    if (d.state === 'progressing' && !d.paused && s && now > s.t) {
      const inst = Math.max(0, (d.received - s.b) / ((now - s.t) / 1000));
      speed[d.id] = speed[d.id] ? speed[d.id] * 0.6 + inst * 0.4 : inst;
    }
    lastSample.set(d.id, { t: now, b: d.received });
    if (prev?.state === 'progressing' && d.state !== 'progressing') { lastSample.delete(d.id); delete speed[d.id]; if (!open) unseen = true; }
  }));
  $effect(() => { if (open) unseen = false; });

  const active = $derived(items.filter((d) => d.state === 'progressing'));
  const finished = $derived(items.some((d) => d.state !== 'progressing'));
  const pct = $derived(active.length ? Math.round((active.reduce((a, d) => a + d.received, 0) / Math.max(1, active.reduce((a, d) => a + d.total, 0))) * 100) : 0);
  const fmt = (b: number) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
  const eta = (sec: number) => (sec < 60 ? `${Math.max(1, Math.round(sec))} s left` : sec < 3600 ? `${Math.round(sec / 60)} min left` : `${(sec / 3600).toFixed(1)} h left`);
  function status(d: DownloadItem) {
    if (d.state === 'progressing') {
      if (d.awaitingApproval) return 'Waiting for your approval';
      if (d.paused) return `Paused · ${fmt(d.received)}${d.total ? ' of ' + fmt(d.total) : ''}`;
      const v = speed[d.id] || 0;
      const left = d.total && v > 0 ? ' · ' + eta((d.total - d.received) / v) : '';
      return `${fmt(d.received)}${d.total ? ' of ' + fmt(d.total) : ''}${v > 0 ? ' · ' + fmt(v) + '/s' : ''}${left}`;
    }
    if (d.state === 'completed') return `${fmt(d.total || d.received)} · Done`;
    if (d.state === 'cancelled') return 'Cancelled';
    return d.canResume ? 'Interrupted — can resume' : 'Failed';
  }
  const ext = (f: string) => (f.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? '').toUpperCase();
</script>

{#if items.length}
  <Popover bind:open width={360} align="end">
    {#snippet trigger(p)}
      <span class="relative inline-flex no-drag">
        <IconButton icon="arrow-download" label={active.length ? `Downloads, ${active.length} in progress, ${pct}%` : 'Downloads'} kbd="Ctrl+J" {...p} />
        {#if active.length}
          <svg class="dlring" viewBox="0 0 36 36" aria-hidden="true"><circle class="track" cx="18" cy="18" r="16" /><circle cx="18" cy="18" r="16" pathLength="100" stroke-dasharray="{pct} 100" /></svg>
        {:else if unseen}
          <span class="dot" aria-hidden="true"></span>
        {/if}
      </span>
    {/snippet}
    {#snippet children({ close })}
      <div class="p-2">
        <div class="flex items-center justify-between px-2 pb-1.5 pt-1">
          <span class="text-[13px] font-semibold">Downloads</span>
          {#if finished}<button class="link" onclick={() => { owl.clearDownloads(); items = items.filter((d) => d.state === 'progressing'); }}>Clear finished</button>{/if}
        </div>
        {#if items.length}
          <ul class="flex max-h-[360px] flex-col overflow-auto" aria-label="Recent downloads">
            {#each items.slice(0, 10) as d (d.id)}
              {@const done = d.state === 'completed'}
              {@const failed = d.state === 'interrupted' || d.state === 'cancelled'}
              <li class="row" class:failed>
                <span class="file" aria-hidden="true">
                  <Icon name={failed ? 'document-dismiss' : 'document'} size={20} />
                  {#if ext(d.filename) && !failed}<span class="ext">{ext(d.filename)}</span>{/if}
                </span>
                <button class="main" disabled={!done} title={done ? 'Open ' + d.filename : d.filename} onclick={() => owl.openDownload(d.id)}>
                  <span class="block truncate text-[13px]" class:line-through={d.state === 'cancelled'}>{d.filename}</span>
                  {#if d.state === 'progressing'}
                    <span class="bar" class:paused={d.paused || d.awaitingApproval} class:indet={!d.total}><span style:width="{d.total ? (d.received / d.total) * 100 : 30}%"></span></span>
                  {/if}
                  <span class="block truncate text-[11.5px] text-ink-3 tnum" class:err={failed}>{status(d)}</span>
                </button>
                <span class="acts">
                  {#if d.state === 'progressing' && !d.awaitingApproval}
                    {#if d.paused}
                      <IconButton icon="play" label="Resume" size="sm" onclick={() => owl.resumeDownload(d.id)} />
                    {:else}
                      <IconButton icon="pause" label="Pause" size="sm" onclick={() => owl.pauseDownload(d.id)} />
                    {/if}
                    <IconButton icon="dismiss" label="Cancel" size="sm" onclick={() => owl.cancelDownload(d.id)} />
                  {:else if d.state === 'progressing'}
                    <IconButton icon="dismiss" label="Cancel" size="sm" onclick={() => owl.cancelDownload(d.id)} />
                  {:else if done}
                    <IconButton icon="folder-open" label="Show in folder" size="sm" onclick={() => owl.showDownload(d.id)} />
                    <IconButton icon="dismiss" label="Remove from list" size="sm" onclick={() => { owl.removeDownload(d.id); items = items.filter((x) => x.id !== d.id); }} />
                  {:else}
                    {#if d.canResume}
                      <IconButton icon="play" label="Resume" size="sm" onclick={() => owl.resumeDownload(d.id)} />
                    {:else}
                      <IconButton icon="arrow-clockwise" label="Retry" size="sm" onclick={() => { owl.retryDownload(d.id); items = items.filter((x) => x.id !== d.id); }} />
                    {/if}
                    <IconButton icon="dismiss" label="Remove from list" size="sm" onclick={() => { owl.removeDownload(d.id); items = items.filter((x) => x.id !== d.id); }} />
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <Empty compact icon="arrow-download" title="No downloads yet" />
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
  .dlring circle { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; transition: stroke-dasharray .4s var(--ease-out); }
  .dlring .track { stroke: color-mix(in srgb, var(--ink) 10%, transparent); }
  .dot { position: absolute; top: 5px; right: 5px; width: 7px; height: 7px; border-radius: 99px; background: var(--accent); box-shadow: 0 0 0 2px var(--ground); pointer-events: none; }
  .link { border: 0; background: transparent; color: var(--ink-2); font: inherit; font-size: 12px; padding: 2px 6px; border-radius: 6px; }
  .link:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 6%, transparent); }
  .row { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 12px; }
  .row:hover { background: color-mix(in srgb, var(--ink) 4%, transparent); }
  .file { position: relative; display: grid; place-items: center; width: 28px; height: 32px; color: var(--ink-3); flex: none; }
  .ext { position: absolute; bottom: 1px; left: 50%; transform: translateX(-50%); padding: 0 3px; border-radius: 3px; background: var(--ink); color: var(--surface); font-size: 7.5px; font-weight: 700; letter-spacing: .02em; line-height: 11px; }
  .failed .file { color: var(--ink-3); opacity: .7; }
  .main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; text-align: left; background: transparent; border: 0; color: inherit; font: inherit; padding: 0; }
  .main:disabled { cursor: default; }
  .err { color: #c8564f; }
  .acts { display: flex; align-items: center; gap: 2px; flex: none; opacity: .85; }
  .row:hover .acts { opacity: 1; }
  .bar { position: relative; display: block; height: 4px; border-radius: 99px; background: color-mix(in srgb, var(--ink) 9%, transparent); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--ink); border-radius: 99px; transition: width .4s var(--ease-out); }
  .bar.paused span { background: var(--ink-3); }
  .bar.indet span { animation: indet 1.2s ease-in-out infinite; }
  @keyframes indet { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
  @media (prefers-reduced-motion: reduce) { .bar.indet span, .dlring circle, .bar span { animation: none; transition: none; } }
</style>
