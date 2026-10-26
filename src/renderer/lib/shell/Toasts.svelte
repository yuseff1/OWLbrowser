<script lang="ts">
  import { store } from '../stores.svelte';
  import { CircleCheck, CircleAlert, Info, X } from '@lucide/svelte';
  let { top = 44, right = 8 }: { top?: number; right?: number } = $props();
</script>

<!-- Toasts live in the chrome band (not over the page): native web views draw on top of the page rect. -->
<div class="toasts" style:top="{top}px" style:right="{right}px" role="status" aria-live="polite">
  {#each store.toasts.slice(-2) as t (t.id)}
    <div class="toast glass-strong animate-in {t.kind}">
      {#if t.kind === 'success'}<CircleCheck size={15} strokeWidth={1.9} class="ok" />{:else if t.kind === 'error'}<CircleAlert size={15} strokeWidth={1.9} class="err" />{:else}<Info size={15} strokeWidth={1.9} class="inf" />{/if}
      <span class="t">{t.title}</span>
      {#if t.body}<span class="b">{t.body}</span>{/if}
      <button aria-label="Dismiss" onclick={() => (store.toasts = store.toasts.filter((x) => x.id !== t.id))}><X size={12} strokeWidth={2} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts { position: fixed; z-index: 90; display: flex; flex-direction: column; gap: 6px; align-items: flex-end; pointer-events: none; }
  .toast { pointer-events: auto; display: flex; align-items: center; gap: 8px; height: 34px; max-width: 460px; padding: 0 6px 0 12px; border-radius: 999px; font-size: 12.5px; }
  .t { font-weight: 600; white-space: nowrap; }
  .b { color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .toast :global(.ok) { color: #2f8f5b; } .toast :global(.err) { color: #d43a3f; } .toast :global(.inf) { color: var(--ink-2); }
  .toast :global(svg) { flex: none; }
  button { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 99px; border: 0; background: transparent; color: var(--ink-3); flex: none; }
  button:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink); }
</style>
