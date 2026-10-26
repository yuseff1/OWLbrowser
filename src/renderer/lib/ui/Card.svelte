<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  type Props = HTMLAttributes<HTMLDivElement> & {
    /** glass = liquid glass (floating things); flat = surface + hairline (default); neu = soft raised; inset = soft well */
    variant?: 'flat' | 'glass' | 'neu' | 'inset';
    pad?: 'none' | 'sm' | 'md' | 'lg';
    interactive?: boolean;
    children?: Snippet;
  };
  let { variant = 'flat', pad = 'md', interactive = false, class: cls = '', children, ...rest }: Props = $props();
</script>

<div class="owl-card {variant} pad-{pad} {cls}" class:interactive {...rest}>
  {@render children?.()}
</div>

<style>
  .owl-card { border-radius: 18px; position: relative; }
  .flat { background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
  .glass { background: var(--glass-bg); backdrop-filter: var(--glass-blur); border: 1px solid var(--glass-border); box-shadow: var(--glass-rim), var(--glass-shadow); }
  .neu { background: var(--neu-bg); box-shadow: var(--neu-out); }
  .inset { background: var(--neu-bg); box-shadow: var(--neu-in); }
  .pad-none { padding: 0; } .pad-sm { padding: 12px; } .pad-md { padding: 18px; } .pad-lg { padding: 24px; }
  .interactive { transition: box-shadow .18s var(--ease-out), transform .18s var(--ease-out); }
  .interactive:hover { box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 16%, transparent); }
  .interactive:active { transform: scale(.995); }
</style>
