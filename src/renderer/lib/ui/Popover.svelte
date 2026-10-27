<script lang="ts">
  import { Popover } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { store } from '../stores.svelte';

  type Props = {
    open?: boolean;
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    sideOffset?: number;
    /** freeze the page under a glass screenshot while open (needed when the popover overlaps the web page) */
    overlay?: boolean;
    width?: number | string;
    class?: string;
    trigger: Snippet<[Record<string, unknown>]>;
    children: Snippet<[{ close: () => void }]>;
    onOpenChange?: (o: boolean) => void;
  };
  let { open = $bindable(false), side = 'bottom', align = 'end', sideOffset = 8, overlay = true, width = 320, class: cls = '', trigger, children, onOpenChange }: Props = $props();

  let pushed = false;
  let contentEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!overlay) return;
    if (open && !pushed && contentEl) {
      // wait for positioning, then freeze the page only if the popover actually overlaps it
      const el = contentEl;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!open || pushed) return;
        pushed = true;
        store.pushOverlay(el.getBoundingClientRect());
      }));
    } else if (!open && pushed) { pushed = false; store.popOverlay(); }
  });
  $effect(() => () => { if (pushed) { pushed = false; store.popOverlay(); } });
  const close = () => (open = false);
</script>

<Popover.Root bind:open {onOpenChange}>
  <Popover.Trigger>
    {#snippet child({ props })}{@render trigger(props)}{/snippet}
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content bind:ref={contentEl} {side} {align} {sideOffset} collisionPadding={10} onOpenAutoFocus={(e) => e.preventDefault()}
      class="owl-pop glass-strong z-[60] animate-in {cls}" style="width:{typeof width === 'number' ? width + 'px' : width}">
      {@render children({ close })}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
