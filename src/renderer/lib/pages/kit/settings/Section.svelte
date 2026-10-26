<script lang="ts">
  import type { Snippet } from 'svelte';
  let { title, description, actions, children }: { title: string; description?: string; actions?: Snippet; children?: Snippet } = $props();
</script>
<div class="flex items-start gap-4">
  <div class="min-w-0 flex-1">
    <h1 class="text-[20px] font-semibold leading-7 tracking-[-0.015em]">{title}</h1>
    {#if description}<p class="mt-0.5 text-[13.5px] text-ink-2">{description}</p>{/if}
  </div>
  {#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>{/if}
</div>
<div class="mt-6 flex flex-col gap-6">{@render children?.()}</div>
