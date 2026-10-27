<script lang="ts">
  /**
   * Site settings (Chrome's chrome://settings/content/all): every site this profile decided a permission
   * for or zoomed, with per-permission Allow/Block/Ask and "Reset" (forgets permissions, zoom, cookies and
   * stored data for that site). Data from owl.siteSettings / setSitePermission / resetSite (main.ts).
   */
  import { onMount } from 'svelte';
  import { owl } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Input } from '$lib/ui';

  type Site = { site: string; origins: string[]; perms: Record<string, boolean>; zoom?: number };
  let sites = $state<Site[]>([]);
  let loaded = $state(false);
  let q = $state('');
  let busy = $state<string | null>(null);

  const LABEL: Record<string, string> = {
    notifications: 'Notifications', geolocation: 'Location', media: 'Camera & microphone', 'clipboard-read': 'Clipboard',
    midi: 'MIDI devices', 'display-capture': 'Screen capture', 'window-management': 'Window management', 'idle-detection': 'Idle detection',
    'storage-access': 'Third-party storage', 'top-level-storage-access': 'Storage access', speaker_selection: 'Speakers',
  };
  const label = (p: string) => LABEL[p] ?? p.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

  async function load() {
    try { sites = ((await owl.siteSettings()) as Site[]) || []; } catch { sites = []; }
    loaded = true;
  }
  onMount(load);
  const list = $derived(sites.filter((s) => !q.trim() || s.site.includes(q.trim().toLowerCase())));

  async function setPerm(s: Site, perm: string, value: boolean | null) {
    const origin = s.origins[0] ?? `https://${s.site}`;
    for (const o of s.origins.length ? s.origins : [origin]) await owl.setSitePermission(o, perm, value);
    await load();
  }
  async function reset(s: Site) {
    busy = s.site;
    try { await owl.resetSite(s.site); store.toast(`${s.site} was reset`, 'Permissions, zoom, cookies and site data are gone.', 'success'); await load(); }
    catch (e: any) { store.toast('Couldn’t reset the site', e?.message, 'error'); }
    busy = null;
  }
</script>

<section aria-labelledby="sites-h">
  <div class="mb-2 flex items-center gap-3">
    <h2 id="sites-h" class="owl-group-label !mb-0 flex-1">Site settings{sites.length ? ` · ${sites.length}` : ''}</h2>
  </div>
  <div class="owl-sheet">
    {#if sites.length > 6}<div class="px-3 py-2.5"><Input bind:value={q} size="sm" placeholder="Search sites" aria-label="Search sites" type="search" /></div>{/if}
    {#if !loaded}
      <div class="owl-row text-[13px] text-ink-2">Loading…</div>
    {:else if !sites.length}
      <div class="owl-row text-[13px] text-ink-2">No site has asked for a permission or been zoomed yet. When you allow or block one, it shows up here.</div>
    {:else}
      {#each list as s (s.site)}
        <div class="owl-row flex flex-col gap-2">
          <div class="flex items-center gap-3">
            <span class="min-w-0 flex-1 truncate text-[13.5px] font-medium">{s.site}</span>
            {#if s.zoom && Math.abs(s.zoom - 1) > 0.001}<span class="tnum text-[12px] text-ink-2">Zoom {Math.round(s.zoom * 100)}%</span>{/if}
            <Button size="sm" variant="ghost" loading={busy === s.site} onclick={() => reset(s)}>Reset</Button>
          </div>
          {#each Object.entries(s.perms) as [perm, allowed] (perm)}
            <div class="flex items-center gap-3 pl-0.5 text-[12.5px]">
              <span class="min-w-0 flex-1 text-ink-2">{label(perm)}</span>
              <div class="flex overflow-hidden rounded-full shadow-[0_0_0_1px_var(--line)]" role="radiogroup" aria-label="{label(perm)} for {s.site}">
                <button type="button" role="radio" aria-checked={allowed} class="seg" class:on={allowed} onclick={() => setPerm(s, perm, true)}>Allow</button>
                <button type="button" role="radio" aria-checked={!allowed} class="seg" class:on={!allowed} onclick={() => setPerm(s, perm, false)}>Block</button>
                <button type="button" role="radio" aria-checked={false} class="seg" onclick={() => setPerm(s, perm, null)} title="Forget the decision: the site asks again">Ask</button>
              </div>
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
</section>

<style>
  .seg { padding: 3px 10px; font-size: 12px; color: var(--ink-2); background: transparent; }
  .seg + .seg { border-left: 1px solid var(--line); }
  .seg:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 5%, transparent); }
  .seg.on { color: var(--ink); background: color-mix(in srgb, var(--ink) 9%, transparent); font-weight: 500; }
  .seg:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
</style>
