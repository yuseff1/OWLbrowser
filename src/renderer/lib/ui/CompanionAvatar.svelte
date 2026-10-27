<script lang="ts">
  import type { Companion } from '$shared/types';
  import { art } from '../api';
  import { store } from '../stores.svelte';

  type Props = {
    /** a Companion or a companion id */
    companion: Companion | string | null | undefined;
    size?: number;
    /** true = circular face crop; false = full-body art */
    face?: boolean;
    bob?: boolean;
    /** coloured ring in the companion's colour (live/agent state) */
    ring?: boolean;
    status?: 'running' | 'waiting' | 'idle' | null;
    class?: string;
  };
  let { companion, size = 28, face = true, bob = false, ring = false, status = null, class: cls = '' }: Props = $props();

  const c = $derived(typeof companion === 'string' ? (store.companions.find((x) => x.id === companion) ?? null) : companion ?? null);
  const id = $derived(typeof companion === 'string' ? companion : companion?.id ?? 'custom');
  const color = $derived(c?.look?.body || 'var(--accent)');
  const src = $derived(face ? art.face(id) : art.companion(id));
  let failed = $state(false);
  $effect(() => { src; failed = false; });
</script>

<span class="owl-ca {cls}" class:animate-bob={bob} class:face style:width="{size}px" style:height="{size}px" style:--cc={color}
  title={c?.name} role="img" aria-label={c?.name ?? 'Companion'}>
  {#if !failed}
    <img {src} alt="" draggable="false" onerror={() => (failed = true)} />
  {:else}
    <span class="fb" style:font-size="{Math.round(size * 0.42)}px">{(c?.name ?? id).slice(0, 1).toUpperCase()}</span>
  {/if}
  {#if ring}<span class="cring"></span>{/if}
  {#if status}<span class="st {status}" class:animate-pulse-soft={status === 'running'}></span>{/if}
</span>

<style>
  .owl-ca { position: relative; display: inline-block; flex: none; }
  .owl-ca img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .owl-ca.face img { border-radius: 999px; object-fit: cover; background: color-mix(in srgb, var(--cc) 18%, var(--surface)); }
  .fb { display: grid; place-items: center; width: 100%; height: 100%; border-radius: 999px; background: var(--cc); color: #fff; font-weight: 600; }
  .cring { position: absolute; inset: -2px; border-radius: 999px; box-shadow: 0 0 0 1.5px var(--cc); pointer-events: none; }
  .st { position: absolute; right: -1px; bottom: -1px; width: 32%; height: 32%; max-width: 10px; max-height: 10px; min-width: 6px; min-height: 6px; border-radius: 99px; box-shadow: 0 0 0 2px var(--ground); }
  .st.running { background: var(--cc); }
  .st.waiting { background: #e8742a; }
  .st.idle { background: var(--ink-3); }
</style>
