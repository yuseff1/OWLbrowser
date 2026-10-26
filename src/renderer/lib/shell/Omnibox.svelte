<script lang="ts">
  import { owl, hostOf, faviconFor } from '../api';
  import { store } from '../stores.svelte';
  import { CompanionAvatar, Badge } from '../ui';
  import { Lock, Info, Star, Search, Clock, AppWindow, Globe, CornerDownLeft, Sparkles } from '@lucide/svelte';
  import { art } from '../api';

  type Sugg = { type: 'history' | 'bookmark' | 'search' | 'url' | 'tab' | 'command' | 'ask'; title: string; url: string; favicon?: string };

  let input = $state<HTMLInputElement | null>(null);
  let focused = $state(false);
  let dirty = $state(false);
  let text = $state('');
  let sugg = $state<Sugg[]>([]);
  let sel = $state(0);
  let starred = $state(false);

  const tab = $derived(store.activeTab);
  const comp = $derived(store.activeCompanion);
  const pretty = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const shown = $derived(!tab ? '' : tab.internal === 'newtab' ? '' : tab.internal ? `owl://${tab.internal}` : tab.url);
  const secure = $derived(!!tab && !tab.internal && tab.url.startsWith('https:'));
  const run = $derived(tab?.agentRunId ? store.runs.find((r) => r.id === tab.agentRunId) : null);

  $effect(() => { if (!focused) { text = pretty(shown); dirty = false; } });
  $effect(() => {
    if (store.omniboxFocus) queueMicrotask(() => { input?.focus(); input?.select(); });
  });
  $effect(() => {
    const u = tab?.url;
    if (!u || tab?.internal) { starred = false; return; }
    owl.isBookmarked(u).then((b: any) => (starred = !!b));
  });
  $effect(() => owl.on((type, p) => { if (type === 'command' && (p?.cmd === 'bookmark-added' || p?.cmd === 'bookmark-changed')) { const u = tab?.url; if (u) owl.isBookmarked(u).then((b: any) => (starred = !!b)); } }));

  // suggestions (debounced)
  let timer: any;
  $effect(() => {
    const q = text.trim();
    if (!focused || !dirty || !q) { sugg = []; return; }
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const res = ((await owl.suggest(q)) as Sugg[] | null) || [];
      const ask: Sugg = { type: 'ask', title: q, url: '' };
      const list = res.slice(0, 7);
      // "Ask <companion>" sits right after the top hit
      sugg = list.length ? [list[0], ask, ...list.slice(1)] : [ask];
      sel = 0;
    }, 50);
  });

  const open = $derived(focused && dirty && sugg.length > 0);
  let pushed = false;
  $effect(() => {
    if (open && !pushed) { pushed = true; store.pushOverlay(); }
    else if (!open && pushed) { pushed = false; store.popOverlay(); }
  });

  function go(s?: Sugg) {
    const q = text.trim();
    if (!s && !q) return;
    if (s?.type === 'ask') { store.panelOpen = true; store.panelPrefill = q; }
    else if (s?.type === 'tab') {
      const t = store.win.tabs.find((x) => x.url === s.url);
      if (t) owl.activateTab(t.id); else nav(s.url);
    } else nav(s ? s.url || s.title : q);
    dirty = false; sugg = [];
    input?.blur();
  }
  function nav(target: string) {
    if (tab) owl.navigate(tab.id, target); else owl.newTab(target);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); sel = (sel + 1) % sugg.length; }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); sel = (sel - 1 + sugg.length) % sugg.length; }
    else if (e.key === 'Enter') { e.preventDefault(); go(open ? sugg[sel] : undefined); }
    else if (e.key === 'Escape') {
      if (open) { sugg = []; dirty = false; text = shown; input?.select(); } else input?.blur();
    }
  }
  async function toggleStar() {
    if (!tab || tab.internal) return;
    starred = !!(await owl.toggleBookmark(tab.url, tab.title, tab.favicon));
    store.toast(starred ? 'Bookmarked' : 'Bookmark removed', starred ? tab.title : undefined, starred ? 'success' : 'info');
  }
  const iconFor = { history: Clock, bookmark: Star, search: Search, url: Globe, tab: AppWindow, command: CornerDownLeft } as Record<string, any>;
</script>

<div class="omni-wrap no-drag">
  <div class="omni" class:focused class:agent={!!run}>
    <span class="lead" title={tab?.internal ? 'OWL page' : secure ? 'Connection is secure' : 'Site information'}>
      {#if tab?.internal}
        <img src={art.mark} alt="" width="15" height="15" draggable="false" />
      {:else if focused}
        <Search size={14} strokeWidth={1.9} />
      {:else if secure}
        <Lock size={13} strokeWidth={2} />
      {:else if tab}
        <Info size={14} strokeWidth={1.9} />
      {/if}
    </span>
    <input bind:this={input} bind:value={text} spellcheck="false" autocomplete="off" aria-label="Search or enter address"
      role="combobox" aria-expanded={open} aria-controls="omni-list" aria-autocomplete="list"
      placeholder="Search or enter URL…"
      onfocus={() => { focused = true; text = shown; queueMicrotask(() => input?.select()); }}
      onblur={() => setTimeout(() => { focused = false; dirty = false; }, 120)}
      oninput={() => (dirty = true)} onkeydown={onKey}
      class:pretty={!focused} />
    {#if run && !focused}
      <span class="agent-chip" title="{comp?.name ?? ''} is working in this tab">
        <CompanionAvatar companion={run.companionId} size={18} />
        <span>{store.companions.find((c) => c.id === run.companionId)?.name ?? 'Agent'} is browsing</span>
      </span>
    {/if}
    {#if tab && tab.zoom && Math.abs(tab.zoom - 1) > 0.001 && !focused}
      <button class="zoom" onclick={() => owl.zoom(tab.id, 'reset')} aria-label="Reset zoom" title="Reset zoom">
        <Badge variant="outline">{Math.round(tab.zoom * 100)}%</Badge>
      </button>
    {/if}
    {#if tab && !tab.internal && !focused}
      <button class="star" class:on={starred} aria-label={starred ? 'Remove bookmark' : 'Bookmark this tab'} aria-pressed={starred} onclick={toggleStar}>
        <Star size={15} strokeWidth={1.8} fill={starred ? 'currentColor' : 'none'} />
      </button>
    {/if}
  </div>

  {#if open}
    <div id="omni-list" class="sugg glass-strong animate-in" role="listbox" aria-label="Suggestions">
      {#each sugg as s, i (s.type + s.url + s.title + i)}
        <button role="option" aria-selected={i === sel} class="row" class:sel={i === sel}
          onmouseenter={() => (sel = i)} onmousedown={(e) => { e.preventDefault(); go(s); }}>
          {#if s.type === 'ask'}
            <CompanionAvatar companion={comp} size={20} />
            <span class="t">Ask {comp?.name ?? 'Hoot'}: <span class="text-ink">{s.title}</span></span>
            <Sparkles size={13} strokeWidth={1.8} class="text-ink-3" />
          {:else}
            {@const Ico = iconFor[s.type] ?? Globe}
            {#if (s.type === 'history' || s.type === 'bookmark' || s.type === 'tab') && s.url}
              <img src={faviconFor(s.url, s.favicon)} alt="" width="16" height="16" class="rounded-[4px]" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />
            {:else}
              <span class="ic"><Ico size={15} strokeWidth={1.8} /></span>
            {/if}
            <span class="t">{s.title}</span>
            {#if s.type === 'tab'}<span class="meta">Switch to tab</span>
            {:else if s.url && s.type !== 'search'}<span class="meta">{hostOf(s.url)}</span>{/if}
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .omni-wrap { position: relative; flex: 1; max-width: 720px; min-width: 200px; }
  .omni {
    display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 6px 0 12px; border-radius: 999px;
    background: color-mix(in srgb, var(--ink) 5.5%, transparent); border: 1px solid transparent;
    transition: background-color .18s var(--ease-out), box-shadow .18s, border-color .18s;
  }
  .omni:hover { background: color-mix(in srgb, var(--ink) 7.5%, transparent); }
  .omni.focused { background: var(--surface); border-color: color-mix(in srgb, var(--accent) 45%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent), 0 6px 20px -8px rgba(0,0,0,.2); }
  .lead { display: grid; place-items: center; width: 16px; color: var(--ink-3); flex: none; }
  input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; font-size: 13.5px; }
  input.pretty { color: var(--ink-2); text-align: center; }
  .omni:not(.focused) input::placeholder { text-align: center; }
  input::placeholder { color: var(--ink-3); }
  .star, .zoom { display: grid; place-items: center; height: 26px; min-width: 26px; border-radius: 999px; border: 0; background: transparent; color: var(--ink-3); flex: none; }
  .star:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink); }
  .star.on { color: var(--accent); }
  .agent-chip { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px 0 3px; border-radius: 999px; font-size: 12px; color: var(--ink-2); background: var(--surface); box-shadow: 0 0 0 1px var(--line); white-space: nowrap; flex: none; }
  .sugg { position: absolute; left: 0; right: 0; top: 40px; z-index: 55; padding: 6px; border-radius: 18px; }
  .row { display: flex; align-items: center; gap: 11px; width: 100%; height: 36px; padding: 0 10px; border-radius: 11px; border: 0; background: transparent; color: var(--ink-2); font: inherit; font-size: 13.5px; text-align: left; }
  .row.sel { background: color-mix(in srgb, var(--ink) 7%, transparent); }
  .row .t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ink); }
  .row .meta { font-size: 12px; color: var(--ink-3); white-space: nowrap; }
  .ic { display: grid; place-items: center; width: 16px; color: var(--ink-3); }
</style>
