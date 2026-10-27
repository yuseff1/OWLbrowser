<script lang="ts">
  import { owl } from '../api';
  import { store } from '../stores.svelte';
  import { IconButton } from '../ui';

  let q = $state('');
  let res = $state<{ active: number; total: number } | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  const tab = $derived(store.activeTab);

  $effect(() => { store.findFocus; if (store.findOpen) queueMicrotask(() => { input?.focus(); input?.select(); }); });
  let stepSeen = store.findStep.n;
  $effect(() => { const s = store.findStep; if (s.n !== stepSeen) { stepSeen = s.n; step(s.forward); } });
  $effect(() => owl.on((type, p) => { if (type === 'find-result' && p?.tabId === tab?.id) res = { active: p.active, total: p.total }; }));

  let last = '';
  $effect(() => {
    const t = q;
    if (!tab || tab.internal) return;
    if (!t) { res = null; owl.stopFind(tab.id); last = ''; return; }
    if (t !== last) { last = t; owl.find(tab.id, t, { forward: true, findNext: false }); }
  });
  function step(forward: boolean) { if (tab && q) owl.find(tab.id, q, { forward, findNext: true }); }
  function close() { if (tab) owl.stopFind(tab.id); store.findOpen = false; q = ''; res = null; last = ''; }
</script>

<div class="find" role="search" aria-label="Find in page">
  <input bind:this={input} bind:value={q} placeholder="Find in page" aria-label="Find in page"
    onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); step(!e.shiftKey); } else if (e.key === 'Escape') { e.preventDefault(); close(); } }} />
  <span class="n tnum" aria-live="polite">{res ? (res.total ? `${res.active} of ${res.total}` : 'No matches') : ''}</span>
  <span class="sep"></span>
  <IconButton icon="chevron-up" label="Previous match" kbd="Shift+Enter" size="sm" disabled={!res?.total} onclick={() => step(false)} />
  <IconButton icon="chevron-down" label="Next match" kbd="Enter" size="sm" disabled={!res?.total} onclick={() => step(true)} />
  <IconButton icon="dismiss" label="Close" kbd="Esc" size="sm" onclick={close} />
</div>

<style>
  .find { display: flex; align-items: center; gap: 2px; height: 36px; width: 380px; padding: 0 4px 0 14px; border-radius: 12px; background: var(--surface); box-shadow: 0 0 0 1px var(--line), 0 6px 18px -8px rgba(0,0,0,.18); }
  input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; font-size: 13px; }
  input::placeholder { color: var(--ink-3); }
  .n { font-size: 12px; color: var(--ink-3); padding: 0 6px; white-space: nowrap; }
  .sep { width: 1px; height: 18px; background: var(--line); margin: 0 4px; }
</style>
