<script lang="ts">
  import { onMount } from 'svelte';
  import { owl, art } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button } from '$lib/ui';
  import Section from './Section.svelte';
  import Group from './Group.svelte';
  import Skel from '../Skel.svelte';

  type Info = { version: string; electron: string; chrome: string; platform: string; userData: string };
  let info = $state<Info | null>(null);
  onMount(() => { owl.appInfo().then((i: any) => (info = i)).catch(() => {}); });
  const rows = $derived(info ? [{ l: 'Version', v: info.version }, { l: 'Chromium', v: info.chrome }, { l: 'Electron', v: info.electron }, { l: 'Platform', v: info.platform === 'win32' ? 'Windows' : info.platform }, { l: 'Data folder', v: info.userData, mono: true }] : []);
  async function copy() {
    if (!info) return;
    await navigator.clipboard.writeText(`OWL ${info.version} · Chromium ${info.chrome} · Electron ${info.electron} · ${info.platform}`);
    store.toast('Version details copied');
  }
</script>

<Section title="About OWL">
  <div class="flex items-center gap-4">
    <img src="./art/owl-mark.svg" onerror={(e) => ((e.currentTarget as HTMLImageElement).src = art.mark)} alt="" class="size-16 rounded-[18px] shadow-[0_6px_18px_-6px_rgba(0,0,0,.35)]" />
    <div>
      <div class="text-[18px] font-semibold tracking-[-0.015em]">OWL</div>
      <div class="text-[13px] text-ink-2">An agentic browser with AI companions that work in your tabs.</div>
    </div>
  </div>
  <Group>
    {#if !info}
      {#each Array(4) as _, i (i)}<div class="flex items-center justify-between px-4 py-3"><Skel w={90} h={12} /><Skel w={140} h={12} /></div>{/each}
    {:else}
      {#each rows as r (r.l)}
        <div class="flex items-center gap-6 px-4 py-3">
          <span class="w-[120px] shrink-0 text-[13px] text-ink-2">{r.l}</span>
          <span class="tnum min-w-0 flex-1 truncate text-right text-[13px] {r.mono ? 'font-mono text-[12px]' : ''}" title={r.v}>{r.v}</span>
        </div>
      {/each}
    {/if}
  </Group>
  <div class="flex items-center gap-3">
    <Button size="sm" variant="secondary" icon="copy" disabled={!info} onclick={copy}>Copy version details</Button>
    <span class="text-[12px] text-ink-2">© 2026 Varsen · MIT licence</span>
  </div>
</Section>
