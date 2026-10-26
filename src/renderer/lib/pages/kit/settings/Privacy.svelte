<script lang="ts">
  import { onMount } from 'svelte';
  import type { PasswordEntry } from '$shared/types';
  import { owl, hostOf, timeAgo } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Input, Switch, Dialog, IconButton } from '$lib/ui';
  import Section from './Section.svelte';
  import Group from './Group.svelte';
  import Row from '../Row.svelte';
  import Skel from '../Skel.svelte';
  import Note from '../Note.svelte';
  import { patch, favicon } from './patch';
  import { Eye, EyeOff, Trash2, Copy, Upload, Eraser, KeyRound, Search } from '@lucide/svelte';

  const s = $derived(store.settings);
  let pw = $state<PasswordEntry[]>([]);
  let loading = $state(true);
  let error = $state('');
  let q = $state('');
  let shown = $state<Record<string, string>>({});
  let iconFail = $state<Record<string, boolean>>({});

  async function load() {
    error = '';
    try { pw = ((await owl.passwords()) as PasswordEntry[]) || []; } catch (e: any) { error = e?.message || 'Couldn’t load passwords.'; }
    loading = false;
  }
  onMount(() => { load(); });
  const list = $derived(pw.filter((p) => !q.trim() || (p.origin + ' ' + p.username).toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => hostOf(a.origin).localeCompare(hostOf(b.origin))));

  async function reveal(p: PasswordEntry) {
    if (shown[p.id] != null) { delete shown[p.id]; return; }
    try {
      const v = (await owl.revealPassword(p.id)) as string | null;
      if (v == null) return;
      shown[p.id] = v;
      setTimeout(() => { delete shown[p.id]; }, 20000);
    } catch (e: any) { store.toast('Couldn’t show the password', e?.message, 'error'); }
  }
  async function copy(p: PasswordEntry) {
    try { const v = shown[p.id] ?? ((await owl.revealPassword(p.id)) as string | null); if (v == null) return; await navigator.clipboard.writeText(v); store.toast('Password copied', 'It stays on the clipboard until you copy something else.'); }
    catch (e: any) { store.toast('Couldn’t copy', e?.message, 'error'); }
  }
  async function remove(p: PasswordEntry) {
    const prev = pw; pw = pw.filter((x) => x.id !== p.id);
    try { await owl.removePassword(p.id); } catch (e: any) { pw = prev; store.toast('Couldn’t delete', e?.message, 'error'); }
  }
  let importing = $state(false);
  async function importCsv() {
    importing = true;
    try { const n = (await owl.importPasswordsCsv()) as number; if (n) { store.toast(`${n} passwords imported`, undefined, 'success'); load(); } }
    catch (e: any) { store.toast('Couldn’t import the file', e?.message, 'error'); }
    importing = false;
  }

  let clearOpen = $state(false);
  let what = $state({ history: true, cookies: false, cache: true });
  let clearing = $state(false);
  async function clear() {
    clearing = true;
    try { await owl.clearBrowsingData({ ...what }); clearOpen = false; store.toast('Browsing data cleared', undefined, 'success'); }
    catch (e: any) { store.toast('Couldn’t clear browsing data', e?.message, 'error'); }
    clearing = false;
  }
</script>

<Section title="Privacy & Security" description="Blocking, tracking and what OWL keeps on this PC.">
  <Group>
    <Row title="Block ads and trackers" description="Pages load faster and fewer companies follow you around the web.">
      <Switch checked={s?.adblock ?? true} label="Block ads and trackers" onCheckedChange={(v) => patch({ adblock: v })} />
    </Row>
    <Row title="Send “Do Not Track”" description="Asks sites not to track you. Many ignore it.">
      <Switch checked={s?.sendDoNotTrack ?? false} label="Send Do Not Track" onCheckedChange={(v) => patch({ sendDoNotTrack: v })} />
    </Row>
    <Row title="Clear browsing data" description="History, cookies and cached files for this profile.">
      <Button size="sm" variant="secondary" icon={Eraser} onclick={() => (clearOpen = true)}>Clear…</Button>
    </Row>
  </Group>

  <section aria-labelledby="pw-h">
    <div class="mb-2 flex items-center gap-3">
      <h2 id="pw-h" class="owl-group-label !mb-0 flex-1">Saved passwords{pw.length ? ` · ${pw.length}` : ''}</h2>
      <Button size="sm" variant="ghost" icon={Upload} loading={importing} onclick={importCsv}>Import CSV</Button>
    </div>
    {#if error}<Note kind="error" text={error} retry={load} class="mb-2" />{/if}
    <div class="owl-sheet">
      {#if pw.length > 6}<div class="px-3 py-2.5"><Input bind:value={q} icon={Search} size="sm" placeholder="Search passwords" aria-label="Search passwords" type="search" /></div>{/if}
      {#if loading}
        {#each Array(3) as _, i (i)}<div class="flex items-center gap-3 px-4 py-3"><Skel w={16} h={16} r={4} /><Skel w="30%" h={13} /><Skel w="20%" h={12} /></div>{/each}
      {:else if !pw.length}
        <div class="flex items-center gap-3 px-4 py-4 text-[13px] text-ink-2"><KeyRound size={15} /> No saved passwords. OWL offers to save one when you sign in to a site.</div>
      {:else}
        {#each list as p (p.id)}
          {@const h = hostOf(p.origin)}
          <div class="owl-hoverable flex items-center gap-3 px-4 py-2.5">
            <span class="grid size-4 shrink-0 place-items-center">{#if !iconFail[p.id]}<img src={favicon(h)} alt="" class="size-4 rounded-[3px]" onerror={() => (iconFail[p.id] = true)} />{:else}<KeyRound size={13} class="text-ink-2" />{/if}</span>
            <span class="w-[34%] min-w-0 truncate text-[13.5px]">{h}</span>
            <span class="w-[28%] min-w-0 truncate text-[13px] text-ink-2">{p.username}</span>
            <span class="min-w-0 flex-1 truncate font-mono text-[12.5px] {shown[p.id] != null ? 'text-ink' : 'text-ink-2'}" aria-live="polite">{shown[p.id] ?? '••••••••••'}</span>
            <span class="w-[78px] shrink-0 text-right text-[12px] text-ink-2">{p.lastUsed ? timeAgo(p.lastUsed) : '—'}</span>
            <span class="flex items-center gap-0.5">
              <IconButton icon={shown[p.id] != null ? EyeOff : Eye} label={shown[p.id] != null ? 'Hide password' : 'Show password'} size="sm" onclick={() => reveal(p)} />
              <IconButton icon={Copy} label="Copy password" size="sm" onclick={() => copy(p)} />
              <IconButton icon={Trash2} label="Delete password" size="sm" onclick={() => remove(p)} />
            </span>
          </div>
        {/each}
      {/if}
    </div>
    <p class="mt-2 px-0.5 text-[12px] text-ink-2">Passwords are encrypted with your Windows account. Showing one asks for confirmation first.</p>
  </section>
</Section>

<Dialog bind:open={clearOpen} title="Clear browsing data" description="For this profile, on this PC." width={440}>
  <div class="owl-sheet">
    {#each [{ k: 'history', l: 'Browsing history' }, { k: 'cookies', l: 'Cookies and site data', d: 'Signs you out of most sites' }, { k: 'cache', l: 'Cached images and files' }] as o (o.k)}
      <label class="flex items-center gap-3 px-4 py-3">
        <input type="checkbox" bind:checked={what[o.k as 'history' | 'cookies' | 'cache']} class="size-4 accent-[var(--ink)]" />
        <span class="flex-1"><span class="block text-[13.5px] font-medium">{o.l}</span>{#if o.d}<span class="block text-[12px] text-ink-2">{o.d}</span>{/if}</span>
      </label>
    {/each}
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (clearOpen = false)}>Cancel</Button>
    <Button variant="danger" icon={Eraser} loading={clearing} disabled={!what.history && !what.cookies && !what.cache} onclick={clear}>Clear data</Button>
  {/snippet}
</Dialog>
