<script lang="ts">
  import type { Snippet } from 'svelte';
  let { label, children, flush = false }: { label?: string; children?: Snippet; flush?: boolean } = $props();
</script>
<section aria-label={label}>
  {#if label}<h2 class="owl-group-label">{label}</h2>{/if}
  <div class={flush ? '' : 'owl-sheet'}>{@render children?.()}</div>
</section>
