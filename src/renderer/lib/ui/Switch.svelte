<script lang="ts">
  import { Switch } from 'bits-ui';
  type Props = { checked?: boolean; disabled?: boolean; label?: string; id?: string; onCheckedChange?: (v: boolean) => void; class?: string };
  let { checked = $bindable(false), disabled = false, label, id, onCheckedChange, class: cls = '' }: Props = $props();
</script>

<Switch.Root bind:checked {disabled} {id} aria-label={label} {onCheckedChange} class="owl-switch {cls}">
  <Switch.Thumb class="owl-thumb" />
</Switch.Root>

<style>
  :global(.owl-switch) {
    position: relative; width: 34px; height: 20px; flex: none; border-radius: 99px; border: 0; padding: 0;
    background: color-mix(in srgb, var(--ink) 16%, transparent); transition: background-color .2s var(--ease-out);
  }
  :global(.owl-switch[data-state='checked']) { background: var(--ink); }
  :global(.owl-switch[data-disabled]) { opacity: .45; }
  :global(.owl-thumb) {
    display: block; width: 16px; height: 16px; border-radius: 99px; background: #fff; margin-left: 2px;
    box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .22s var(--ease-spring);
  }
  :global(.dark .owl-switch[data-state='checked'] .owl-thumb) { background: var(--ground); }
  :global(.owl-thumb[data-state='checked']) { transform: translateX(14px); }
</style>
