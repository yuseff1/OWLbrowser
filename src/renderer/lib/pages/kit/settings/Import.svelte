<script lang="ts">
  import Icon from '../../../ui/Icon.svelte';
  import { onMount } from 'svelte';
  import type { ImportSource, ImportResult } from '$shared/types';
  import { owl } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button } from '$lib/ui';
  import Section from './Section.svelte';
  import Group from './Group.svelte';
  import Skel from '../Skel.svelte';
  import Note from '../Note.svelte';
  import { favicon } from './patch';

  const NAMES: Record<string, { n: string; d: string }> = { chrome: { n: 'Google Chrome', d: 'google.com/chrome' }, edge: { n: 'Microsoft Edge', d: 'microsoft.com' }, brave: { n: 'Brave', d: 'brave.com' }, opera: { n: 'Opera', d: 'opera.com' }, vivaldi: { n: 'Vivaldi', d: 'vivaldi.com' } };
  let sources = $state<ImportSource[]>([]);
  let loading = $state(true);
  let error = $state('');
  let pick = $state(0);
  let what = $state({ bookmarks: true, history: true, passwords: true, extensions: true });
  let running = $state(false);
  let result = $state<ImportResult | null>(null);
  let iconFail = $state<Record<string, boolean>>({});

  async function load() {
    error = '';
    try { sources = ((await owl.importSources()) as ImportSource[]) || []; } catch (e: any) { error = e?.message || 'Couldn’t look for other browsers.'; }
    loading = false;
  }
  onMount(() => { load(); });

  async function run() {
    const src = sources[pick];
    if (!src) return;
    running = true; result = null;
    try { result = (await owl.importFrom(src, { ...what })) as ImportResult; store.toast('Import finished', `From ${NAMES[src.browser]?.n ?? src.browser}`, 'success'); }
    catch (e: any) { store.toast('Import failed', e?.message, 'error'); }
    running = false;
  }
  async function csv() {
    try { const n = (await owl.importPasswordsCsv()) as number; if (n) store.toast(`${n} passwords imported`, undefined, 'success'); } catch (e: any) { store.toast('Couldn’t import the file', e?.message, 'error'); }
  }
  const OPTS = [{ k: 'bookmarks', l: 'Bookmarks' }, { k: 'history', l: 'History' }, { k: 'passwords', l: 'Saved passwords' }, { k: 'extensions', l: 'Extensions' }] as const;
</script>

<Section title="Import" description="Bring your bookmarks, history, passwords and extensions from another browser on this computer.">
  {#if error}<Note kind="error" text={error} retry={load} />{/if}
  <Group label="From">
    {#if loading}
      {#each Array(2) as _, i (i)}<div class="flex items-center gap-3 px-4 py-3.5"><Skel w={16} h={16} r={99} /><Skel w={28} h={28} r={8} /><Skel w="35%" h={13} /></div>{/each}
    {:else if !sources.length}
      <div class="px-4 py-4 text-[13px] text-ink-2">No other browsers found on this computer. You can still import passwords from a CSV file below.</div>
    {:else}
      <div role="radiogroup" aria-label="Browser">
        {#each sources as src, i (src.path)}
          {@const meta = NAMES[src.browser] ?? { n: src.browser, d: '' }}
          <label class="flex items-center gap-3 border-t border-line px-4 py-3 first:border-t-0">
            <input type="radio" name="imp-src" value={i} bind:group={pick} class="size-4 accent-[var(--ink)]" />
            <span class="owl-tile size-7">{#if meta.d && !iconFail[src.path]}<img src={favicon(meta.d)} alt="" onerror={() => (iconFail[src.path] = true)} />{/if}</span>
            <span class="min-w-0 flex-1"><span class="block text-[13.5px] font-medium">{meta.n}</span><span class="block truncate text-[12px] text-ink-2">Profile: {src.profileName}</span></span>
          </label>
        {/each}
      </div>
    {/if}
  </Group>
  {#if sources.length}
    <Group label="What to bring">
      <div class="grid grid-cols-2">
        {#each OPTS as o, i (o.k)}
          <label class="flex items-center gap-3 px-4 py-3 {i % 2 ? 'border-l border-line' : ''} {i > 1 ? 'border-t border-line' : ''}">
            <input type="checkbox" bind:checked={what[o.k]} class="size-4 accent-[var(--ink)]" />
            <span class="text-[13.5px]">{o.l}</span>
          </label>
        {/each}
      </div>
    </Group>
    <div class="flex items-center gap-3">
      <Button variant="primary" icon="arrow-download" loading={running} disabled={!Object.values(what).some(Boolean)} onclick={run}>{running ? 'Importing…' : 'Import'}</Button>
      <span class="text-[12.5px] text-ink-2">Close the other browser first for the most complete import.</span>
    </div>
  {/if}
  {#if result}
    <section class="owl-sheet p-4" aria-live="polite">
      <div class="flex items-center gap-2 text-[13.5px] font-medium"><Icon name="checkmark-circle" size={16} class="text-[#24855a]" /> Imported</div>
      <div class="mt-3 grid grid-cols-5 divide-x divide-[var(--line)]">
        {#each [{ l: 'Bookmarks', v: result.bookmarks }, { l: 'History', v: result.history }, { l: 'Passwords', v: result.passwords }, { l: 'Extensions', v: result.extensions }, { l: 'Search engines', v: result.searchEngines }] as x (x.l)}
          <div class="px-3 first:pl-0"><div class="tnum text-[20px] font-medium">{x.v.toLocaleString()}</div><div class="text-[12px] text-ink-2">{x.l}</div></div>
        {/each}
      </div>
      {#if result.errors?.length}
        <ul class="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-[12.5px] text-ink-2">{#each result.errors as n, i (i)}<li>{n}</li>{/each}</ul>
      {/if}
    </section>
  {/if}
  <Group label="Passwords from a file">
    <div class="flex items-center gap-4 px-4 py-3.5">
      <p class="flex-1 text-[12.5px] text-ink-2">Export passwords as CSV from any browser or password manager, then pick the file. Delete the CSV afterwards.</p>
      <Button size="sm" variant="secondary" icon="arrow-upload" onclick={csv}>Choose CSV…</Button>
    </div>
  </Group>
</Section>
