<script lang="ts">
  import Icon from './Icon.svelte';
  import { Select } from 'bits-ui';

  type Item = { value: string; label: string; disabled?: boolean; hint?: string };
  type Props = { items: Item[]; value?: string; placeholder?: string; size?: 'sm' | 'md'; label?: string; onValueChange?: (v: string) => void; class?: string; disabled?: boolean };
  let { items, value = $bindable(''), placeholder = 'Select…', size = 'md', label, onValueChange, class: cls = '', disabled = false }: Props = $props();
  const current = $derived(items.find((i) => i.value === value));
</script>

<Select.Root type="single" bind:value {items} {disabled} onValueChange={(v) => onValueChange?.(v)}>
  <Select.Trigger aria-label={label || placeholder} class="owl-sel {size} {cls}">
    <span class="truncate" class:ph={!current}>{current?.label ?? placeholder}</span>
    <Icon name="chevron-down" size={14} class="opacity-60" />
  </Select.Trigger>
  <Select.Portal>
    <Select.Content sideOffset={6} class="owl-menu glass-strong z-[90] max-h-[320px] min-w-[var(--bits-select-anchor-width)] animate-in">
      <Select.Viewport class="p-1">
        {#each items as it (it.value)}
          <Select.Item value={it.value} label={it.label} disabled={it.disabled} class="owl-menu-item">
            {#snippet children({ selected })}
              <span class="flex-1 truncate">{it.label}</span>
              {#if it.hint}<span class="text-[11.5px] text-ink-3">{it.hint}</span>{/if}
              <Icon name="checkmark" size={14} class={selected ? '' : 'invisible'} />
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>

<style>
  :global(.owl-sel) {
    display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 120px;
    background: var(--surface); border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent); border-radius: 10px;
    color: var(--ink); font: inherit; padding: 0 10px 0 12px;
  }
  :global(.owl-sel.md) { height: 36px; font-size: 13.5px; }
  :global(.owl-sel.sm) { height: 28px; font-size: 12.5px; border-radius: 8px; }
  :global(.owl-sel[data-state='open']) { border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
  .ph { color: var(--ink-3); }
</style>
