<script lang="ts">
  import Icon from '../../../ui/Icon.svelte';
  import { osName } from '$lib/env';
  import { onMount } from 'svelte';
  import { owl } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Switch } from '$lib/ui';
  import Section from './Section.svelte';
  import Group from './Group.svelte';
  import Row from '../Row.svelte';
  import Note from '../Note.svelte';
  import { patch } from './patch';

  const s = $derived(store.settings);
  let available = $state<boolean | null>(null);
  onMount(() => { owl.appInfo().then((i: any) => (available = i?.computerUse ?? true)).catch(() => (available = true)); });

  const MODES = [
    { v: 'ask-risky', l: 'Ask before risky actions', d: 'Buying, sending, posting, deleting or signing in need your OK. Reading and browsing don’t.', icon: 'shield-checkmark' },
    { v: 'ask-always', l: 'Ask before every action', d: 'You approve each click and form. Slow, but nothing happens without you.', icon: 'shield-question' },
    { v: 'autonomous', l: 'Autonomous', d: 'Companions act on their own. Best for trusted, repeatable tasks.', icon: 'flash' },
  ] as const;
  let par = $state(4);
  $effect(() => { par = s?.maxParallelAgents ?? 4; });
</script>

<Section title="Companions & Agents" description="How much your companions can do without asking.">
  <Group label="Approvals" flush>
    <div class="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Approval mode">
      {#each MODES as m (m.v)}
        {@const on = (s?.approvalMode ?? 'ask-risky') === m.v}
        <button type="button" role="radio" aria-checked={on} onclick={() => patch({ approvalMode: m.v })}
          class="flex flex-col gap-2 rounded-2xl p-4 text-left transition-shadow {on ? 'bg-surface shadow-[0_0_0_1.5px_var(--ink)]' : 'bg-surface shadow-[0_0_0_1px_var(--line)] hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--ink)_20%,transparent)]'}">
          <Icon name={m.icon} size={20} class={on ? 'text-ink' : 'text-ink-2'} />
          <span class="text-[13.5px] font-medium">{m.l}</span>
          <span class="text-[12.5px] leading-snug text-ink-2">{m.d}</span>
        </button>
      {/each}
    </div>
  </Group>
  <Group>
    <Row title="Bots running at once" description="More parallel bots finish batches sooner but use more memory. Extra tasks wait in a queue.">
      <div class="flex w-[240px] items-center gap-3">
        <input type="range" min="1" max="8" step="1" bind:value={par} onchange={() => patch({ maxParallelAgents: par })} aria-label="Bots running at once" class="owl-range flex-1" style:--p="{((par - 1) / 7) * 100}%" />
        <span class="tnum w-5 text-right text-[14px] font-medium">{par}</span>
      </div>
    </Row>
    <Row title="Computer use" description={`Lets companions with this tool move the mouse and type in other ${osName} apps, not just in OWL.`}>
      {#snippet below()}
        {#if available === false}
          <Note kind="info" text="Not available on this computer yet." />
        {:else if s?.computerUse}
          <Note kind="warn" text="A companion can now control your whole screen when you give it a task that needs it. Keep an eye on it; you can stop any run from Agents." />
        {/if}
      {/snippet}
      <Switch checked={s?.computerUse ?? false} disabled={available === false} label="Computer use" onCheckedChange={(v) => patch({ computerUse: v })} />
    </Row>
  </Group>
</Section>
