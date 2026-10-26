<script lang="ts">
  import { owl } from '../api';
  import { store } from '../stores.svelte';
  import { Popover, CompanionAvatar, Badge, Button, IconButton, Empty } from '../ui';
  import { Bot, Square, ArrowUpRight, LayoutGrid } from '@lucide/svelte';
  import { statusLabel, statusVariant, runWaiting, elapsed } from './prefs.svelte';

  let open = $state(false);
  let now = $state(Date.now());
  $effect(() => { if (!open) return; const t = setInterval(() => (now = Date.now()), 1000); return () => clearInterval(t); });

  const live = $derived(store.liveRuns);
  const waiting = $derived(live.filter((r) => runWaiting(r.status)).length);
  const faces = $derived([...new Set(live.map((r) => r.companionId))].slice(0, 3));
  const nameOf = (id: string) => store.companions.find((c) => c.id === id)?.name ?? 'Agent';

  function openRun(r: (typeof live)[number]) {
    const id = r.tabIds?.[0];
    if (id != null && store.win.tabs.some((t) => t.id === id)) owl.activateTab(id);
    store.panelRunId = r.id;
    store.panelOpen = true;
    open = false;
  }
</script>

<Popover bind:open width={360} align="end">
  {#snippet trigger(p)}
    {#if live.length}
      <button {...p} class="pill no-drag" class:wait={waiting > 0} aria-label="{live.length} agents working{waiting ? `, ${waiting} need you` : ''}">
        <span class="faces">
          {#each faces as id (id)}<CompanionAvatar companion={id} size={20} class="face" />{/each}
        </span>
        <span class="n tnum">{live.length}</span>
        {#if waiting}<span class="dot" aria-hidden="true"></span>{/if}
      </button>
    {:else}
      <span class="no-drag inline-flex"><IconButton icon={Bot} label="Agents" size="md" {...p} /></span>
    {/if}
  {/snippet}
  {#snippet children({ close })}
    <div class="p-2">
      <div class="flex items-center justify-between px-2 pb-2 pt-1">
        <div class="text-[13px] font-semibold">Agents</div>
        <span class="text-[12px] text-ink-3 tnum">{live.length ? `${live.length} working` : 'All quiet'}</span>
      </div>
      {#if live.length}
        <ul class="flex max-h-[360px] flex-col gap-1 overflow-auto">
          {#each live as r (r.id)}
            <li class="run">
              <CompanionAvatar companion={r.companionId} size={30} status={runWaiting(r.status) ? 'waiting' : 'running'} />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-[12.5px] font-medium">{nameOf(r.companionId)}</span>
                  <Badge variant={statusVariant(r.status)}>{statusLabel(r.status)}</Badge>
                  <span class="ml-auto text-[11.5px] text-ink-3 tnum">{elapsed(r.startedAt, now)}</span>
                </div>
                <p class="task">{r.task}</p>
                <div class="mt-1.5 flex gap-1">
                  <Button size="sm" variant="secondary" icon={ArrowUpRight} onclick={() => openRun(r)}>{runWaiting(r.status) ? 'Review' : 'Open'}</Button>
                  <Button size="sm" variant="ghost" icon={Square} onclick={() => owl.stopRun(r.id)}>Stop</Button>
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <Empty compact icon={Bot} title="No agents running" body="Give a companion a task and it works in its own tab while you keep browsing." />
      {/if}
      <div class="mt-1 flex gap-1 border-t border-line px-1 pt-2">
        <Button size="sm" variant="ghost" icon={LayoutGrid} onclick={() => { owl.newTab('owl://agents'); close(); }}>Open Agents</Button>
        <Button size="sm" variant="ghost" class="ml-auto" onclick={() => { store.panelOpen = true; close(); }}>New task</Button>
      </div>
    </div>
  {/snippet}
</Popover>

<style>
  .pill {
    position: relative; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px 0 4px; border-radius: 999px;
    border: 0; background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); font: inherit; font-size: 12.5px; font-weight: 600;
    transition: background-color .15s;
  }
  .pill:hover { background: color-mix(in srgb, var(--ink) 10%, transparent); }
  .faces { display: inline-flex; }
  .faces :global(.face) { box-shadow: 0 0 0 2px var(--ground); border-radius: 99px; }
  .faces :global(.face + .face) { margin-left: -7px; }
  .dot { position: absolute; top: 3px; right: 3px; width: 7px; height: 7px; border-radius: 99px; background: #f5a524; box-shadow: 0 0 0 2px var(--ground); }
  .run { display: flex; gap: 10px; padding: 10px; border-radius: 12px; }
  .run:hover { background: color-mix(in srgb, var(--ink) 4%, transparent); }
  .task { margin-top: 2px; font-size: 12.5px; color: var(--ink-2); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
