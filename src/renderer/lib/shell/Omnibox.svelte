<script lang="ts">
  import type { IconName } from '../ui/icons';
  import Icon from '../ui/Icon.svelte';
  import { tick } from 'svelte';
  import { owl, hostOf, faviconFor } from '../api';
  import { store } from '../stores.svelte';
  import { CompanionAvatar, Badge } from '../ui';
  import { art } from '../api';
  import { hasPopupLayer, showPopup, iconMarkup, type PopupHandle, type PopupSuggestItem } from '../ui/popup';

  type Sugg = { type: 'history' | 'bookmark' | 'search' | 'url' | 'tab' | 'command' | 'ask'; title: string; url: string; favicon?: string; inline?: string };

  let input = $state<HTMLInputElement | null>(null);
  let wrap = $state<HTMLDivElement | null>(null);
  let focused = $state(false);
  let dirty = $state(false);
  let text = $state('');
  /** what the user actually typed (text may also hold an inline completion after it, selected) */
  let typed = $state('');
  /** the last edit deleted text: don't inline-complete again (Chrome) */
  let noInline = false;
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
    const q = typed.trim();
    if (!focused || !dirty || !q) { sugg = []; return; }
    clearTimeout(timer);
    const wantInline = !noInline;
    timer = setTimeout(async () => {
      const res = ((await owl.suggest(q, { inline: wantInline })) as Sugg[] | null) || [];
      if (typed.trim() !== q) return; // stale answer: the user kept typing
      applyInline(res[0]?.inline);
      const ask: Sugg = { type: 'ask', title: q, url: '' };
      const list = res.slice(0, 7);
      // "Ask <companion>" sits right after the top hit
      sugg = list.length ? [list[0], ask, ...list.slice(1)] : [ask];
      sel = 0;
    }, 50);
  });

  /** Chrome-style inline autocomplete: "wik" shows "wik[ipedia.org]" with the completion selected */
  function applyInline(done?: string) {
    if (!done || !input || input.value !== typed || input.selectionEnd !== typed.length) return;
    const tl = typed.toLowerCase();
    const full = tl.startsWith('www.') && !done.startsWith('www.') ? 'www.' + done : done;
    if (!full.startsWith(tl) || full.length <= typed.length) return;
    const shownText = typed + full.slice(typed.length);
    text = shownText;
    const from = typed.length;
    tick().then(() => { if (input && input.value === shownText) input.setSelectionRange(from, shownText.length, 'backward'); });
  }

  const open = $derived(focused && dirty && sugg.length > 0);
  const engine = $derived(({ google: 'Google', duckduckgo: 'DuckDuckGo', bing: 'Bing', brave: 'Brave', perplexity: 'Perplexity', kagi: 'Kagi' } as Record<string, string>)[store.settings?.searchEngine ?? 'google'] ?? 'Google');
  /** 'tab' suggestions carry the tab id in `url` */
  const tabOf = (s: Sugg) => (s.type === 'tab' ? store.win.tabs.find((x) => String(x.id) === s.url) ?? null : null);
  const urlOf = (s: Sugg) => tabOf(s)?.url ?? s.url;
  const metaOf = (s: Sugg) => (s.type === 'tab' ? 'Switch to tab' : s.type === 'search' ? `${engine} Search` : s.url && s.type !== 'url' ? hostOf(s.url) : '');

  // ---- Electron: draw the dropdown in the popup layer so it shows over the live page
  const ROW = 36, PAD = 6, INSET = 20, TOP = 4;
  let handle: PopupHandle | null = null;
  function popupItems(): PopupSuggestItem[] {
    return sugg.map((s) => {
      if (s.type === 'ask') return { title: s.title, prefix: `Ask ${comp?.name ?? 'Hoot'}: `, avatar: art.face(comp?.id ?? 'hoot'), trail: iconMarkup('sparkle', 14) };
      const u = urlOf(s);
      const fav = (s.type === 'history' || s.type === 'bookmark' || s.type === 'tab') && u ? faviconFor(u, s.favicon ?? tabOf(s)?.favicon) : '';
      return { title: s.title, meta: metaOf(s) || undefined, favicon: fav || undefined, icon: iconMarkup(iconFor[s.type] ?? 'globe') };
    });
  }
  $effect(() => {
    if (!hasPopupLayer) return;
    if (!open || !wrap) { handle?.close(); handle = null; return; }
    const r = wrap.getBoundingClientRect();
    const boxTop = r.top + 40, boxH = PAD * 2 + sugg.length * ROW;
    const spec = { kind: 'suggest' as const, inset: INSET, insetTop: TOP, sel, items: popupItems(), label: 'Suggestions',
      rect: { x: r.left - INSET, y: boxTop - TOP, width: r.width + INSET * 2, height: boxH + TOP + INSET } };
    if (handle?.open) handle.update(spec);
    else handle = showPopup(spec, (e) => {
      if (e.type === 'hover' && typeof e.index === 'number' && e.index >= 0) sel = e.index;
      else if (e.type === 'select' && typeof e.index === 'number' && sugg[e.index]) { handle = null; go(sugg[e.index]); }
      else if (e.type === 'dismiss') handle = null;
    });
  });
  $effect(() => () => { handle?.close(); handle = null; });

  let pushed = false;
  $effect(() => {
    if (hasPopupLayer) return;
    if (open && !pushed) { pushed = true; store.pushOverlay(); }
    else if (!open && pushed) { pushed = false; store.popOverlay(); }
  });

  function go(s?: Sugg) {
    const q = text.trim();
    if (!s && !q) return;
    if (s?.type === 'ask') { store.panelOpen = true; store.panelPrefill = q; }
    else if (s?.type === 'tab') {
      const t = tabOf(s);
      if (t) owl.activateTab(t.id); else nav(s.title);
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
    else if (e.key === 'Enter') {
      e.preventDefault();
      const q = text.trim();
      // Ctrl+Enter: "owl" → https://www.owl.com (Chrome) ; Alt+Enter: open in a new tab
      if ((e.ctrlKey || e.metaKey) && q && /^[\w-]+$/.test(q)) { nav(`https://www.${q}.com`); dirty = false; sugg = []; input?.blur(); return; }
      if (e.altKey && q) { const s = open ? sugg[sel] : undefined; owl.newTab(s && s.type !== 'ask' && s.type !== 'tab' ? s.url || s.title : q); dirty = false; sugg = []; input?.blur(); return; }
      go(open ? sugg[sel] : undefined);
    }
    else if (e.key === 'Escape') {
      e.preventDefault();
      // 1st Escape closes the suggestions and restores the address; the next one (or the first, when
      // nothing was open) also gives the keyboard back to the page, like Chrome
      const wasOpen = open || (dirty && text !== shown);
      sugg = []; dirty = false; typed = ''; text = shown;
      if (wasOpen) { queueMicrotask(() => input?.select()); return; }
      input?.blur();
      if (tab && !tab.internal) owl.command('focus-page');
    }
  }
  async function toggleStar() {
    if (!tab || tab.internal) return;
    starred = !!(await owl.toggleBookmark(tab.url, tab.title, tab.favicon));
    store.toast(starred ? 'Bookmarked' : 'Bookmark removed', starred ? tab.title : undefined, starred ? 'success' : 'info');
  }
  const iconFor = { history: 'clock', bookmark: 'star', search: 'search', url: 'globe', tab: 'window', command: 'arrow-enter-left' } as Record<string, IconName>;
</script>

<div class="omni-wrap no-drag" bind:this={wrap}>
  <div class="omni" class:focused class:agent={!!run}>
    <span class="lead" data-omni-lead title={tab?.internal ? 'OWL page' : secure ? 'Connection is secure' : 'Site information'}>
      {#if tab?.internal}
        <img src={art.mark} alt="" width="15" height="15" draggable="false" />
      {:else if focused}
        <Icon name="search" size={14} />
      {:else if secure}
        <Icon name="lock-closed" size={14} />
      {:else if tab}
        <Icon name="info" size={14} />
      {/if}
    </span>
    <input bind:this={input} bind:value={text} spellcheck="false" autocomplete="off" aria-label="Search or enter address"
      role="combobox" aria-expanded={open} aria-controls={hasPopupLayer ? undefined : 'omni-list'} aria-autocomplete="list"
      placeholder="Search or enter URL…"
      onfocus={() => { focused = true; text = shown; queueMicrotask(() => input?.select()); }}
      onblur={() => setTimeout(() => { focused = false; dirty = false; }, 120)}
      oninput={(e) => { dirty = true; noInline = !!(e as unknown as InputEvent).inputType?.startsWith('delete'); typed = text; }} onkeydown={onKey}
      class:pretty={!focused} />
    {#if hasPopupLayer}<span class="sr-only" aria-live="polite">{open && sugg[sel] ? (sugg[sel].type === 'ask' ? `Ask ${comp?.name ?? 'Hoot'}: ` : '') + sugg[sel].title + (metaOf(sugg[sel]) ? `, ${metaOf(sugg[sel])}` : '') : ''}</span>{/if}
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
    {#if tab && !tab.internal && !focused && /^https?:/.test(tab.url)}
      <button class="star" class:on={tab.reader} aria-label={tab.reader ? 'Exit reader mode' : 'Reader mode'} aria-pressed={!!tab.reader} title={tab.reader ? 'Exit reader mode (F9)' : 'Reader mode (F9)'} onclick={() => owl.toggleReader(tab.id)}>
        <Icon name="immersive-reader" size={16} filled={tab.reader} />
      </button>
    {/if}
    {#if tab && !tab.internal && !focused}
      <button class="star" class:on={starred} aria-label={starred ? 'Remove bookmark' : 'Bookmark this tab'} aria-pressed={starred} onclick={toggleStar}>
        <Icon name="star" size={16} filled={starred} />
      </button>
    {/if}
  </div>

  {#if open && !hasPopupLayer}
    <div id="omni-list" class="sugg glass-strong animate-in" role="listbox" aria-label="Suggestions">
      {#each sugg as s, i (s.type + s.url + s.title + i)}
        <button role="option" aria-selected={i === sel} class="row" class:sel={i === sel}
          onmouseenter={() => (sel = i)} onmousedown={(e) => { e.preventDefault(); go(s); }}>
          {#if s.type === 'ask'}
            <CompanionAvatar companion={comp} size={20} />
            <span class="t">Ask {comp?.name ?? 'Hoot'}: <span class="text-ink">{s.title}</span></span>
            <Icon name="sparkle" size={14} class="text-ink-3" />
          {:else}
            {@const ic = iconFor[s.type] ?? 'globe'}
            {#if (s.type === 'history' || s.type === 'bookmark' || s.type === 'tab') && urlOf(s)}
              <img src={faviconFor(urlOf(s), s.favicon)} alt="" width="16" height="16" class="rounded-[4px]" onerror={(e) => { const el = e.currentTarget as HTMLImageElement; const fb = faviconFor(urlOf(s)); if (fb && el.src !== fb) el.src = fb; else el.style.visibility = 'hidden'; }} />
            {:else}
              <span class="ic"><Icon name={ic} size={16} /></span>
            {/if}
            <span class="t">{s.title}</span>
            {#if metaOf(s)}<span class="meta">{metaOf(s)}</span>{/if}
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
    box-shadow: inset 0 1px 2px rgba(24, 22, 20, 0.06), 0 1px 0 var(--glass-rim-lo); /* recessed glass field */
    transition: background-color .18s var(--ease-out), box-shadow .18s, border-color .18s;
  }
  .omni:hover { background: color-mix(in srgb, var(--ink) 7.5%, transparent); }
  .omni.focused { background: var(--surface) var(--glass-sheen); border-color: color-mix(in srgb, var(--accent) 45%, transparent); box-shadow: var(--glass-rim), 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent), 0 6px 20px -8px rgba(0,0,0,.2); }
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
