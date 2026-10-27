<script lang="ts">
  import Icon from '../../ui/Icon.svelte';
  import type { IconName } from '../../ui/icons';
  import type { Snippet } from 'svelte';
  type Props = { kind?: 'error' | 'info' | 'ok' | 'warn'; text?: string; retry?: () => void; children?: Snippet; class?: string };
  let { kind = 'info', text, retry, children, class: cls = '' }: Props = $props();
  const ic = $derived<IconName>(kind === 'error' || kind === 'warn' ? 'error-circle' : kind === 'ok' ? 'checkmark-circle' : 'info');
</script>

<div class="owl-note {kind} {cls}" role={kind === 'error' ? 'alert' : 'status'}>
  <Icon name={ic} size={16} class="ic" />
  <div class="min-w-0 flex-1">{#if text}{text}{/if}{@render children?.()}</div>
  {#if retry}<button type="button" class="retry" onclick={retry}>Retry</button>{/if}
</div>
