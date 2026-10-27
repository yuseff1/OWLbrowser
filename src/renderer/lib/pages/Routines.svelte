<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { onMount } from 'svelte';
  import type { TabState, Routine } from '$shared/types';
  import { owl, hostOf } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Input, Textarea, Select, Switch, Segmented, Dialog, Menu, Empty, CompanionAvatar } from '$lib/ui';
  import Page from './kit/Page.svelte';
  import Field from './kit/Field.svelte';
  import Skel from './kit/Skel.svelte';
  import Note from './kit/Note.svelte';
  import { fmtWhen } from './kit/util';

  let { tab }: { tab: TabState } = $props();

  const DAYS = [{ v: 1, l: 'Mon' }, { v: 2, l: 'Tue' }, { v: 3, l: 'Wed' }, { v: 4, l: 'Thu' }, { v: 5, l: 'Fri' }, { v: 6, l: 'Sat' }, { v: 0, l: 'Sun' }];

  let routines = $state<Routine[]>([]);
  let loading = $state(true);
  let error = $state('');

  async function load() {
    error = '';
    try { routines = ((await owl.routines()) as Routine[]) || []; } catch (e: any) { error = e?.message || 'Couldn’t load routines.'; }
    loading = false;
  }
  onMount(() => { load(); if (!store.companions.length) store.refreshCompanions(); });

  function scheduleText(r: Routine) {
    const s = r.schedule;
    let txt: string;
    if (s.type === 'interval') txt = s.minutes % 60 === 0 ? `Every ${s.minutes / 60 === 1 ? 'hour' : s.minutes / 60 + ' hours'}` : `Every ${s.minutes} minutes`;
    else {
      const d = s.days ?? [];
      const days = !d.length || d.length === 7 ? 'Every day' : d.length === 5 && [1, 2, 3, 4, 5].every((x) => d.includes(x)) ? 'Weekdays' : d.length === 2 && d.includes(0) && d.includes(6) ? 'Weekends' : DAYS.filter((x) => d.includes(x.v)).map((x) => x.l).join(', ');
      txt = `${days} at ${s.time}`;
    }
    return txt;
  }

  async function toggle(r: Routine, on: boolean) {
    try { const n = (await owl.saveRoutine({ id: r.id, enabled: on })) as Routine; routines = routines.map((x) => (x.id === r.id ? n : x)); }
    catch (e: any) { store.toast('Couldn’t update the routine', e?.message, 'error'); }
  }
  async function runNow(r: Routine) {
    try { await owl.runRoutine(r.id); store.toast(`${r.name} started`, 'Follow it in Agents.', 'success'); }
    catch (e: any) { store.toast('Couldn’t start the routine', e?.message, 'error'); }
  }
  async function remove(r: Routine) {
    try { await owl.removeRoutine(r.id); routines = routines.filter((x) => x.id !== r.id); store.toast('Routine deleted'); }
    catch (e: any) { store.toast('Couldn’t delete the routine', e?.message, 'error'); }
  }

  // ---- editor
  let open = $state(false);
  let saving = $state(false);
  let formError = $state('');
  let f = $state({ id: undefined as string | undefined, name: '', companionId: '', task: '', type: 'daily' as 'daily' | 'interval', minutes: 60, time: '08:30', days: [1, 2, 3, 4, 5] as number[], watch: false, url: '', enabled: true });
  const companionItems = $derived(store.companions.filter((c) => c.hired).map((c) => ({ value: c.id, label: c.name, hint: c.role })));

  function edit(r?: Routine) {
    formError = '';
    f = r
      ? { id: r.id, name: r.name, companionId: r.companionId, task: r.task, type: r.schedule.type, minutes: r.schedule.type === 'interval' ? r.schedule.minutes : 60, time: r.schedule.type === 'daily' ? r.schedule.time : '08:30', days: r.schedule.type === 'daily' ? [...(r.schedule.days ?? [])] : [1, 2, 3, 4, 5], watch: !!r.trigger, url: r.trigger?.url ?? '', enabled: r.enabled }
      : { id: undefined, name: '', companionId: store.activeCompanionId, task: '', type: 'daily', minutes: 60, time: '08:30', days: [1, 2, 3, 4, 5], watch: false, url: '', enabled: true };
    open = true;
  }
  function toggleDay(v: number) { f.days = f.days.includes(v) ? f.days.filter((x) => x !== v) : [...f.days, v]; }

  async function save() {
    if (!f.name.trim()) { formError = 'Name the routine.'; return; }
    if (!f.task.trim()) { formError = 'Say what the companion should do.'; return; }
    if (f.watch && !/^https?:\/\//.test(f.url.trim())) { formError = 'The page to watch needs a full address starting with https://'; return; }
    saving = true; formError = '';
    try {
      const n = (await owl.saveRoutine({
        id: f.id, name: f.name.trim(), companionId: f.companionId, task: f.task.trim(), enabled: f.enabled,
        schedule: f.type === 'interval' ? { type: 'interval', minutes: Math.max(5, Math.round(+f.minutes || 60)) } : { type: 'daily', time: f.time || '08:30', days: f.days.length === 7 ? [] : [...f.days].sort() },
        trigger: f.watch ? { type: 'page-change', url: f.url.trim() } : null,
      })) as Routine;
      routines = f.id ? routines.map((x) => (x.id === n.id ? n : x)) : [...routines, n];
      open = false;
    } catch (e: any) { formError = e?.message || 'Couldn’t save.'; }
    saving = false;
  }
</script>

<Page title="Routines" description="Tasks your companions run on a schedule, or when a page you care about changes.">
  {#snippet actions()}
    <Button variant="primary" icon="add" onclick={() => edit()}>New routine</Button>
  {/snippet}

  {#if error}<Note kind="error" text={error} retry={load} class="mb-4" />{/if}

  {#if loading}
    <div class="owl-sheet">{#each Array(3) as _, i (i)}<div class="flex items-center gap-4 px-4 py-4"><Skel w={32} h={32} r={99} /><div class="flex flex-1 flex-col gap-2"><Skel w="40%" h={14} /><Skel w="65%" h={11} /></div><Skel w={34} h={20} r={99} /></div>{/each}</div>
  {:else if !routines.length}
    <Empty icon="calendar-clock" title="No routines yet" body="A morning brief, a weekly report, or a price watch that tells you when something drops.">
      {#snippet actions()}
        <Button variant="primary" icon="add" onclick={() => edit()}>New routine</Button>
        <Button variant="secondary" onclick={() => { edit(); f.name = 'Morning brief'; f.task = 'Read the news sites I visit most and give me the 5 things worth knowing today, with links.'; }}>Try a morning brief</Button>
      {/snippet}
    </Empty>
  {:else}
    <div class="owl-sheet">
      {#each routines as r (r.id)}
        {@const c = store.companions.find((x) => x.id === r.companionId)}
        <div class="flex items-start gap-4 px-4 py-4" class:opacity-60={!r.enabled}>
          <CompanionAvatar companion={r.companionId} size={32} class="mt-0.5" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h2 class="truncate text-[14px] font-semibold">{r.name}</h2>
              <span class="shrink-0 text-[12.5px] text-ink-2">· {c?.name ?? 'Companion'}</span>
            </div>
            <p class="mt-0.5 line-clamp-1 text-[13px] text-ink-2">{r.task}</p>
            <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
              <span class="flex items-center gap-1.5"><Icon name="clock" size={14} />{scheduleText(r)}</span>
              {#if r.trigger}<span class="flex items-center gap-1.5"><Icon name="eye" size={14} />When {hostOf(r.trigger.url)} changes</span>{/if}
              <span class="tnum">Next: {r.enabled ? fmtWhen(r.nextRunAt) : 'paused'}</span>
              <span class="tnum">Last: {fmtWhen(r.lastRunAt)}</span>
            </div>
            {#if r.lastResult}<p class="mt-2 line-clamp-2 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-snug">{r.lastResult}</p>{/if}
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="ghost" icon="play" onclick={() => runNow(r)}>Run now</Button>
            <Switch checked={r.enabled} label="{r.enabled ? 'Pause' : 'Resume'} {r.name}" onCheckedChange={(v) => toggle(r, v)} />
            <Menu items={[{ label: 'Edit', icon: 'edit', onSelect: () => edit(r) }, { separator: true }, { label: 'Delete', icon: 'delete', danger: true, onSelect: () => remove(r) }]}>
              {#snippet trigger(p)}<button {...p} type="button" aria-label="More for {r.name}" class="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink"><Icon name="more-horizontal" size={16} /></button>{/snippet}
            </Menu>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</Page>

<Dialog bind:open title={f.id ? 'Edit routine' : 'New routine'} description="It runs in a background tab and leaves the result in Agents." width={560}>
  <form id="rt-form" class="flex flex-col gap-4" onsubmit={(e) => { e.preventDefault(); save(); }}>
    <div class="grid grid-cols-[1fr_200px] gap-3">
      <Field label="Name" for="rt-name"><Input id="rt-name" bind:value={f.name} placeholder="Morning brief" maxlength={60} /></Field>
      <Field label="Companion"><Select items={companionItems} bind:value={f.companionId} label="Companion" class="w-full" /></Field>
    </div>
    <Field label="What to do" for="rt-task"><Textarea id="rt-task" bind:value={f.task} placeholder="Check the price of the Bambu A1 mini on amazon.es and tell me if it is under €199." class="min-h-[84px]" maxHeight={180} /></Field>
    <fieldset class="flex flex-col gap-3">
      <legend class="mb-1.5 text-[12.5px] font-medium">When</legend>
      <Segmented bind:value={f.type} label="Schedule type" options={[{ value: 'daily', label: 'At a time' }, { value: 'interval', label: 'Every few minutes' }]} />
      {#if f.type === 'daily'}
        <div class="flex flex-wrap items-center gap-3">
          <label class="flex items-center gap-2 text-[13px]"><span class="text-ink-2">At</span><input type="time" bind:value={f.time} class="h-9 rounded-[10px] border border-[color-mix(in_srgb,var(--ink)_12%,transparent)] bg-surface px-2.5 text-[13.5px] text-ink" /></label>
          <div class="flex gap-1" role="group" aria-label="Days">
            {#each DAYS as d (d.v)}<button type="button" class="owl-chip" aria-pressed={f.days.includes(d.v)} onclick={() => toggleDay(d.v)}>{d.l}</button>{/each}
          </div>
        </div>
        <p class="text-[12px] text-ink-2">{f.days.length === 0 || f.days.length === 7 ? 'Runs every day.' : `Runs on ${DAYS.filter((d) => f.days.includes(d.v)).map((d) => d.l).join(', ')}.`}</p>
      {:else}
        <div class="flex flex-wrap items-center gap-2">
          <label class="flex items-center gap-2 text-[13px]"><span class="text-ink-2">Every</span><input type="number" min="5" step="5" bind:value={f.minutes} class="tnum h-9 w-[84px] rounded-[10px] border border-[color-mix(in_srgb,var(--ink)_12%,transparent)] bg-surface px-2.5 text-[13.5px] text-ink" /><span class="text-ink-2">minutes</span></label>
          {#each [15, 60, 180, 360] as m (m)}<button type="button" class="owl-chip" aria-pressed={+f.minutes === m} onclick={() => (f.minutes = m)}>{m < 60 ? `${m} min` : `${m / 60} h`}</button>{/each}
        </div>
        <p class="text-[12px] text-ink-2">The shortest interval is 5 minutes.</p>
      {/if}
    </fieldset>
    <div class="owl-sheet">
      <label class="flex items-center gap-3 px-3.5 py-3">
        <Icon name="eye" size={16} class="text-ink-2" />
        <span class="min-w-0 flex-1"><span class="block text-[13px] font-medium">Also run when a page changes</span><span class="block text-[12px] text-ink-2">OWL checks the page quietly and starts the routine when its content changes.</span></span>
        <Switch bind:checked={f.watch} label="Also run when a page changes" />
      </label>
      {#if f.watch}<div class="px-3.5 pb-3.5"><Input bind:value={f.url} placeholder="https://www.amazon.es/dp/…" aria-label="Page to watch" type="url" /></div>{/if}
    </div>
    {#if formError}<Note kind="error" text={formError} />{/if}
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="rt-form" loading={saving}>{f.id ? 'Save' : 'Create routine'}</Button>
  {/snippet}
</Dialog>
