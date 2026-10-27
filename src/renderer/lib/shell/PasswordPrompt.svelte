<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { owl } from '../api';
  import { store } from '../stores.svelte';
  import { Button } from '../ui';

  let { top = 88 }: { top?: number } = $props();
  let req = $state<{ id: string; origin: string; username: string } | null>(null);
  let pushed = false;
  $effect(() => owl.on((type, p) => { if (type === 'password-prompt') req = p; }));
  $effect(() => {
    if (req && !pushed) { pushed = true; store.pushOverlay(); }
    else if (!req && pushed) { pushed = false; store.popOverlay(); }
  });
  function answer(save: boolean) { if (req) owl.savePassword(req.id, save); req = null; }
  const host = $derived(req ? req.origin.replace(/^https?:\/\//, '') : '');
</script>

{#if req}
  <div class="pp glass-strong animate-in" style:top="{top}px" role="dialog" aria-label="Save password" tabindex="-1"
    onkeydown={(e) => { if (e.key === 'Escape') answer(false); }}>
    <div class="flex items-start gap-3">
      <span class="ic"><Icon name="key" size={16} /></span>
      <div class="min-w-0 flex-1">
        <div class="text-[13.5px] font-semibold">Save password for {host}?</div>
        <div class="mt-0.5 truncate text-[12.5px] text-ink-2">{req.username || 'No username'} · ••••••••</div>
        <p class="mt-2 text-[12px] text-ink-3">Stored encrypted on this device. Your companions can use it to sign in when you ask them to.</p>
      </div>
    </div>
    <div class="mt-3 flex justify-end gap-2">
      <Button size="sm" variant="ghost" onclick={() => answer(false)}>Not now</Button>
      <Button size="sm" variant="primary" onclick={() => answer(true)}>Save</Button>
    </div>
  </div>
{/if}

<style>
  .pp { position: fixed; left: 50%; transform: translateX(-50%); z-index: 75; width: 380px; padding: 16px; border-radius: 20px; }
  .ic { display: grid; place-items: center; width: 20px; height: 22px; color: var(--ink-2); flex: none; }
</style>
