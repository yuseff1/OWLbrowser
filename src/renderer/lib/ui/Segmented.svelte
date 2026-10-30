<script lang="ts" generics="T extends string">
  import { ToggleGroup } from 'bits-ui';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  type Opt = { value: T; label: string; icon?: IconName };
  type Props = { options: Opt[]; value?: T; size?: 'sm' | 'md'; full?: boolean; label?: string; onValueChange?: (v: T) => void; class?: string };
  let { options, value = $bindable(), size = 'md', full = false, label = 'Options', onValueChange, class: cls = '' }: Props = $props();
</script>

<!-- soft neumorphic track; selected option rises as a raised pill -->
<ToggleGroup.Root type="single" aria-label={label} {value}
  onValueChange={(v) => { if (v) { value = v as T; onValueChange?.(v as T); } }}
  class="owl-seg neu-in {size} {full ? 'full' : ''} {cls}">
  {#each options as o (o.value)}
    <ToggleGroup.Item value={o.value} class="owl-seg-item" aria-label={o.label}>
      {#if o.icon}<Icon name={o.icon} size={14} />{/if}
      <span>{o.label}</span>
    </ToggleGroup.Item>
  {/each}
</ToggleGroup.Root>

<style>
  :global(.owl-seg) { display: inline-flex; gap: 2px; padding: 3px; border-radius: 12px; }
  :global(.owl-seg.full) { display: flex; width: 100%; }
  :global(.owl-seg.full .owl-seg-item) { flex: 1; }
  :global(.owl-seg-item) {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0; background: transparent;
    color: var(--ink-2); font: inherit; font-weight: 500; border-radius: 9px; white-space: nowrap;
    transition: background-color .18s var(--ease-out), color .18s, box-shadow .18s;
  }
  :global(.owl-seg.md .owl-seg-item) { height: 30px; padding: 0 14px; font-size: 13px; }
  :global(.owl-seg.sm .owl-seg-item) { height: 24px; padding: 0 10px; font-size: 12px; }
  :global(.owl-seg-item:hover) { color: var(--ink); }
  :global(.owl-seg-item[data-state='on']) {
    color: var(--ink); background: var(--surface);
    box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 2px 6px -2px rgba(0,0,0,.12);
  }
  :global(.dark .owl-seg-item[data-state='on']) { background: #2c2a30; box-shadow: 0 1px 2px rgba(0,0,0,.4); }
</style>
