<script lang="ts">
  import { onMount } from 'svelte';
  import type { TabState } from '$shared/types';
  import { owl } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Select, Switch, Segmented, Empty, CompanionAvatar } from '$lib/ui';
  import Page from './kit/Page.svelte';
  import RunRow from './kit/RunRow.svelte';
  import Skel from './kit/Skel.svelte';
  import Note from './kit/Note.svelte';
  import { isLive, groupByDay } from './kit/util';

  let { tab }: { tab: TabState } = $props();

  let loading = $state(store.runs.length === 0);
  let error = $state('');
  let now = $state(Date.now());
  let expanded = $state<Record<string, boolean>>({});
  let historyLimit = $state(20);

  async function load() {
    error = '';
    try { await store.refreshRuns(); } catch (e: any) { error = e?.message || 'Couldn’t load agents.'; }
    loading = false;
  }
  onMount(() => {
    load();
    if (!store.companions.length) store.refreshCompanions();
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  const live = $derived(store.runs.filter(isLive).sort((a, b) => b.startedAt - a.startedAt));
  const done = $derived(store.runs.filter((r) => !isLive(r)).sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt)));
  const doneGroups = $derived(groupByDay(done.slice(0, historyLimit), (r) => r.endedAt ?? r.startedAt));
  const slots = $derived(store.settings?.maxParallelAgents ?? 4);

  // ---- spin up
  const hired = $derived(store.companions.filter((c) => c.hired));
  let companionId = $state(store.activeCompanionId);
  let task = $state('');
  let copies = $state('1');
  let vary = $state(true);
  let background = $state(true);
  let starting = $state(false);
  let ta: HTMLTextAreaElement | null = $state(null);
  $effect(() => { if (hired.length && !hired.some((c) => c.id === companionId)) companionId = hired[0].id; });
  $effect(() => { task; if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; } });

  async function spin() {
    const t = task.trim();
    if (!t || starting) return;
    starting = true;
    const n = Math.max(1, Math.min(5, +copies));
    try {
      let firstId: string | null = null;
      for (let i = 1; i <= n; i++) {
        const body = n > 1 && vary ? `${t}\n\n(You are copy ${i} of ${n} working on this in parallel. Take a different approach and different sources from the other copies, then report what you found.)` : t;
        const r = (await owl.startRun(companionId, body, { useCurrentTab: false, background })) as { id: string } | null;
        firstId ??= r?.id ?? null;
      }
      task = '';
      store.toast(n > 1 ? `${n} bots started` : 'Bot started', background ? 'They work in background tabs. Follow along here.' : undefined, 'success');
      if (!background) { if (firstId) store.panelRunId = firstId; store.panelOpen = true; }
      await store.refreshRuns();
    } catch (e: any) { store.toast('Couldn’t start', e?.message || String(e), 'error'); }
    starting = false;
  }
</script>

<Page title="Agents" description="Bots working for you right now, and everything they finished." width={920}>
  <!-- spin up -->
  <section class="neu rounded-[22px] p-4 transition-shadow focus-within:shadow-[var(--neu-out),0_0_0_2px_color-mix(in_srgb,var(--accent)_35%,transparent)]" aria-labelledby="ag-spin">
    <h2 id="ag-spin" class="sr-only">Spin up a bot</h2>
    <form onsubmit={(e) => { e.preventDefault(); spin(); }}>
      <div class="flex items-start gap-3">
        <CompanionAvatar companion={companionId} size={30} class="mt-1" />
        <label class="min-w-0 flex-1">
          <span class="sr-only">Task</span>
          <textarea bind:this={ta} bind:value={task} rows="2" placeholder="Spin up a bot: “Find 30 dentists in Valencia with no online booking and list their phone numbers”"
            onkeydown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); spin(); } }}
            class="owl-bare-input block w-full resize-none bg-transparent pt-1.5 text-[14px] leading-[1.55] placeholder:text-ink-2"></textarea>
        </label>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
        <Select items={hired.map((c) => ({ value: c.id, label: c.name, hint: c.role }))} bind:value={companionId} size="sm" label="Companion" class="w-[200px]" />
        <div class="flex items-center gap-2">
          <span class="text-[12.5px] text-ink-2" id="ag-copies">Copies</span>
          <Segmented bind:value={copies} size="sm" label="Parallel copies" options={['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))} />
        </div>
        {#if +copies > 1}
          <label class="flex items-center gap-2 text-[12.5px] text-ink-2"><Switch bind:checked={vary} label="Vary the approach" /> Vary approach</label>
        {/if}
        <label class="flex items-center gap-2 text-[12.5px] text-ink-2"><Switch bind:checked={background} label="Run in background" /> Background</label>
        <div class="flex-1"></div>
        <Button variant="primary" icon="play" type="submit" loading={starting} disabled={!task.trim() || !hired.length}>{+copies > 1 ? `Start ${copies} bots` : 'Start'}</Button>
      </div>
    </form>
  </section>

  {#if error}<Note kind="error" text={error} retry={load} class="mt-4" />{/if}

  <!-- live -->
  <section class="mt-8" aria-labelledby="ag-live">
    <div class="mb-2 flex items-baseline justify-between px-1">
      <h2 id="ag-live" class="text-[14px] font-semibold">Live</h2>
      <span class="tnum text-[12.5px] text-ink-2">{Math.min(live.length, slots)} of {slots} slots in use{live.length > slots ? ` · ${live.length - slots} queued` : ''}</span>
    </div>
    {#if loading}
      <div class="owl-sheet">{#each Array(2) as _, i (i)}<div class="flex items-center gap-3 px-4 py-4"><Skel w={32} h={32} r={99} /><div class="flex flex-1 flex-col gap-2"><Skel w="55%" h={13} /><Skel w="35%" h={11} /></div><Skel w={70} h={20} r={99} /></div>{/each}</div>
    {:else if live.length}
      <div class="owl-sheet">
        {#each live as r (r.id)}
          <RunRow run={r} {now} expanded={expanded[r.id] ?? false} onToggle={() => (expanded[r.id] = !expanded[r.id])} />
        {/each}
      </div>
    {:else}
      <div class="rounded-2xl border border-dashed border-[color-mix(in_srgb,var(--ink)_16%,transparent)] px-4 py-5 text-center text-[13px] text-ink-2">No bots running. Give one a task above, or press Ctrl+Shift+J on any page.</div>
    {/if}
  </section>

  <!-- history -->
  <section class="mt-8" aria-labelledby="ag-done">
    <h2 id="ag-done" class="mb-2 px-1 text-[14px] font-semibold">Finished</h2>
    {#if loading}
      <div class="owl-sheet">{#each Array(3) as _, i (i)}<div class="flex items-center gap-3 px-4 py-4"><Skel w={32} h={32} r={99} /><div class="flex flex-1 flex-col gap-2"><Skel w="60%" h={13} /><Skel w="40%" h={11} /></div></div>{/each}</div>
    {:else if done.length}
      <div class="flex flex-col gap-5">
        {#each doneGroups as g (g.key)}
          <div>
            <h3 class="owl-group-label">{g.label}</h3>
            <div class="owl-sheet">
              {#each g.items as r (r.id)}
                <RunRow run={r} {now} expanded={expanded[r.id] ?? false} onToggle={() => (expanded[r.id] = !expanded[r.id])} />
              {/each}
            </div>
          </div>
        {/each}
        {#if done.length > historyLimit}
          <div class="text-center"><Button variant="secondary" size="sm" onclick={() => (historyLimit += 30)}>Show more · {done.length - historyLimit} older</Button></div>
        {/if}
      </div>
    {:else}
      <Empty icon="bot" title="Nothing finished yet" body="Results from your bots land here, with every step they took." compact />
    {/if}
  </section>
</Page>
