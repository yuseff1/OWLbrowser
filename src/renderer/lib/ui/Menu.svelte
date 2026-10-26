<script lang="ts" module>
  import type { Component } from 'svelte';
  /** a row ({label, icon, kbd, danger, disabled, onSelect}), a divider ({separator: true}) or a small heading ({heading}) */
  export type MenuItem = {
    label?: string;
    icon?: Component<any>;
    kbd?: string;
    danger?: boolean;
    disabled?: boolean;
    onSelect?: () => void;
    separator?: boolean;
    heading?: string;
  };
</script>

<script lang="ts">
  import { DropdownMenu } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { store } from '../stores.svelte';
  import { kbdLabel } from './cn';

  type Props = {
    items: MenuItem[];
    open?: boolean;
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    overlay?: boolean;
    width?: number;
    trigger: Snippet<[Record<string, unknown>]>;
  };
  let { items, open = $bindable(false), side = 'bottom', align = 'end', overlay = false, width = 220, trigger }: Props = $props();

  let pushed = false;
  $effect(() => {
    if (!overlay) return;
    if (open && !pushed) { pushed = true; store.pushOverlay(); }
    else if (!open && pushed) { pushed = false; store.popOverlay(); }
  });
  $effect(() => () => { if (pushed) { pushed = false; store.popOverlay(); } });
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}{@render trigger(props)}{/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Portal>
    <DropdownMenu.Content {side} {align} sideOffset={6} collisionPadding={10} class="owl-menu glass-strong z-[65] animate-in" style="min-width:{width}px">
      {#each items as it, i (i)}
        {#if it.separator}
          <DropdownMenu.Separator class="owl-menu-sep" />
        {:else if it.heading}
          <div class="owl-menu-label">{it.heading}</div>
        {:else if it.label}
          <DropdownMenu.Item class="owl-menu-item {it.danger ? 'danger' : ''}" disabled={it.disabled} onSelect={() => it.onSelect?.()}>
            {#if it.icon}<it.icon size={15} strokeWidth={1.75} />{/if}
            <span class="truncate">{it.label}</span>
            {#if it.kbd}<span class="k">{kbdLabel(it.kbd)}</span>{/if}
          </DropdownMenu.Item>
        {/if}
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
