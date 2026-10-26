<script lang="ts">
  import { CircleAlert, Info, CircleCheck } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  type Props = { kind?: 'error' | 'info' | 'ok' | 'warn'; text?: string; retry?: () => void; children?: Snippet; class?: string };
  let { kind = 'info', text, retry, children, class: cls = '' }: Props = $props();
  const Icon = $derived(kind === 'error' || kind === 'warn' ? CircleAlert : kind === 'ok' ? CircleCheck : Info);
</script>

<div class="owl-note {kind} {cls}" role={kind === 'error' ? 'alert' : 'status'}>
  <Icon size={15} strokeWidth={1.8} class="ic" />
  <div class="min-w-0 flex-1">{#if text}{text}{/if}{@render children?.()}</div>
  {#if retry}<button type="button" class="retry" onclick={retry}>Retry</button>{/if}
</div>
