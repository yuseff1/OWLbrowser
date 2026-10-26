<script lang="ts">
  import { ContextMenu } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import type { MenuItem } from './Menu.svelte';
  import { store } from '../stores.svelte';
  import { kbdLabel } from './cn';

  type Props = {
    /** items are computed lazily when the menu opens */
    items: () => MenuItem[];
    /** freeze the page under glass while open (menus that can overlap the web page) */
    overlay?: boolean;
    children: Snippet<[Record<string, unknown>]>;
  };
  let { items, overlay = true, children }: Props = $props();
  let open = $state(false);
  let list = $state<MenuItem[]>([]);
  let pushed = false;
  function onOpenChange(o: boolean) {
    if (o) list = items();
    if (!overlay) return;
    if (o && !pushed) { pushed = true; store.pushOverlay(); }
    else if (!o && pushed) { pushed = false; store.popOverlay(); }
  }
  $effect(() => () => { if (pushed) { pushed = false; store.popOverlay(); } });
</script>

<ContextMenu.Root bind:open {onOpenChange}>
  <ContextMenu.Trigger>
    {#snippet child({ props })}{@render children(props)}{/snippet}
  </ContextMenu.Trigger>
  <ContextMenu.Portal>
    <ContextMenu.Content class="owl-menu glass-strong z-[65] animate-in" style="min-width:220px" collisionPadding={10}>
      {#each list as it, i (i)}
        {#if it.separator}
          <ContextMenu.Separator class="owl-menu-sep" />
        {:else if it.heading}
          <div class="owl-menu-label">{it.heading}</div>
        {:else if it.label}
          <ContextMenu.Item class="owl-menu-item {it.danger ? 'danger' : ''}" disabled={it.disabled} onSelect={() => it.onSelect?.()}>
            {#if it.icon}<it.icon size={15} strokeWidth={1.75} />{/if}
            <span class="truncate">{it.label}</span>
            {#if it.kbd}<span class="k">{kbdLabel(it.kbd)}</span>{/if}
          </ContextMenu.Item>
        {/if}
      {/each}
    </ContextMenu.Content>
  </ContextMenu.Portal>
</ContextMenu.Root>
