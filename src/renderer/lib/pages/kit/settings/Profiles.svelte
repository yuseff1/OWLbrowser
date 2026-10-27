<script lang="ts">
  import Icon from '../../../ui/Icon.svelte';
  import { onMount } from 'svelte';
  import type { Profile } from '$shared/types';
  import { owl, timeAgo } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Input, Dialog, Menu, Badge } from '$lib/ui';
  import Section from './Section.svelte';
  import Group from './Group.svelte';
  import Field from '../Field.svelte';
  import Skel from '../Skel.svelte';
  import Note from '../Note.svelte';

  const COLORS = ['#5B8CFF', '#FF7A59', '#22C3A6', '#B57BFF', '#F5B83D', '#FF5C8A', '#3DB2FF'];
  let list = $state<Profile[]>([]);
  let current = $state('');
  let loading = $state(true);
  let error = $state('');

  async function load() {
    error = '';
    try { const r = (await owl.profiles()) as { profiles: Profile[]; current: string }; list = r?.profiles || []; current = r?.current || ''; } catch (e: any) { error = e?.message || 'Couldn’t load profiles.'; }
    loading = false;
  }
  onMount(() => { load(); });

  let open = $state(false);
  let f = $state({ id: '' as string, name: '', color: COLORS[0] });
  let saving = $state(false);
  function create() { f = { id: '', name: '', color: COLORS[list.length % COLORS.length] }; open = true; }
  function rename(p: Profile) { f = { id: p.id, name: p.name, color: p.color }; open = true; }
  async function save() {
    if (!f.name.trim()) return;
    saving = true;
    try {
      if (f.id) await owl.renameProfile(f.id, f.name.trim(), f.color);
      else { await owl.createProfile(f.name.trim(), f.color); store.toast(`${f.name.trim()} created`, 'It opened in a new window.', 'success'); }
      await load(); open = false;
    } catch (e: any) { store.toast('Couldn’t save the profile', e?.message, 'error'); }
    saving = false;
  }
  let delOpen = $state(false);
  let del = $state<Profile | null>(null);
  async function remove() {
    if (!del) return;
    try { await owl.removeProfile(del.id); list = list.filter((x) => x.id !== del!.id); delOpen = false; } catch (e: any) { store.toast('Couldn’t delete the profile', e?.message, 'error'); }
  }
</script>

<Section title="Profiles" description="Separate history, logins, companions and memory, e.g. one for work and one for you.">
  {#snippet actions()}<Button variant="primary" icon="add" onclick={create}>New profile</Button>{/snippet}
  {#if error}<Note kind="error" text={error} retry={load} />{/if}
  <Group>
    {#if loading}
      {#each Array(2) as _, i (i)}<div class="flex items-center gap-3 px-4 py-3.5"><Skel w={32} h={32} r={99} /><Skel w="30%" h={13} /></div>{/each}
    {:else}
      {#each list as p (p.id)}
        <div class="flex items-center gap-3 px-4 py-3">
          <span class="grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white" style:background={p.color}>{p.avatar || p.name.charAt(0)}</span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2"><span class="truncate text-[13.5px] font-medium">{p.name}</span>{#if p.id === current}<Badge variant="neutral">This window</Badge>{/if}</div>
            <div class="text-[12px] text-ink-2">Created {timeAgo(p.createdAt)}</div>
          </div>
          {#if p.id !== current}<Button size="sm" variant="secondary" icon="window" onclick={() => owl.openProfile(p.id)}>Open</Button>{/if}
          <Menu items={[{ label: 'Rename', icon: 'edit' as const, onSelect: () => rename(p) }, ...(p.id !== current && p.id !== 'default' ? [{ separator: true as const }, { label: 'Delete', icon: 'delete' as const, danger: true, onSelect: () => { del = p; delOpen = true; } }] : [])]}>
            {#snippet trigger(pp)}<button {...pp} type="button" aria-label="More for {p.name}" class="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink"><Icon name="more-horizontal" size={16} /></button>{/snippet}
          </Menu>
        </div>
      {/each}
    {/if}
  </Group>
</Section>

<Dialog bind:open title={f.id ? 'Rename profile' : 'New profile'} width={420}>
  <form id="pf-form" class="flex flex-col gap-4" onsubmit={(e) => { e.preventDefault(); save(); }}>
    <Field label="Name" for="pf-name"><Input id="pf-name" bind:value={f.name} placeholder="Work" maxlength={30} /></Field>
    <fieldset><legend class="mb-1.5 text-[12.5px] font-medium">Colour</legend>
      <div class="flex gap-2" role="radiogroup" aria-label="Colour">
        {#each COLORS as c (c)}<button type="button" role="radio" aria-checked={f.color === c} aria-label="Colour {c}" onclick={() => (f.color = c)} class="size-7 rounded-full" style:background={c} style:box-shadow={f.color === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : 'none'}></button>{/each}
      </div>
    </fieldset>
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="pf-form" loading={saving} disabled={!f.name.trim()}>{f.id ? 'Save' : 'Create and open'}</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={delOpen} title="Delete “{del?.name}”?" description="Its history, passwords, companions, memory and routines are deleted from this PC. This can’t be undone." width={440}>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (delOpen = false)}>Keep it</Button>
    <Button variant="danger" icon="delete" onclick={remove}>Delete profile</Button>
  {/snippet}
</Dialog>
