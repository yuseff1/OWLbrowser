<script lang="ts">
  import type { Snippet } from 'svelte';
  type Variant = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'outline';
  let { variant = 'neutral', dot = false, pulse = false, class: cls = '', children }: { variant?: Variant; dot?: boolean; pulse?: boolean; class?: string; children?: Snippet } = $props();
</script>

<span class="owl-badge {variant} {cls}">
  {#if dot}<span class="d" class:animate-pulse-soft={pulse}></span>{/if}
  {@render children?.()}
</span>

<style>
  .owl-badge {
    display: inline-flex; align-items: center; gap: 5px; flex: none; white-space: nowrap;
    height: 20px; padding: 0 8px; border-radius: 999px; font-size: 11.5px; font-weight: 500; line-height: 1;
    background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  .d { width: 6px; height: 6px; border-radius: 99px; background: currentColor; }
  .accent { background: color-mix(in srgb, var(--accent) 16%, transparent); color: color-mix(in srgb, var(--accent) 42%, var(--ink)); }
  :global(.dark) .accent { color: color-mix(in srgb, var(--accent) 85%, var(--ink)); }
  .ok { background: color-mix(in srgb, #30a46c 14%, transparent); color: color-mix(in srgb, #30a46c 70%, var(--ink)); }
  .warn { background: color-mix(in srgb, #e5622a 13%, transparent); color: color-mix(in srgb, #c9501a 85%, var(--ink)); }
  :global(.dark) .warn { color: color-mix(in srgb, #f07a45 90%, var(--ink)); }
  .danger { background: color-mix(in srgb, #e5484d 13%, transparent); color: color-mix(in srgb, #e5484d 80%, var(--ink)); }
  .outline { background: transparent; box-shadow: inset 0 0 0 1px var(--line); }
</style>
