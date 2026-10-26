<script lang="ts">
  import { Select } from 'bits-ui';
  import { Check, ChevronDown } from '@lucide/svelte';
  type Group = { heading: string; items: Array<{ value: string; label: string }> };
  type Props = { groups: Group[]; value?: string; placeholder?: string; label?: string; onValueChange?: (v: string) => void; class?: string; disabled?: boolean; size?: 'sm' | 'md' };
  let { groups, value = $bindable(''), placeholder = 'Select…', label, onValueChange, class: cls = '', disabled = false, size = 'md' }: Props = $props();
  const flat = $derived(groups.flatMap((g) => g.items));
  const current = $derived(flat.find((i) => i.value === value));
</script>

<Select.Root type="single" bind:value items={flat} disabled={disabled || !flat.length} onValueChange={(v) => onValueChange?.(v)}>
  <Select.Trigger aria-label={label || placeholder} class="owl-gsel {size} {cls}">
    <span class="truncate" class:ph={!current}>{current?.label ?? (flat.length ? placeholder : 'No models yet')}</span>
    <ChevronDown size={14} strokeWidth={1.8} class="shrink-0 opacity-60" />
  </Select.Trigger>
  <Select.Portal>
    <Select.Content sideOffset={6} class="owl-menu glass-strong z-[90] max-h-[340px] min-w-[var(--bits-select-anchor-width)] animate-in">
      <Select.Viewport class="p-1">
        {#each groups as g (g.heading)}
          <Select.Group>
            <Select.GroupHeading class="owl-menu-label">{g.heading}</Select.GroupHeading>
            {#each g.items as it (it.value)}
              <Select.Item value={it.value} label={it.label} class="owl-menu-item">
                {#snippet children({ selected })}
                  <span class="flex-1 truncate">{it.label}</span>
                  <Check size={14} strokeWidth={2} class={selected ? '' : 'invisible'} />
                {/snippet}
              </Select.Item>
            {/each}
          </Select.Group>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>

<style>
  :global(.owl-gsel) {
    display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 160px;
    background: var(--surface); border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent); border-radius: 10px;
    color: var(--ink); font: inherit; padding: 0 10px 0 12px;
  }
  :global(.owl-gsel.md) { height: 36px; font-size: 13.5px; }
  :global(.owl-gsel.sm) { height: 30px; font-size: 12.5px; border-radius: 999px; }
  :global(.owl-gsel[data-state='open']) { border-color: color-mix(in srgb, var(--accent) 55%, transparent); }
  :global(.owl-gsel[data-disabled]) { opacity: .55; }
  .ph { color: var(--ink-2); }
</style>
