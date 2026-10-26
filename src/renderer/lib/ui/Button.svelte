<script lang="ts">
  import type { Snippet, Component } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Spinner from './Spinner.svelte';

  type Props = HTMLButtonAttributes & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
    size?: 'sm' | 'md' | 'lg';
    pill?: boolean;
    loading?: boolean;
    icon?: Component<any>;
    iconRight?: Component<any>;
    full?: boolean;
    ref?: HTMLButtonElement | null;
    children?: Snippet;
  };
  let {
    variant = 'secondary', size = 'md', pill = true, loading = false, icon: Icon, iconRight: IconR, full = false,
    class: cls = '', type = 'button', disabled, ref = $bindable(null), children, ...rest
  }: Props = $props();
  const is = $derived(size === 'sm' ? 14 : size === 'lg' ? 17 : 15);
</script>

<button bind:this={ref} {type} disabled={disabled || loading} aria-busy={loading || undefined}
  class="owl-btn {variant} {size} {pill ? 'pill' : ''} {full ? 'full' : ''} {cls}" {...rest}>
  {#if loading}<Spinner size={is} />{:else if Icon}<Icon size={is} strokeWidth={1.8} />{/if}
  {#if children}<span class="truncate">{@render children()}</span>{/if}
  {#if IconR}<IconR size={is} strokeWidth={1.8} />{/if}
</button>

<style>
  .owl-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px; flex: none;
    font: inherit; font-weight: 500; letter-spacing: -0.005em; white-space: nowrap; cursor: default;
    border: 1px solid transparent; border-radius: 10px; color: var(--ink); background: transparent;
    transition: background-color .15s var(--ease-out), box-shadow .15s, transform .12s var(--ease-out), opacity .15s;
  }
  .owl-btn:active:not(:disabled) { transform: scale(0.97); }
  .owl-btn:disabled { opacity: .45; }
  .pill { border-radius: 999px; }
  .full { width: 100%; }
  .sm { height: 28px; padding: 0 11px; font-size: 12.5px; }
  .md { height: 34px; padding: 0 15px; font-size: 13.5px; }
  .lg { height: 42px; padding: 0 22px; font-size: 14.5px; }

  /* primary = black pill on light, white pill on dark */
  .primary { background: var(--ink); color: var(--ground); box-shadow: 0 1px 2px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.12); }
  .primary:hover:not(:disabled) { background: color-mix(in srgb, var(--ink) 88%, var(--ground)); }
  .secondary { background: var(--surface); border-color: var(--line); box-shadow: 0 1px 2px rgba(0,0,0,.04); }
  .secondary:hover:not(:disabled) { background: var(--surface-2); }
  .ghost { color: var(--ink-2); }
  .ghost:hover:not(:disabled) { background: color-mix(in srgb, var(--ink) 6%, transparent); color: var(--ink); }
  .danger { color: #d43a3f; background: transparent; border-color: color-mix(in srgb, #e5484d 30%, transparent); }
  .danger:hover:not(:disabled) { background: color-mix(in srgb, #e5484d 9%, transparent); }
  .accent { background: var(--accent); color: var(--accent-ink); }
  .accent:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 88%, black); }
</style>
