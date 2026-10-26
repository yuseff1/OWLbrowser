<script lang="ts">
  import type { Component } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Tooltip from './Tooltip.svelte';
  import { mergeProps } from 'svelte-toolbelt';

  type Props = Omit<HTMLButtonAttributes, 'children'> & {
    icon: Component<any>;
    /** accessible name + tooltip text */
    label: string;
    kbd?: string;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    active?: boolean;
    side?: 'top' | 'bottom' | 'left' | 'right';
    tooltip?: boolean;
    variant?: 'ghost' | 'solid' | 'glass';
    /** small dot or count in the corner */
    badge?: string | number | boolean | null;
    ref?: HTMLButtonElement | null;
  };
  let {
    icon: Icon, label, kbd, size = 'md', active = false, side = 'bottom', tooltip = true, variant = 'ghost',
    badge = null, class: cls = '', ref = $bindable(null), onclick, ...rest
  }: Props = $props();
  const dim = $derived({ xs: 22, sm: 28, md: 32, lg: 38 }[size]);
  const is = $derived({ xs: 13, sm: 15, md: 16.5, lg: 19 }[size]);
</script>

<Tooltip text={tooltip ? label : ''} {side} {kbd}>
  {#snippet children(tp)}
    <button bind:this={ref} type="button" aria-label={label} aria-pressed={active || undefined}
      {...mergeProps(tp, rest, { onclick })}
      class="owl-ib {variant} {cls}" class:on={active} style:width="{dim}px" style:height="{dim}px">
      <Icon size={is} strokeWidth={1.75} />
      {#if badge !== null && badge !== false}
        <span class="b" class:dot={badge === true}>{badge === true ? '' : badge}</span>
      {/if}
    </button>
  {/snippet}
</Tooltip>

<style>
  .owl-ib {
    position: relative; display: inline-grid; place-items: center; flex: none; border-radius: 9px;
    color: var(--ink-2); background: transparent; border: 0;
    transition: background-color .15s var(--ease-out), color .15s, transform .12s var(--ease-out);
  }
  .owl-ib:hover:not(:disabled) { background: color-mix(in srgb, var(--ink) 7%, transparent); color: var(--ink); }
  .owl-ib:active:not(:disabled) { transform: scale(.92); }
  .owl-ib:disabled { opacity: .35; }
  .owl-ib.on { color: var(--ink); background: color-mix(in srgb, var(--ink) 9%, transparent); }
  .solid { background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
  .glass { background: var(--glass-bg); box-shadow: var(--glass-rim), 0 0 0 1px var(--glass-border); backdrop-filter: var(--glass-blur); }
  .b {
    position: absolute; top: 1px; right: 0; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 99px;
    background: var(--accent); color: var(--accent-ink); font-size: 9.5px; font-weight: 600; line-height: 15px; text-align: center;
    box-shadow: 0 0 0 2px var(--ground); font-variant-numeric: tabular-nums;
  }
  .b.dot { min-width: 7px; width: 7px; height: 7px; padding: 0; top: 5px; right: 5px; }
</style>
