<script lang="ts">
  import { kbdLabel } from './cn';
  let { keys, class: cls = '' }: { keys: string; class?: string } = $props();
  const parts = $derived(kbdLabel(keys).split(/\+(?=.)/));
</script>

<span class="inline-flex items-center gap-0.5 {cls}" aria-label={keys}>
  {#each parts as p, i (i)}
    <kbd class="inline-grid min-w-[18px] h-[18px] place-items-center rounded-[5px] border border-line bg-surface-2 px-1 font-sans text-[10.5px] font-medium leading-none text-ink-2 shadow-[inset_0_-1px_0_var(--line)]">{p}</kbd>
  {/each}
</span>
