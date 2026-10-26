<script lang="ts">
  import { onMount } from 'svelte';
  import type { TabState, MemoryItem } from '$shared/types';
  import { owl, timeAgo } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Input, Textarea, Segmented, Select, Dialog, IconButton, Empty } from '$lib/ui';
  import Page from './kit/Page.svelte';
  import Field from './kit/Field.svelte';
  import Skel from './kit/Skel.svelte';
  import Note from './kit/Note.svelte';
  import { debounce } from './kit/util';
  import { Plus, Search, Pin, PinOff, Pencil, Trash2, Lock, Brain, Globe, History } from '@lucide/svelte';

  let { tab }: { tab: TabState } = $props();

  type Kind = MemoryItem['kind'];
  const KINDS: Array<{ value: Kind; label: string; plural: string }> = [
    { value: 'fact', label: 'Fact', plural: 'Facts' },
    { value: 'preference', label: 'Preference', plural: 'Preferences' },
    { value: 'person', label: 'Person', plural: 'People' },
    { value: 'project', label: 'Project', plural: 'Projects' },
    { value: 'habit', label: 'Habit', plural: 'Habits' },
  ];
  type Hit = { id: string; layer: 'memory' | 'observation' | 'session'; title: string; kind: string; at: number; score: number };

  let items = $state<MemoryItem[]>([]);
  let loading = $state(true);
  let error = $state('');
  let q = $state('');
  let kind = $state<'all' | Kind>('all');
  let hits = $state<Hit[] | null>(null);
  let searching = $state(false);

  type Profile = { static: string[]; dynamic: string[]; at: number; generated: 'llm' | 'heuristic' };
  let profile = $state<Profile | null>(null);

  async function load() {
    error = '';
    try { items = ((await owl.memory()) as MemoryItem[]) || []; } catch (e: any) { error = e?.message || 'Couldn’t load memory.'; }
    try { profile = ((await owl.memoryProfile()) as Profile | null) ?? null; } catch { profile = null; }
    loading = false;
  }
  onMount(() => { load(); });

  const runSearch = debounce(async (text: string) => {
    if (!text.trim()) { hits = null; searching = false; return; }
    try { hits = ((await owl.searchMemory(text)) as Hit[]) || []; } catch { hits = []; }
    searching = false;
  }, 250);
  $effect(() => { const t = q; searching = !!t.trim(); runSearch(t); });

  const counts = $derived(Object.fromEntries(KINDS.map((k) => [k.value, items.filter((i) => i.kind === k.value).length])) as Record<Kind, number>);
  const pinned = $derived(items.filter((i) => i.pinned));
  const visible = $derived.by(() => {
    let list = items.filter((i) => kind === 'all' || i.kind === kind);
    const n = q.trim().toLowerCase();
    if (n) {
      const ids = new Map((hits ?? []).filter((h) => h.layer === 'memory').map((h, i) => [h.id, i]));
      list = list.filter((i) => ids.has(i.id) || i.text.toLowerCase().includes(n)).sort((a, b) => (ids.get(a.id) ?? 999) - (ids.get(b.id) ?? 999));
    } else list = [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);
    return list;
  });
  const grouped = $derived(q.trim() ? [{ k: 'results', label: `${visible.length} ${visible.length === 1 ? 'memory' : 'memories'}`, list: visible }] : KINDS.filter((k) => kind === 'all' || k.value === kind).map((k) => ({ k: k.value, label: k.plural, list: visible.filter((i) => i.kind === k.value) })).filter((g) => g.list.length));
  const activity = $derived((hits ?? []).filter((h) => h.layer !== 'memory').slice(0, 6));

  // ---- edit inline
  let editing = $state<string | null>(null);
  let editText = $state('');
  async function patch(m: MemoryItem, p: Partial<MemoryItem>) {
    const prev = items;
    items = items.map((x) => (x.id === m.id ? { ...x, ...p } : x));
    try { await owl.updateMemory(m.id, p); } catch (e: any) { items = prev; store.toast('Couldn’t update the memory', e?.message, 'error'); }
  }
  async function saveEdit(m: MemoryItem) { const t = editText.trim(); if (t && t !== m.text) await patch(m, { text: t, updatedAt: Date.now() }); editing = null; }
  async function remove(m: MemoryItem) {
    const prev = items;
    items = items.filter((x) => x.id !== m.id);
    try { await owl.removeMemory(m.id); } catch (e: any) { items = prev; store.toast('Couldn’t forget that', e?.message, 'error'); }
  }

  // ---- add
  let addOpen = $state(false);
  let newText = $state('');
  let newKind = $state<string>('fact');
  let adding = $state(false);
  async function add() {
    if (!newText.trim()) return;
    adding = true;
    try { await owl.addMemory(newText.trim(), newKind); await load(); addOpen = false; newText = ''; store.toast('Remembered', undefined, 'success'); }
    catch (e: any) { store.toast('Couldn’t save the memory', e?.message, 'error'); }
    adding = false;
  }

  // ---- forget all
  let wipeOpen = $state(false);
  let wiping = $state(false);
  async function wipe() {
    wiping = true;
    try { await owl.clearMemory(); items = []; wipeOpen = false; store.toast('OWL forgot everything it remembered about you'); }
    catch (e: any) { store.toast('Couldn’t clear memory', e?.message, 'error'); }
    wiping = false;
  }
  const sourceText = (s: string) => (s === 'user' ? 'Added by you' : s === 'onboarding' ? 'From setup' : s === 'chat' ? 'From a chat' : s.startsWith('run') ? 'From a task' : s === 'history' ? 'From browsing' : `From ${s}`);
</script>

<Page title="What OWL remembers" description="What your companions know about you, so you don’t have to repeat yourself.">
  {#snippet actions()}
    <Button variant="primary" icon={Plus} onclick={() => { newText = ''; newKind = kind === 'all' ? 'fact' : kind; addOpen = true; }}>Add memory</Button>
  {/snippet}

  <!-- summary -->
  <section class="owl-sheet overflow-hidden" aria-labelledby="mem-about">
    <div class="grid grid-cols-[1fr_auto]">
      <div class="p-5">
        <h2 id="mem-about" class="text-[14px] font-semibold">About you</h2>
        {#if loading}
          <div class="mt-3 flex flex-col gap-2"><Skel w="70%" h={13} /><Skel w="55%" h={13} /><Skel w="62%" h={13} /></div>
        {:else if profile && (profile.static.length || profile.dynamic.length)}
          <ul class="mt-2.5 flex flex-col gap-1.5">
            {#each profile.static.slice(0, 5) as line, i (i)}
              <li class="flex items-start gap-2 text-[13.5px] leading-snug"><Brain size={12} class="mt-[4px] shrink-0 text-ink-3" />{line}</li>
            {/each}
          </ul>
          {#if profile.dynamic.length}
            <p class="mt-3 text-[12px] font-medium text-ink-2">Lately</p>
            <ul class="mt-1 flex flex-col gap-1">
              {#each profile.dynamic.slice(0, 3) as line, i (i)}
                <li class="flex items-start gap-2 text-[13px] leading-snug text-ink-2"><History size={12} class="mt-[4px] shrink-0 text-ink-3" />{line}</li>
              {/each}
            </ul>
          {/if}
        {:else if pinned.length || items.length}
          <ul class="mt-2.5 flex flex-col gap-1.5">
            {#each (pinned.length ? pinned : items.slice(0, 3)).slice(0, 4) as m (m.id)}
              <li class="flex items-start gap-2 text-[13.5px] leading-snug"><Pin size={12} class="mt-[4px] shrink-0 {m.pinned ? 'text-ink' : 'text-ink-3'}" />{m.text}</li>
            {/each}
          </ul>
          {#if !pinned.length}<p class="mt-2 text-[12.5px] text-ink-2">Pin the memories that matter most and they appear here.</p>{/if}
        {:else}
          <p class="mt-2 text-[13.5px] text-ink-2">Nothing yet. As you chat and give tasks, OWL keeps the useful parts: your name, how you like answers, the projects you work on.</p>
        {/if}
      </div>
      <div role="group" aria-label="Memories by kind" class="grid grid-cols-5 border-l border-line">
        {#each KINDS as k (k.value)}
          <button type="button" onclick={() => (kind = kind === k.value ? 'all' : k.value)} aria-pressed={kind === k.value}
            class="flex w-[92px] flex-col items-start justify-end gap-0.5 border-l border-line p-4 text-left first:border-l-0 hover:bg-surface-2 {kind === k.value ? 'bg-surface-2' : ''}">
            <span class="tnum text-[22px] font-medium leading-none">{loading ? '—' : counts[k.value]}</span>
            <span class="text-[12px] text-ink-2">{k.plural}</span>
          </button>
        {/each}
      </div>
    </div>
    <div class="flex items-center gap-2 border-t border-line bg-surface-2 px-5 py-2.5 text-[12.5px] text-ink-2">
      <Lock size={13} strokeWidth={1.9} class="shrink-0" />
      Stored only on this PC, inside your OWL profile. Companions get just the memories relevant to the task at hand, and you can change or delete any of them.
    </div>
  </section>

  <!-- toolbar -->
  <div class="mt-7 flex flex-wrap items-center gap-3">
    <Input bind:value={q} icon={Search} pill placeholder="Search memories and activity" class="w-[320px]" type="search" aria-label="Search memory" />
    <Segmented bind:value={kind} size="sm" label="Kind" options={[{ value: 'all', label: 'All' }, ...KINDS.map((k) => ({ value: k.value, label: k.plural }))]} />
  </div>

  {#if error}<Note kind="error" text={error} retry={load} class="mt-4" />{/if}

  <div class="mt-5 flex flex-col gap-6">
    {#if loading}
      <div class="owl-sheet">{#each Array(4) as _, i (i)}<div class="flex flex-col gap-2 px-4 py-3.5"><Skel w="65%" h={13} /><Skel w="30%" h={11} /></div>{/each}</div>
    {:else if !visible.length && !activity.length}
      {#if q.trim()}
        <Empty icon={Search} title={searching ? 'Searching…' : `Nothing about “${q}”`} body="OWL hasn’t saved anything that matches." compact />
      {:else if items.length}
        <Empty icon={Brain} title="No {KINDS.find((k) => k.value === kind)?.plural.toLowerCase()} yet" compact />
      {:else}
        <Empty icon={Brain} title="OWL doesn’t remember anything yet" body="Add something you want every companion to know, like how you like to be addressed.">
          {#snippet actions()}<Button variant="primary" icon={Plus} onclick={() => (addOpen = true)}>Add memory</Button>{/snippet}
        </Empty>
      {/if}
    {:else}
      {#each grouped as g (g.k)}
        <section aria-label={g.label}>
          <h3 class="owl-group-label">{g.label}</h3>
          <ul class="owl-sheet">
            {#each g.list as m (m.id)}
              <li class="owl-hoverable flex items-start gap-3 px-4 py-3">
                {#if editing === m.id}
                  <form class="flex flex-1 flex-col gap-2" onsubmit={(e) => { e.preventDefault(); saveEdit(m); }}>
                    <Textarea bind:value={editText} aria-label="Edit memory" maxHeight={160} onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') editing = null; if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m); } }} />
                    <div class="flex gap-2"><Button size="sm" variant="primary" type="submit">Save</Button><Button size="sm" variant="ghost" onclick={() => (editing = null)}>Cancel</Button></div>
                  </form>
                {:else}
                  <div class="min-w-0 flex-1">
                    <p class="text-[13.5px] leading-snug">{m.text}</p>
                    <p class="tnum mt-1 text-[12px] text-ink-2">{sourceText(m.source)} · used {m.uses} {m.uses === 1 ? 'time' : 'times'} · {timeAgo(m.updatedAt)}{q.trim() ? ` · ${KINDS.find((k) => k.value === m.kind)?.label}` : ''}</p>
                  </div>
                  <div class="flex shrink-0 items-center gap-0.5 {m.pinned ? '' : 'owl-hover-actions'}">
                    <IconButton icon={Pin} label={m.pinned ? 'Unpin' : 'Pin to About you'} size="sm" active={m.pinned} onclick={() => patch(m, { pinned: !m.pinned })} />
                    <span class="owl-hover-actions flex items-center gap-0.5">
                      <IconButton icon={Pencil} label="Edit" size="sm" onclick={() => { editing = m.id; editText = m.text; }} />
                      <IconButton icon={Trash2} label="Forget" size="sm" onclick={() => remove(m)} />
                    </span>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
      {#if activity.length}
        <section aria-label="From your activity">
          <h3 class="owl-group-label">From your browsing and past tasks</h3>
          <ul class="owl-sheet">
            {#each activity as h (h.id)}
              <li class="flex items-center gap-3 px-4 py-3 text-[13px]">
                {#if h.layer === 'observation'}<Globe size={14} class="shrink-0 text-ink-2" />{:else}<History size={14} class="shrink-0 text-ink-2" />{/if}
                <span class="min-w-0 flex-1 truncate">{h.title}</span>
                <span class="text-[12px] text-ink-2">{timeAgo(h.at)}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/if}
  </div>

  {#if items.length && !loading}
    <section class="mt-12 flex items-center gap-4 border-t border-line pt-6" aria-labelledby="mem-wipe">
      <div class="min-w-0 flex-1">
        <h2 id="mem-wipe" class="text-[13.5px] font-medium">Forget everything</h2>
        <p class="text-[12.5px] text-ink-2">Deletes all {items.length} memories from this profile. Your history, bookmarks and chats stay.</p>
      </div>
      <Button variant="danger" icon={Trash2} onclick={() => (wipeOpen = true)}>Forget everything</Button>
    </section>
  {/if}
</Page>

<Dialog bind:open={addOpen} title="Add a memory" description="Write it the way you’d tell a new colleague." width={480}>
  <form id="mem-add" class="flex flex-col gap-3" onsubmit={(e) => { e.preventDefault(); add(); }}>
    <Field label="Memory" for="mem-text"><Textarea id="mem-text" bind:value={newText} placeholder="I’m vegetarian, and I prefer restaurants in Ruzafa." class="min-h-[80px]" /></Field>
    <Field label="Kind"><Select items={KINDS.map((k) => ({ value: k.value, label: k.label }))} bind:value={newKind} label="Kind" class="w-[200px]" /></Field>
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (addOpen = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="mem-add" loading={adding} disabled={!newText.trim()}>Remember this</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={wipeOpen} title="Forget all {items.length} memories?" description="Your companions will start from zero: no name, no preferences, no projects. This can’t be undone." width={440}>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (wipeOpen = false)}>Keep them</Button>
    <Button variant="danger" icon={Trash2} loading={wiping} onclick={wipe}>Forget everything</Button>
  {/snippet}
</Dialog>
