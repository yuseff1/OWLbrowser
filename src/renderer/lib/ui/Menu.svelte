<script lang="ts" module>
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';
  /** a row ({label, icon, kbd, danger, disabled, onSelect}), a divider ({separator: true}) or a small heading ({heading}) */
  export type MenuItem = {
    label?: string;
    icon?: IconName;
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
  import { hasPopupLayer, openMenu, rectOf, type PopupHandle } from './popup';

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

  // ---- Electron: draw the menu in the popup layer (above native page views, page stays live)
  const uid = 'm' + Math.random().toString(36).slice(2, 9);
  let handle: PopupHandle | null = null;
  let viaKeyboard = false;
  function show(el: Element | null) {
    if (!el) { open = false; return; }
    handle?.close();
    const kb = viaKeyboard;
    viaKeyboard = false;
    handle = openMenu({ anchor: rectOf(el), side, align, width, items, keyboard: kb }, () => { handle = null; open = false; if (kb) (el as HTMLElement).focus?.({ preventScroll: true }); });
  }
  $effect(() => {
    if (!hasPopupLayer) return;
    if (open && !handle?.open) show(document.querySelector(`[data-owl-menu="${uid}"]`));
    else if (!open && handle?.open) { handle.close(); handle = null; }
  });
  $effect(() => () => { handle?.close(); handle = null; });
  const nativeTrigger = $derived({
    'data-owl-menu': uid, 'aria-haspopup': 'menu', 'aria-expanded': open,
    onclick: () => { open = !open; },
    onkeydown: (e: KeyboardEvent) => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); viaKeyboard = true; open = true; } },
  });

  let pushed = false;
  $effect(() => {
    if (!overlay || hasPopupLayer) return;
    if (open && !pushed) { pushed = true; store.pushOverlay(); }
    else if (!open && pushed) { pushed = false; store.popOverlay(); }
  });
  $effect(() => () => { if (pushed) { pushed = false; store.popOverlay(); } });
</script>

{#if hasPopupLayer}
  {@render trigger(nativeTrigger)}
{:else}
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
            {#if it.icon}<Icon name={it.icon} size={16} />{/if}
            <span class="truncate">{it.label}</span>
            {#if it.kbd}<span class="k">{kbdLabel(it.kbd)}</span>{/if}
          </DropdownMenu.Item>
        {/if}
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
{/if}
