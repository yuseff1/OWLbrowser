<script lang="ts">
  import type { Component, Snippet } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';

  type Props = Omit<HTMLInputAttributes, 'size'> & {
    value?: string | number | null;
    icon?: Component<any>;
    size?: 'sm' | 'md' | 'lg';
    /** rounded pill field */
    pill?: boolean;
    /** soft neumorphic inset well */
    inset?: boolean;
    ref?: HTMLInputElement | null;
    trailing?: Snippet;
  };
  let {
    value = $bindable(''), icon: Icon, size = 'md', pill = false, inset = false, class: cls = '',
    ref = $bindable(null), trailing, ...rest
  }: Props = $props();
</script>

<label class="owl-field {size} {cls}" class:pill class:inset>
  {#if Icon}<Icon size={size === 'sm' ? 14 : 15} strokeWidth={1.8} class="ic" />{/if}
  <input bind:this={ref} bind:value spellcheck="false" {...rest} />
  {#if trailing}{@render trailing()}{/if}
</label>

<style>
  .owl-field {
    display: flex; align-items: center; gap: 8px; min-width: 0; padding: 0 12px;
    background: var(--surface); border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent); border-radius: 10px;
    transition: border-color .15s, box-shadow .15s;
  }
  .owl-field:focus-within { border-color: color-mix(in srgb, var(--accent) 55%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent); }
  .owl-field.pill { border-radius: 999px; padding: 0 14px; }
  .owl-field.inset { background: var(--neu-bg); box-shadow: var(--neu-in); border-color: transparent; }
  .sm { height: 30px; font-size: 12.5px; }
  .md { height: 38px; font-size: 13.5px; }
  .lg { height: 46px; font-size: 15px; }
  input { flex: 1; min-width: 0; height: 100%; background: transparent; border: 0; outline: 0; color: var(--ink); font: inherit; }
  input::placeholder { color: var(--ink-3); }
  .owl-field :global(.ic) { color: var(--ink-3); flex: none; }
</style>
