<script lang="ts">
  import type { Snippet } from 'svelte';
  import './kit.css';
  type Props = {
    title: string;
    description?: string;
    /** @deprecated ignored: all pages share --owl-content-w (kit.css) */
    width?: number;
    actions?: Snippet;
    toolbar?: Snippet;
    children?: Snippet;
    class?: string;
    scroller?: HTMLElement | null;
  };
  // `width` is kept for compatibility but ignored: every internal page (and Settings) shares one content
  // column, --owl-content-w in kit.css, so switching pages never makes the layout jump.
  let { title, description, width: _width, actions, toolbar, children, class: cls = '', scroller = $bindable(null) }: Props = $props();
</script>

<div bind:this={scroller} class="owl-page h-full overflow-y-auto overflow-x-hidden {cls}">
  <div class="owl-col mx-auto w-full px-8 pb-20 pt-10">
    <header class="flex flex-wrap items-start gap-x-6 gap-y-3">
      <div class="min-w-0 flex-1">
        <h1 class="text-[20px] font-semibold leading-7 tracking-[-0.015em] text-ink">{title}</h1>
        {#if description}<p class="mt-0.5 text-[13.5px] leading-5 text-ink-2">{description}</p>{/if}
      </div>
      {#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>{/if}
    </header>
    {#if toolbar}<div class="mt-6 flex flex-wrap items-center gap-3">{@render toolbar()}</div>{/if}
    <div class="mt-6">{@render children?.()}</div>
  </div>
</div>
