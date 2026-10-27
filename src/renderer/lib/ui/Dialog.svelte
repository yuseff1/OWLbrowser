<script lang="ts">
  import Icon from './Icon.svelte';
  import { Dialog } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { store } from '../stores.svelte';

  type Props = {
    open?: boolean;
    title?: string;
    description?: string;
    width?: number;
    overlay?: boolean;
    class?: string;
    children?: Snippet;
    footer?: Snippet;
    onOpenChange?: (o: boolean) => void;
  };
  let { open = $bindable(false), title, description, width = 480, overlay = true, class: cls = '', children, footer, onOpenChange }: Props = $props();

  let pushed = false;
  $effect(() => {
    if (!overlay) return;
    if (open && !pushed) { pushed = true; store.pushOverlay(); }
    else if (!open && pushed) { pushed = false; store.popOverlay(); }
  });
  $effect(() => () => { if (pushed) { pushed = false; store.popOverlay(); } });
</script>

<Dialog.Root bind:open {onOpenChange}>
  <Dialog.Portal>
    <Dialog.Overlay class="owl-dialog-backdrop" />
    <Dialog.Content class="owl-dialog glass-strong glass-lens {cls}" style="width:min({width}px, calc(100vw - 32px))">
      {#if title}
        <div class="mb-4 flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <Dialog.Title class="text-[16px] font-semibold tracking-[-0.01em] text-ink">{title}</Dialog.Title>
            {#if description}<Dialog.Description class="mt-1 text-[13px] text-ink-2">{description}</Dialog.Description>{/if}
          </div>
          <Dialog.Close class="-mr-1 -mt-1 grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink" aria-label="Close">
            <Icon name="dismiss" size={16} />
          </Dialog.Close>
        </div>
      {/if}
      {@render children?.()}
      {#if footer}<div class="mt-5 flex items-center justify-end gap-2">{@render footer()}</div>{/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
