<script lang="ts">
  import type { Component, Snippet } from 'svelte';
  type Props = { icon?: Component<any>; title: string; body?: string; actions?: Snippet; compact?: boolean; class?: string };
  let { icon: Icon, title, body, actions, compact = false, class: cls = '' }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center text-center {compact ? 'gap-2 py-8' : 'gap-3 py-16'} {cls}">
  {#if Icon}
    <div class="mb-1 text-ink-3"><Icon size={compact ? 22 : 28} strokeWidth={1.5} /></div>
  {/if}
  <h3 class="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
  {#if body}<p class="max-w-[340px] text-[13px] leading-relaxed text-ink-2">{body}</p>{/if}
  {#if actions}<div class="mt-2 flex flex-wrap items-center justify-center gap-2">{@render actions()}</div>{/if}
</div>
