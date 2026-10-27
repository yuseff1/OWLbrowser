<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { onMount } from 'svelte';
  import type { TabState } from '$shared/types';
  import { owl } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Input, Textarea, Segmented, Dialog, Menu, Empty } from '$lib/ui';
  import Page from './kit/Page.svelte';
  import Field from './kit/Field.svelte';
  import Skel from './kit/Skel.svelte';
  import Note from './kit/Note.svelte';
  import SkillIcon, { ICONS } from './kit/SkillIcon.svelte';
  import { md } from './kit/md';

  let { tab }: { tab: TabState } = $props();

  type Skill = { id: string; name: string; description: string; icon?: string; instructions: string; official?: boolean; createdAt?: number };

  let view = $state<'mine' | 'official'>('mine');
  let mine = $state<Skill[]>([]);
  let official = $state<Skill[]>([]);
  let loading = $state(true);
  let error = $state('');
  let q = $state('');
  let sort = $state<'name' | 'newest'>('newest');

  async function load() {
    error = '';
    try { const s = (await owl.skills()) as { mine: Skill[]; official: Skill[] }; mine = s?.mine || []; official = s?.official || []; if (!mine.length && view === 'mine' && loading) view = 'official'; }
    catch (e: any) { error = e?.message || 'Couldn’t load skills.'; }
    loading = false;
  }
  onMount(() => { load(); });

  const shown = $derived.by(() => {
    const n = q.trim().toLowerCase();
    const src = view === 'mine' ? mine : official;
    const list = src.filter((s) => !n || (s.name + ' ' + s.description).toLowerCase().includes(n));
    return sort === 'name' ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : view === 'mine' ? [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)) : list;
  });

  function use(s: Skill) { store.panelPrefill = `Use skill ${s.id}: `; store.panelOpen = true; }

  // ---- detail
  let detail = $state<Skill | null>(null);
  let detailOpen = $state(false);
  function show(s: Skill) { detail = s; detailOpen = true; }

  // ---- editor
  let open = $state(false);
  let saving = $state(false);
  let formError = $state('');
  let preview = $state(false);
  let f = $state({ id: undefined as string | undefined, name: '', description: '', icon: 'sparkles', instructions: '' });
  const TEMPLATE = '## When to use\nDescribe the requests this skill is for.\n\n## Steps\n1. First step\n2. Second step\n\n## Done when\n- [ ] The result is checked';

  function edit(s?: Skill, duplicate = false) {
    formError = ''; preview = false; detailOpen = false;
    f = s ? { id: duplicate || s.official ? undefined : s.id, name: duplicate ? `${s.name} (copy)` : s.name, description: s.description, icon: s.icon || 'sparkles', instructions: s.instructions } : { id: undefined, name: '', description: '', icon: 'sparkles', instructions: TEMPLATE };
    open = true;
  }
  async function save() {
    if (!f.name.trim()) { formError = 'Give the skill a name.'; return; }
    if (!f.description.trim()) { formError = 'Add a one-line description: companions use it to decide when the skill applies.'; return; }
    saving = true; formError = '';
    try {
      await owl.saveSkill({ ...f, name: f.name.trim(), description: f.description.trim() });
      await load();
      view = 'mine'; open = false;
      store.toast(f.id ? 'Skill saved' : 'Skill created', undefined, 'success');
    } catch (e: any) { formError = e?.message || 'Couldn’t save the skill.'; }
    saving = false;
  }
  async function remove(s: Skill) {
    try { await owl.removeSkill(s.id); mine = mine.filter((x) => x.id !== s.id); store.toast('Skill deleted'); }
    catch (e: any) { store.toast('Couldn’t delete the skill', e?.message, 'error'); }
  }

  let howOpen = $state(false);
</script>

<Page title="Skills" description="Reusable instructions your companions load when a task calls for them.">
  {#snippet actions()}
    <button type="button" class="owl-link mr-2" onclick={() => (howOpen = true)}><Icon name="book-open" size={14} /> How skills work</button>
    <Button variant="primary" icon="add" onclick={() => edit()}>Create skill</Button>
  {/snippet}
  {#snippet toolbar()}
    <Segmented bind:value={view} label="Skill source" options={[{ value: 'mine', label: `My skills${mine.length ? ' · ' + mine.length : ''}` }, { value: 'official', label: 'Official skills' }]} />
    <div class="flex-1"></div>
    <Input bind:value={q} icon="search" pill placeholder="Search skills" class="w-[280px]" type="search" aria-label="Search skills" />
    <Menu items={[{ heading: 'Sort by' }, { label: (sort === 'newest' ? '✓ ' : '') + 'Newest', onSelect: () => (sort = 'newest') }, { label: (sort === 'name' ? '✓ ' : '') + 'Name', onSelect: () => (sort = 'name') }]}>
      {#snippet trigger(p)}<button {...p} type="button" aria-label="Sort" class="grid size-[38px] place-items-center rounded-full bg-surface text-ink-2 shadow-[0_0_0_1px_color-mix(in_srgb,var(--ink)_12%,transparent)] hover:text-ink"><Icon name="options" size={16} /></button>{/snippet}
    </Menu>
  {/snippet}

  {#if error}<Note kind="error" text={error} retry={load} class="mb-4" />{/if}

  {#if loading}
    <div class="grid grid-cols-2 gap-3">{#each Array(6) as _, i (i)}<div class="owl-sheet flex gap-3 p-4"><Skel w={36} h={36} r={10} /><div class="flex flex-1 flex-col gap-2"><Skel w="45%" h={14} /><Skel w="90%" h={11} /><Skel w="70%" h={11} /></div></div>{/each}</div>
  {:else if !shown.length}
    {#if q}
      <Empty icon="search" title="No skills match “{q}”" body="Try a different word, or create a skill for it." compact>
        {#snippet actions()}<Button size="sm" variant="secondary" onclick={() => (q = '')}>Clear search</Button>{/snippet}
      </Empty>
    {:else}
      <Empty icon="sparkle" title="No skills yet" body="Write down how you like something done once, and every companion can follow it.">
        {#snippet actions()}
          <Button variant="primary" icon="add" onclick={() => edit()}>Create skill</Button>
          <Button variant="secondary" onclick={() => (view = 'official')}>Browse official skills</Button>
        {/snippet}
      </Empty>
    {/if}
  {:else}
    <ul class="grid grid-cols-2 gap-3">
      {#each shown as s (s.id)}
        <li class="owl-sheet group relative flex gap-3.5 p-4 transition-shadow hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--ink)_16%,transparent)]">
          <span class="owl-tile size-9 text-ink-2"><SkillIcon name={s.icon} size={17} /></span>
          <div class="min-w-0 flex-1">
            <button type="button" class="text-left text-[14px] font-semibold tracking-[-0.01em] after:absolute after:inset-0 after:content-['']" onclick={() => show(s)}>{s.name}</button>
            <p class="mt-0.5 line-clamp-2 text-[12.5px] leading-[18px] text-ink-2">{s.description}</p>
            <div class="relative mt-3 flex items-center gap-1.5">
              <Button size="sm" variant="secondary" icon="play" onclick={() => use(s)}>Use</Button>
              {#if view === 'official'}
                <Button size="sm" variant="ghost" icon="copy" onclick={() => edit(s, true)}>Duplicate</Button>
              {:else}
                <Button size="sm" variant="ghost" icon="edit" onclick={() => edit(s)}>Edit</Button>
                <Menu items={[{ label: 'Duplicate', icon: 'copy', onSelect: () => edit(s, true) }, { separator: true }, { label: 'Delete', icon: 'delete', danger: true, onSelect: () => remove(s) }]}>
                  {#snippet trigger(p)}<button {...p} type="button" aria-label="More for {s.name}" class="grid size-7 place-items-center rounded-full text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]"><Icon name="more-horizontal" size={16} /></button>{/snippet}
                </Menu>
              {/if}
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</Page>

<Dialog bind:open={detailOpen} title={detail?.name} description={detail?.description} width={640}>
  {#if detail}
    <div class="owl-md max-h-[50vh] overflow-y-auto rounded-xl bg-surface-2 p-4">{@html md(detail.instructions)}</div>
  {/if}
  {#snippet footer()}
    {#if detail}
      {#if detail.official}<Button variant="ghost" icon="copy" onclick={() => detail && edit(detail, true)}>Duplicate and edit</Button>{:else}<Button variant="ghost" icon="edit" onclick={() => detail && edit(detail)}>Edit</Button>{/if}
      <Button variant="primary" icon="play" onclick={() => { if (detail) use(detail); detailOpen = false; }}>Use skill</Button>
    {/if}
  {/snippet}
</Dialog>

<Dialog bind:open title={f.id ? 'Edit skill' : 'Create skill'} description="Companions see the name and description, and load the instructions when a task matches." width={660}>
  <form id="sk-form" class="flex flex-col gap-4" onsubmit={(e) => { e.preventDefault(); save(); }}>
    <div class="grid grid-cols-2 gap-3">
      <Field label="Name" for="sk-name"><Input id="sk-name" bind:value={f.name} placeholder="Weekly invoice check" maxlength={60} /></Field>
      <Field label="Description" for="sk-desc"><Input id="sk-desc" bind:value={f.description} placeholder="Use when I ask about unpaid invoices" maxlength={200} /></Field>
    </div>
    <fieldset>
      <legend class="mb-1.5 text-[12.5px] font-medium">Icon</legend>
      <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Icon">
        {#each Object.keys(ICONS) as name (name)}
          <button type="button" role="radio" aria-checked={f.icon === name} aria-label={name.replace(/-/g, ' ')} onclick={() => (f.icon = name)}
            class="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-surface hover:text-ink {f.icon === name ? '!bg-ink !text-ground' : ''}"><SkillIcon {name} size={15} /></button>
        {/each}
      </div>
    </fieldset>
    <div>
      <div class="mb-1.5 flex items-center justify-between">
        <label for="sk-ins" class="text-[12.5px] font-medium">Instructions</label>
        <Segmented size="sm" label="Instructions view" value={preview ? 'preview' : 'write'} onValueChange={(v) => (preview = v === 'preview')} options={[{ value: 'write', label: 'Write', icon: 'code' }, { value: 'preview', label: 'Preview', icon: 'eye' }]} />
      </div>
      {#if preview}
        <div class="owl-md max-h-[300px] min-h-[220px] overflow-y-auto rounded-xl bg-surface-2 p-3.5">{@html md(f.instructions)}</div>
      {:else}
        <Textarea id="sk-ins" bind:value={f.instructions} autosize={false} class="h-[260px] font-mono !text-[12.5px]" />
      {/if}
      <p class="mt-1.5 text-[12px] text-ink-2">Markdown. Say when to use it, the steps, and how to check the result.</p>
    </div>
    {#if formError}<Note kind="error" text={formError} />{/if}
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="sk-form" loading={saving}>{f.id ? 'Save skill' : 'Create skill'}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={howOpen} title="How skills work" width={520}>
  <div class="owl-md">
    <p>A skill is a short how-to your companions can load on their own. They always see each skill’s <strong>name and description</strong>, and open the full instructions only when a task matches, so having many skills costs nothing.</p>
    <ul>
      <li><strong>Use</strong> starts a task with the skill already picked.</li>
      <li><strong>Official skills</strong> come with OWL. Duplicate one to change it.</li>
      <li>Good skills say when to use them, list the steps, and end with a check.</li>
    </ul>
  </div>
  {#snippet footer()}<Button variant="primary" onclick={() => (howOpen = false)}>Got it</Button>{/snippet}
</Dialog>
