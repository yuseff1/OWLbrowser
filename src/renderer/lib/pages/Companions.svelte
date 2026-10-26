<script lang="ts">
  import { onMount } from 'svelte';
  import type { TabState, Companion, ModelProvider } from '$shared/types';
  import { owl, art } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Segmented, Dialog, Input, Textarea, Switch, Menu, Badge } from '$lib/ui';
  import Page from './kit/Page.svelte';
  import Field from './kit/Field.svelte';
  import GroupedSelect from './kit/GroupedSelect.svelte';
  import Skel from './kit/Skel.svelte';
  import Note from './kit/Note.svelte';
  import { modelGroups, refKey, parseRef, COMPANION_SWATCHES, shade } from './kit/util';
  import { Plus, Check, MessageCircle, Send, Ellipsis, Pencil, Copy, Trash2, Globe, Brain, MousePointer2, Blocks, FileCode2 } from '@lucide/svelte';

  let { tab }: { tab: TabState } = $props();

  const TOOLS = [
    { id: 'browser', label: 'Browser', hint: 'Open tabs, read and act on websites', icon: Globe },
    { id: 'memory', label: 'Memory', hint: 'Remember and recall what matters to you', icon: Brain },
    { id: 'computer', label: 'Computer use', hint: 'Drive the mouse and keyboard outside OWL', icon: MousePointer2 },
    { id: 'apps', label: 'Apps', hint: 'Use your connected apps (MCP)', icon: Blocks },
    { id: 'artifacts', label: 'Artifacts', hint: 'Build pages, charts and documents', icon: FileCode2 },
  ];

  let filter = $state<'all' | 'hired' | 'mine'>('all');
  let loading = $state(store.companions.length === 0);
  let error = $state('');
  let providers = $state<ModelProvider[]>([]);

  async function load() {
    error = '';
    try { await store.refreshCompanions(); } catch (e: any) { error = e?.message || 'Couldn’t load companions.'; }
    loading = false;
  }
  onMount(() => { load(); owl.providers().then((p: any) => (providers = p || [])).catch(() => {}); });

  const list = $derived(store.companions.filter((c) => (filter === 'hired' ? c.hired : filter === 'mine' ? !c.official : true)));
  const hiredCount = $derived(store.companions.filter((c) => c.hired).length);

  async function toggleHire(c: Companion) {
    try { await owl.saveCompanion({ id: c.id, hired: !c.hired }); await store.refreshCompanions(); }
    catch (e: any) { store.toast('Couldn’t update ' + c.name, e?.message, 'error'); }
  }
  function chat(c: Companion) { store.setCompanion(c.id); store.panelOpen = true; }
  function giveTask(c: Companion) { store.setCompanion(c.id); store.panelPrefill = ''; store.panelOpen = true; }

  // ---- editor
  let open = $state(false);
  let saving = $state(false);
  let formError = $state('');
  let draft = $state({ id: '' as string | undefined, name: '', role: '', tagline: '', instructions: '', tools: ['browser', 'memory', 'artifacts'] as string[], model: '', body: COMPANION_SWATCHES[0], base: null as Companion | null });
  const groups = $derived([{ heading: 'OWL', items: [{ value: '', label: 'Use the default model' }] }, ...modelGroups(providers)]);

  function edit(c?: Companion, duplicate = false) {
    formError = '';
    draft = c
      ? { id: duplicate ? undefined : c.id, name: duplicate ? `${c.name} copy` : c.name, role: c.role, tagline: c.tagline, instructions: c.instructions, tools: [...c.tools], model: refKey(c.model ?? null), body: c.look?.body || COMPANION_SWATCHES[0], base: c }
      : { id: undefined, name: '', role: '', tagline: '', instructions: '', tools: ['browser', 'memory', 'artifacts'], model: '', body: COMPANION_SWATCHES[0], base: null };
    open = true;
  }
  function toggleTool(id: string, on: boolean) { draft.tools = on ? [...new Set([...draft.tools, id])] : draft.tools.filter((t) => t !== id); }

  async function save() {
    if (!draft.name.trim()) { formError = 'Give your companion a name.'; return; }
    saving = true; formError = '';
    try {
      const baseLook = draft.base?.look ?? { body: draft.body, belly: '#EEF0F5', accent: '#3A4150', shape: 'round', ears: 'tufts', eyes: 'big', prop: 'none' };
      const look = { ...baseLook, body: draft.body, belly: shade(draft.body, 0.82), accent: shade(draft.body, -0.55) } as Companion['look'];
      const saved = (await owl.saveCompanion({ id: draft.id, name: draft.name.trim(), role: draft.role.trim() || 'Generalist', tagline: draft.tagline.trim(), instructions: draft.instructions, tools: draft.tools, model: parseRef(draft.model), look, hired: draft.id ? undefined : true })) as Companion;
      await store.refreshCompanions();
      open = false;
      store.toast(draft.id ? 'Saved' : `${saved?.name ?? 'Companion'} hired`, undefined, 'success');
    } catch (e: any) { formError = e?.message || 'Couldn’t save.'; }
    saving = false;
  }
  async function remove(c: Companion) {
    try { await owl.removeCompanion(c.id); await store.refreshCompanions(); store.toast(`${c.name} removed`); }
    catch (e: any) { store.toast('Couldn’t remove ' + c.name, e?.message, 'error'); }
  }
  const menuFor = (c: Companion) => [
    { label: 'Edit', icon: Pencil, onSelect: () => edit(c) },
    { label: 'Duplicate', icon: Copy, onSelect: () => edit(c, true) },
    ...(c.official ? [] : [{ separator: true as const }, { label: 'Remove', icon: Trash2, danger: true, onSelect: () => remove(c) }]),
  ];
</script>

<Page title="Hire your AI colleagues" description="Each companion has its own role, tools and model. Hire the ones you want to work with." width={960}>
  {#snippet actions()}
    <Button variant="primary" icon={Plus} onclick={() => edit()}>Create companion</Button>
  {/snippet}
  {#snippet toolbar()}
    <Segmented bind:value={filter} label="Show" options={[{ value: 'all', label: 'All' }, { value: 'hired', label: `Hired · ${hiredCount}` }, { value: 'mine', label: 'Made by you' }]} />
  {/snippet}

  {#if error}<Note kind="error" text={error} retry={load} class="mb-4" />{/if}

  <div class="grid grid-cols-3 gap-4">
    {#if loading}
      {#each Array(6) as _, i (i)}
        <div class="owl-sheet overflow-hidden"><div class="h-[148px] bg-surface-2"></div><div class="flex flex-col gap-2 p-4"><Skel w={90} h={16} /><Skel w="80%" h={12} /><Skel w="60%" h={12} /><Skel w={120} h={30} r={99} class="mt-3" /></div></div>
      {/each}
    {:else}
      {#each list as c (c.id)}
        {@const color = c.look?.body || '#9AA3B5'}
        <article class="owl-sheet flex flex-col overflow-hidden" aria-labelledby="cmp-{c.id}">
          <div class="relative grid h-[148px] place-items-center" style:background="radial-gradient(120% 90% at 50% 100%, color-mix(in srgb, {color} 22%, var(--surface)), color-mix(in srgb, {color} 6%, var(--surface)))">
            <img src={art.companion(c.id)} alt="" class="h-[118px] w-[118px] object-contain drop-shadow-[0_8px_10px_rgba(20,10,40,.16)]" loading="lazy" draggable="false" />
            {#if c.hired}<span class="absolute left-3 top-3"><Badge variant="ok" dot>Hired</Badge></span>{/if}
            <div class="absolute right-2 top-2">
              <Menu items={menuFor(c)}>
                {#snippet trigger(p)}<button {...p} type="button" aria-label="More for {c.name}" class="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-surface hover:text-ink"><Ellipsis size={16} /></button>{/snippet}
              </Menu>
            </div>
          </div>
          <div class="flex flex-1 flex-col p-4">
            <div class="flex items-baseline gap-2">
              <h2 id="cmp-{c.id}" class="text-[15px] font-semibold tracking-[-0.01em]">{c.name}</h2>
              <span class="truncate text-[12.5px] text-ink-2">{c.role}</span>
            </div>
            <p class="mt-1 line-clamp-2 min-h-[38px] text-[13px] leading-[19px] text-ink-2">{c.tagline || 'No description yet.'}</p>
            <ul class="mt-3 flex gap-1.5 text-ink-2" aria-label="Tools">
              {#each TOOLS.filter((t) => c.tools.includes(t.id)) as t (t.id)}
                <li title={t.label} class="grid size-6 place-items-center rounded-md bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]"><t.icon size={13} strokeWidth={1.8} aria-label={t.label} /></li>
              {/each}
            </ul>
            <div class="mt-4 flex items-center gap-1.5">
              <Button size="sm" variant={c.hired ? 'secondary' : 'primary'} icon={c.hired ? Check : Plus} aria-pressed={c.hired} onclick={() => toggleHire(c)}>{c.hired ? 'Hired' : 'Hire'}</Button>
              <div class="flex-1"></div>
              <Button size="sm" variant="ghost" icon={MessageCircle} onclick={() => chat(c)} disabled={!c.hired}>Chat</Button>
              <Button size="sm" variant="ghost" icon={Send} onclick={() => giveTask(c)} disabled={!c.hired}>Give a task</Button>
            </div>
          </div>
        </article>
      {/each}
      {#if filter !== 'hired' || list.length === 0}
        <button type="button" onclick={() => edit()} class="group flex min-h-[318px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[color-mix(in_srgb,var(--ink)_18%,transparent)] p-6 text-center hover:bg-[color-mix(in_srgb,var(--surface)_60%,transparent)]">
          <img src={art.companion('custom')} alt="" class="h-[92px] w-[92px] object-contain opacity-90 grayscale-[.3] transition-[filter] group-hover:grayscale-0" draggable="false" />
          <span class="text-[14px] font-semibold">Create your own</span>
          <span class="max-w-[220px] text-[12.5px] leading-snug text-ink-2">Give it a role, instructions, tools and a model of its own.</span>
        </button>
      {/if}
    {/if}
  </div>
</Page>

<Dialog bind:open title={draft.id ? `Edit ${draft.base?.name ?? 'companion'}` : 'Create a companion'} description="Companions follow their instructions on every task you give them." width={620}>
  <form id="cmp-form" class="flex flex-col gap-4" onsubmit={(e) => { e.preventDefault(); save(); }}>
    <div class="flex items-start gap-4">
      <div class="grid size-[76px] shrink-0 place-items-center rounded-2xl" style:background="color-mix(in srgb, {draft.body} 22%, var(--surface))">
        <img src={art.companion(draft.base?.official ? draft.base.id : 'custom')} alt="" class="size-[64px] object-contain" />
      </div>
      <div class="grid flex-1 grid-cols-2 gap-3">
        <Field label="Name" for="cmp-name"><Input id="cmp-name" bind:value={draft.name} placeholder="Marta" maxlength={32} required /></Field>
        <Field label="Role" for="cmp-role"><Input id="cmp-role" bind:value={draft.role} placeholder="Spanish tutor" maxlength={40} /></Field>
        <Field label="One-line description" for="cmp-tag" class="col-span-2"><Input id="cmp-tag" bind:value={draft.tagline} placeholder="Corrects my Spanish messages before I send them." maxlength={90} /></Field>
      </div>
    </div>
    <Field label="Instructions" for="cmp-ins" hint="How it should work, what to always or never do. Plain words are fine.">
      <Textarea id="cmp-ins" bind:value={draft.instructions} autosize maxHeight={200} placeholder="You correct my Spanish. Keep my tone, explain each change in one short line, and never send anything for me." class="min-h-[96px]" />
    </Field>
    <fieldset>
      <legend class="mb-1.5 text-[12.5px] font-medium">Tools</legend>
      <div class="owl-sheet">
        {#each TOOLS as t (t.id)}
          <label class="flex items-center gap-3 px-3.5 py-2.5">
            <t.icon size={15} strokeWidth={1.8} class="text-ink-2" />
            <span class="min-w-0 flex-1"><span class="block text-[13px] font-medium">{t.label}</span><span class="block text-[12px] text-ink-2">{t.hint}</span></span>
            <Switch checked={draft.tools.includes(t.id)} label={t.label} onCheckedChange={(v) => toggleTool(t.id, v)} />
          </label>
        {/each}
      </div>
    </fieldset>
    <div class="grid grid-cols-2 gap-4">
      <Field label="Model" hint="Overrides the default model for this companion.">
        <GroupedSelect {groups} bind:value={draft.model} label="Model" placeholder="Use the default model" class="w-full" />
      </Field>
      <fieldset>
        <legend class="mb-1.5 text-[12.5px] font-medium">Colour</legend>
        <div class="flex flex-wrap gap-1.5 pt-1" role="radiogroup" aria-label="Colour">
          {#each COMPANION_SWATCHES as sw (sw)}
            <button type="button" role="radio" aria-checked={draft.body.toLowerCase() === sw.toLowerCase()} aria-label="Colour {sw}" onclick={() => (draft.body = sw)}
              class="size-6 rounded-full transition-transform active:scale-90" style:background={sw}
              style:box-shadow={draft.body.toLowerCase() === sw.toLowerCase() ? `0 0 0 2px var(--surface), 0 0 0 4px ${sw}` : 'inset 0 0 0 1px rgba(0,0,0,.08)'}></button>
          {/each}
        </div>
      </fieldset>
    </div>
    {#if formError}<Note kind="error" text={formError} />{/if}
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="cmp-form" loading={saving}>{draft.id ? 'Save changes' : 'Create and hire'}</Button>
  {/snippet}
</Dialog>
