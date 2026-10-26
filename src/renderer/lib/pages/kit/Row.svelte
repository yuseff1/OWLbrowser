<script lang="ts">
  import type { Snippet } from 'svelte';
  /** A settings row: title + description on the left, control on the right. */
  let { title, description, children, below, id }: { title: string; description?: string; children?: Snippet; below?: Snippet; id?: string } = $props();
</script>
<div class="owl-row">
  <div class="flex items-center gap-6">
    <div class="min-w-0 flex-1">
      <div {id} class="text-[13.5px] font-medium text-ink">{title}</div>
      {#if description}<div class="mt-0.5 text-[12.5px] leading-snug text-ink-2">{description}</div>{/if}
    </div>
    {#if children}<div class="flex shrink-0 items-center gap-2">{@render children()}</div>{/if}
  </div>
  {#if below}<div class="mt-3">{@render below()}</div>{/if}
</div>
