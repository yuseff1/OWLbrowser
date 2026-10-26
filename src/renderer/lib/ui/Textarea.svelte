<script lang="ts">
  import type { HTMLTextareaAttributes } from 'svelte/elements';
  type Props = HTMLTextareaAttributes & { value?: string; autosize?: boolean; maxHeight?: number; ref?: HTMLTextAreaElement | null; bare?: boolean };
  let { value = $bindable(''), autosize = true, maxHeight = 220, class: cls = '', ref = $bindable(null), bare = false, ...rest }: Props = $props();

  function fit() {
    if (!autosize || !ref) return;
    ref.style.height = 'auto';
    ref.style.height = Math.min(ref.scrollHeight, maxHeight) + 'px';
  }
  $effect(() => { value; queueMicrotask(fit); });
</script>

<textarea bind:this={ref} bind:value rows={1} class="owl-ta {cls}" class:bare {...rest}></textarea>

<style>
  .owl-ta {
    width: 100%; resize: none; font: inherit; color: var(--ink); line-height: 1.5;
    background: var(--surface); border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent); border-radius: 12px; padding: 9px 12px; outline: 0;
  }
  .owl-ta:focus { border-color: color-mix(in srgb, var(--accent) 55%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
  .owl-ta.bare, .owl-ta.bare:focus { background: transparent; border: 0; box-shadow: none; padding: 0; border-radius: 0; }
  .owl-ta::placeholder { color: var(--ink-3); }
</style>
