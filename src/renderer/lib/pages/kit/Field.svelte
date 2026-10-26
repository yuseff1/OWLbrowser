<script lang="ts">
  import type { Snippet } from 'svelte';
  let { label, hint, for: htmlFor, children, class: cls = '' }: { label: string; hint?: string; for?: string; children?: Snippet; class?: string } = $props();
</script>
<div class="flex flex-col gap-1.5 {cls}">
  <label for={htmlFor} class="text-[12.5px] font-medium text-ink">{label}</label>
  {@render children?.()}
  {#if hint}<p class="text-[12px] leading-snug text-ink-2">{hint}</p>{/if}
</div>
