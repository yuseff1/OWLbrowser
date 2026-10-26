<script lang="ts">
  import { onMount } from 'svelte';
  import { owl } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Switch } from '$lib/ui';
  import Section from './Section.svelte';
  import Group from './Group.svelte';
  import Row from '../Row.svelte';
  import Skel from '../Skel.svelte';
  import Note from '../Note.svelte';
  import { patch } from './patch';
  import { Moon } from '@lucide/svelte';

  type Stats = { totalMB: number; tabs: Array<{ id: number; title: string; mb: number; sleeping: boolean }> };
  const s = $derived(store.settings);
  let stats = $state<Stats | null>(null);
  let error = $state('');
  let updated = $state(0);

  async function refresh() {
    try { stats = (await owl.memoryStats()) as Stats; error = ''; updated = Date.now(); } catch (e: any) { error = e?.message || 'Couldn’t read memory use.'; }
  }
  onMount(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t); });

  const tabs = $derived([...(stats?.tabs ?? [])].sort((a, b) => b.mb - a.mb));
  const tabsMB = $derived(tabs.reduce((a, t) => a + t.mb, 0));
  const maxMB = $derived(Math.max(1, ...tabs.map((t) => t.mb)));
  const asleep = $derived(tabs.filter((t) => t.sleeping).length);
  const fmtMB = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(2)}` : `${mb}`);

  async function sleep(id: number) {
    try { await owl.sleepTab(id); if (stats) stats = { ...stats, tabs: stats.tabs.map((t) => (t.id === id ? { ...t, sleeping: true, mb: 0 } : t)) }; setTimeout(refresh, 600); }
    catch (e: any) { store.toast('Couldn’t put the tab to sleep', e?.message, 'error'); }
  }
  async function sleepAll() { for (const t of tabs) if (!t.sleeping && t.id !== store.win.activeTabId) await owl.sleepTab(t.id); refresh(); }

  let after = $state(20), awake = $state(8);
  $effect(() => { after = s?.sleepAfterMinutes ?? 20; awake = s?.maxAwakeTabs ?? 8; });
</script>

<Section title="Performance" description="OWL puts idle tabs to sleep so your PC stays fast.">
  <section class="owl-sheet p-5" aria-labelledby="perf-ram">
    <div class="flex items-end gap-6">
      <div>
        <h2 id="perf-ram" class="text-[12.5px] text-ink-2">OWL is using</h2>
        {#if stats}
          <p class="tnum mt-1 flex items-baseline gap-1.5"><span class="text-[36px] font-semibold leading-none tracking-[-0.03em]">{fmtMB(stats.totalMB)}</span><span class="text-[15px] text-ink-2">{stats.totalMB >= 1024 ? 'GB' : 'MB'}</span></p>
        {:else}<Skel w={150} h={36} class="mt-1" />{/if}
      </div>
      <div class="tnum pb-1 text-[12.5px] text-ink-2">
        {#if stats}{tabs.length} {tabs.length === 1 ? 'tab' : 'tabs'} · {asleep} asleep · tabs use {fmtMB(tabsMB)} {tabsMB >= 1024 ? 'GB' : 'MB'}{/if}
      </div>
      <div class="flex-1"></div>
      <Button size="sm" variant="secondary" icon={Moon} disabled={!tabs.some((t) => !t.sleeping && t.id !== store.win.activeTabId)} onclick={sleepAll}>Sleep all background tabs</Button>
    </div>
    {#if error}<Note kind="error" text={error} retry={refresh} class="mt-4" />{/if}
    <ul class="mt-5 flex flex-col">
      {#if !stats}
        {#each Array(4) as _, i (i)}<li class="flex items-center gap-4 border-t border-line py-2.5"><Skel w="40%" h={12} /><Skel w="30%" h={6} r={99} /></li>{/each}
      {:else if !tabs.length}
        <li class="border-t border-line py-3 text-[13px] text-ink-2">No web pages open.</li>
      {:else}
        {#each tabs as t (t.id)}
          <li class="grid grid-cols-[minmax(0,1fr)_200px_70px_84px] items-center gap-4 border-t border-line py-2">
            <span class="truncate text-[13px] {t.sleeping ? 'text-ink-2' : ''}">{t.title || 'Untitled'}</span>
            <span class="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink)_7%,transparent)]" aria-hidden="true">
              <span class="block h-full rounded-full {t.id === tabs[0]?.id && !t.sleeping ? 'bg-accent' : 'bg-[color-mix(in_srgb,var(--ink)_45%,transparent)]'} transition-[width] duration-500" style:width="{(t.mb / maxMB) * 100}%"></span>
            </span>
            <span class="tnum text-right text-[12.5px] {t.sleeping ? 'text-ink-2' : ''}">{t.sleeping ? 'asleep' : `${t.mb} MB`}</span>
            <span class="text-right">
              {#if !t.sleeping && t.id !== store.win.activeTabId}<Button size="sm" variant="ghost" icon={Moon} onclick={() => sleep(t.id)}>Sleep</Button>{/if}
            </span>
          </li>
        {/each}
      {/if}
    </ul>
    <p class="mt-3 text-[12px] text-ink-2">Updates every 3 seconds{updated ? '' : ''}. Sleeping tabs keep their place and reload when you open them.</p>
  </section>

  <Group>
    <Row title="Memory saver" description="Put tabs to sleep when you haven’t used them for a while.">
      <Switch checked={s?.memorySaver ?? true} label="Memory saver" onCheckedChange={(v) => patch({ memorySaver: v })} />
    </Row>
    <Row title="Sleep tabs after" description="Tabs playing audio and tabs a companion is using never sleep.">
      <div class="flex w-[260px] items-center gap-3" class:opacity-50={!s?.memorySaver}>
        <input type="range" min="5" max="120" step="5" bind:value={after} disabled={!s?.memorySaver} onchange={() => patch({ sleepAfterMinutes: after })} aria-label="Sleep tabs after minutes" class="owl-range flex-1" style:--p="{((after - 5) / 115) * 100}%" />
        <span class="tnum w-[52px] text-right text-[13px] font-medium">{after} min</span>
      </div>
    </Row>
    <Row title="Most tabs awake at once" description="When you open more, the least recently used one sleeps.">
      <div class="flex w-[260px] items-center gap-3" class:opacity-50={!s?.memorySaver}>
        <input type="range" min="2" max="30" step="1" bind:value={awake} disabled={!s?.memorySaver} onchange={() => patch({ maxAwakeTabs: awake })} aria-label="Most tabs awake at once" class="owl-range flex-1" style:--p="{((awake - 2) / 28) * 100}%" />
        <span class="tnum w-[52px] text-right text-[13px] font-medium">{awake}</span>
      </div>
    </Row>
  </Group>
</Section>
