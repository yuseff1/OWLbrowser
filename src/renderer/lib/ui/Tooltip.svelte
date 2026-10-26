<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import Kbd from './Kbd.svelte';

  type Props = {
    text: string;
    side?: 'top' | 'bottom' | 'left' | 'right';
    kbd?: string;
    delay?: number;
    disabled?: boolean;
    /** render the trigger yourself: spread `props` onto your element */
    children: Snippet<[Record<string, unknown>]>;
  };
  let { text, side = 'bottom', kbd, delay = 500, disabled = false, children }: Props = $props();
</script>

<Tooltip.Provider delayDuration={delay} disableHoverableContent>
  <Tooltip.Root disabled={disabled || !text}>
    <Tooltip.Trigger>
      {#snippet child({ props })}{@render children(props)}{/snippet}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content {side} sideOffset={6} collisionPadding={8}
        class="owl-tip z-[80] flex items-center gap-2 rounded-[9px] px-2.5 py-1 text-[12px] font-medium text-ink glass-strong animate-in">
        {text}{#if kbd}<Kbd keys={kbd} />{/if}
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
