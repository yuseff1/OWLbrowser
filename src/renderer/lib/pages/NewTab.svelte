<script lang="ts">
  import { onMount } from 'svelte';
  import type { TabState, HistoryEntry, ModelProvider } from '$shared/types';
  import { owl, art, hostOf, faviconFor } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { CompanionAvatar, Badge, Menu, Tooltip } from '$lib/ui';
  import GroupedSelect from './kit/GroupedSelect.svelte';
  import { openPage, looksLikeUrl, statusMeta, lastStep, fmtDuration, modelGroups, refKey, parseRef } from './kit/util';
  import './kit/kit.css';
  import { Plus, Pencil, ArrowUp, Mic, Search, Globe, Sparkles, Bot, Blocks, CircleHelp, ChevronLeft, ChevronRight, CalendarClock, Telescope, Cable, Download, PanelRight, CornerDownLeft } from '@lucide/svelte';

  let { tab }: { tab: TabState } = $props();

  let text = $state('');
  let ta: HTMLTextAreaElement | null = $state(null);
  let userName = $state('');
  let sites = $state<Array<{ host: string; url: string; title: string; favicon: string; visits: number }>>([]);
  let sitesLoaded = $state(false);
  let providers = $state<ModelProvider[]>([]);
  let carousel: HTMLDivElement | null = $state(null);
  let now = $state(Date.now());
  let broken = $state<Record<string, boolean>>({});

  const hired = $derived(store.companions.filter((c) => c.hired));
  const active = $derived(store.activeCompanion);
  const color = $derived(active?.look?.body || 'var(--accent)');
  const isUrl = $derived(looksLikeUrl(text));
  const live = $derived(store.liveRuns.slice(0, 3));
  const wallpaper = $derived(store.settings?.homeWallpaper ?? 'aurora');
  const groups = $derived([{ heading: 'OWL', items: [{ value: '', label: 'Default model' }] }, ...modelGroups(providers)]);
  const modelValue = $derived(refKey(active?.model ?? null));
  const modelLabel = $derived(active?.model?.model ? active.model.model.split('/').pop()! : 'Default');

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 19 ? 'Good afternoon' : 'Good evening';

  onMount(() => {
    owl.onboarding().then((o: any) => { userName = o?.userName || ''; }).catch(() => {});
    owl.providers().then((p: any) => (providers = p || [])).catch(() => {});
    owl.history('', 0, 400).then((h: any) => {
      const by = new Map<string, { host: string; url: string; title: string; favicon: string; visits: number }>();
      for (const e of (h || []) as HistoryEntry[]) {
        if (!/^https?:/.test(e.url)) continue;
        const host = hostOf(e.url);
        const cur = by.get(host);
        if (cur) cur.visits += e.visits;
        else by.set(host, { host, url: new URL(e.url).origin, title: host.split('.').slice(-2, -1)[0] || host, favicon: faviconFor(e.url, e.favicon), visits: e.visits });
      }
      sites = [...by.values()].sort((a, b) => b.visits - a.visits).slice(0, 8);
    }).catch(() => {}).finally(() => (sitesLoaded = true));
    const t = setInterval(() => (now = Date.now()), 1000);
    queueMicrotask(() => ta?.focus());
    return () => clearInterval(t);
  });

  function fit() { if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'; }
  $effect(() => { text; queueMicrotask(fit); });

  async function submit(mode: 'auto' | 'search' | 'ask' = 'auto') {
    const t = text.trim();
    if (!t) return;
    if (mode === 'search' || (mode === 'auto' && isUrl)) { owl.navigate(tab.id, t); text = ''; return; }
    const cid = store.activeCompanionId;
    text = '';
    try {
      const run = (await owl.startRun(cid, t, { useCurrentTab: false, background: false })) as { id: string } | null;
      if (run?.id) store.panelRunId = run.id;
      store.panelOpen = true;
    } catch (e: any) { text = t; store.toast('Couldn’t start the task', e?.message || String(e), 'error'); }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(e.altKey ? 'search' : 'auto'); }
  }

  let listening = $state(false);
  function voice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { store.toast('Voice input isn’t available yet', 'Type your request for now.'); return; }
    try {
      const r = new SR();
      r.lang = navigator.language || 'en-US';
      r.interimResults = true;
      r.onresult = (ev: any) => { text = Array.from(ev.results).map((x: any) => x[0].transcript).join(''); };
      r.onend = () => (listening = false);
      r.onerror = () => { listening = false; store.toast('Voice input stopped', 'Microphone access failed.', 'error'); };
      listening = true;
      r.start();
    } catch { listening = false; }
  }

  async function setModel(v: string) {
    if (!active) return;
    const ref = parseRef(v);
    await owl.saveCompanion({ id: active.id, model: ref });
    await store.refreshCompanions();
  }

  const ideas = [
    { icon: CalendarClock, title: 'Set up a routine', body: 'A morning brief or a price check that runs on its own.', act: () => openPage('owl://routines', tab.id) },
    { icon: Telescope, title: 'Do online research', body: 'Ask a question; get a sourced answer from several sites.', act: () => { text = 'Research and compare '; ta?.focus(); } },
    { icon: Cable, title: 'Connect my apps', body: 'Give your companions Notion, GitHub, Linear and more.', act: () => openPage('owl://apps', tab.id) },
    { icon: Download, title: 'Import from Chrome', body: 'Bring bookmarks, history and passwords across.', act: () => openPage('owl://settings#import', tab.id) },
    { icon: PanelRight, title: 'Work in this tab', body: 'Open any site, then press Ctrl+J to hand it to a companion.', act: () => { store.panelOpen = true; } },
  ];
  function scrollIdeas(dir: 1 | -1) { carousel?.scrollBy({ left: dir * 260, behavior: 'smooth' }); }

  const plusItems = $derived([
    { label: 'Search the web instead', icon: Search, onSelect: () => submit('search') },
    { label: 'Use a skill…', icon: Sparkles, onSelect: () => openPage('owl://skills', tab.id) },
    { label: 'Spin up several bots…', icon: Bot, onSelect: () => openPage('owl://agents', tab.id) },
  ]);
</script>

<div class="relative h-full overflow-y-auto overflow-x-hidden" class:halftone={wallpaper !== 'none'}>
  {#if wallpaper === 'aurora'}
    <div aria-hidden="true" class="pointer-events-none absolute inset-0 overflow-hidden">
      <div class="absolute left-1/2 top-[-18%] h-[520px] w-[820px] -translate-x-1/2 rounded-full opacity-[.16] blur-[90px] dark:opacity-[.12]" style:background="radial-gradient(closest-side, {color}, transparent)"></div>
      <div class="absolute bottom-[-25%] right-[-10%] h-[420px] w-[620px] rounded-full opacity-[.10] blur-[90px]" style:background="radial-gradient(closest-side, var(--accent), transparent)"></div>
    </div>
  {:else if wallpaper === 'dusk'}
    <div aria-hidden="true" class="pointer-events-none absolute inset-0" style="background: linear-gradient(180deg, color-mix(in srgb, #ffb38a 14%, transparent), transparent 45%, color-mix(in srgb, #7a6cff 10%, transparent))"></div>
  {/if}

  <main class="relative mx-auto flex min-h-full w-full max-w-[760px] flex-col items-center px-8 pb-14 pt-[6vh]">
    <!-- companion switcher -->
    <div class="glass flex h-10 items-center gap-1 rounded-full p-1" role="radiogroup" aria-label="Companion">
      {#each (hired.length ? hired : store.companions.slice(0, 1)) as c (c.id)}
        {@const on = c.id === active?.id}
        <button type="button" role="radio" aria-checked={on} aria-label={c.name} onclick={() => store.setCompanion(c.id)}
          class="flex h-8 items-center gap-2 rounded-full transition-[background-color,padding] duration-200 {on ? 'bg-surface pl-1 pr-3 shadow-[0_1px_3px_rgba(0,0,0,.12)]' : 'px-1 opacity-75 hover:opacity-100'}">
          <CompanionAvatar companion={c} size={24} />
          {#if on}<span class="text-[13px] font-medium">{c.name}</span>{/if}
        </button>
      {/each}
      <span class="mx-1 h-4 w-px bg-line" aria-hidden="true"></span>
      <button type="button" onclick={() => openPage('owl://companions', tab.id)} class="flex h-8 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink">
        <Plus size={14} strokeWidth={2} /> Add
      </button>
    </div>

    <!-- companion stage -->
    <div class="relative mt-6">
      {#key active?.id}
        <img src={art.companion(active?.id ?? 'hoot')} alt="{active?.name ?? 'Companion'}, {active?.role ?? ''}" class="animate-bob h-[112px] w-[112px] select-none object-contain drop-shadow-[0_10px_14px_rgba(20,10,40,.18)]" draggable="false" />
      {/key}
      <Tooltip text="Edit {active?.name ?? 'companion'}" side="right">
        {#snippet children(p)}
          <button {...p} type="button" aria-label="Edit {active?.name ?? 'companion'}" onclick={() => openPage('owl://companions', tab.id)}
            class="glass absolute -right-2 bottom-1 grid size-7 place-items-center rounded-full text-ink-2 hover:text-ink">
            <Pencil size={13} strokeWidth={1.9} />
          </button>
        {/snippet}
      </Tooltip>
    </div>
    <h1 class="mt-4 text-center text-[22px] font-semibold tracking-[-0.02em]">{greeting}{userName ? `, ${userName}` : ''}</h1>
    <p class="mt-1 text-center text-[13.5px] text-ink-2">{active ? `${active.name} · ${active.role}` : 'Your companions are ready'}</p>

    <!-- composer -->
    <form class="neu mt-6 w-full rounded-[26px] p-3.5 pl-5 transition-shadow focus-within:shadow-[var(--neu-out),0_0_0_2px_color-mix(in_srgb,var(--accent)_35%,transparent)]" onsubmit={(e) => { e.preventDefault(); submit(); }}>
      <label for="owl-composer" class="sr-only">Ask {active?.name ?? 'your companion'}, or type a web address</label>
      <textarea id="owl-composer" bind:this={ta} bind:value={text} onkeydown={onKey} rows="2" spellcheck="false"
        placeholder="Work with {active?.name ?? 'Hoot'}…  or type a web address"
        class="owl-bare-input block max-h-[220px] min-h-[52px] w-full resize-none bg-transparent pr-2 pt-1.5 text-[15px] leading-[1.55] text-ink outline-none placeholder:text-ink-3"></textarea>
      <div class="mt-2 flex items-center gap-2">
        <Menu items={plusItems} side="bottom" align="start">
          {#snippet trigger(p)}
            <button {...p} type="button" aria-label="More options" class="grid size-8 place-items-center rounded-full text-ink-2 shadow-[0_0_0_1px_var(--line)] hover:bg-surface hover:text-ink"><Plus size={16} strokeWidth={1.9} /></button>
          {/snippet}
        </Menu>
        <div class="w-[170px]">
          <GroupedSelect {groups} value={modelValue} onValueChange={setModel} label="Model for {active?.name ?? 'this companion'}" size="sm" class="!min-w-0 !w-full !border-transparent !bg-transparent !px-2 !text-ink-2 hover:!bg-surface" placeholder={modelLabel} />
        </div>
        <div class="flex-1"></div>
        {#if text.trim()}
          <span class="hidden items-center gap-1 text-[12px] text-ink-2 sm:flex" aria-live="polite">
            {#if isUrl}<Globe size={13} strokeWidth={1.8} /> Open {hostOf(text.includes('://') ? text : 'https://' + text.trim())}{:else}Alt <CornerDownLeft size={12} /> searches the web{/if}
          </span>
        {/if}
        {#if text.trim()}
          <button type="submit" aria-label={isUrl ? 'Open' : `Send to ${active?.name ?? 'companion'}`} class="grid size-9 place-items-center rounded-full text-white shadow-[0_2px_8px_-2px_rgba(0,0,0,.3)] transition-transform active:scale-95" style:background={color}>
            {#if isUrl}<Globe size={17} strokeWidth={2} />{:else}<ArrowUp size={18} strokeWidth={2.2} />{/if}
          </button>
        {:else}
          <button type="button" onclick={voice} aria-label="Speak your request" aria-pressed={listening} class="grid size-9 place-items-center rounded-full text-white shadow-[0_2px_8px_-2px_rgba(0,0,0,.3)] transition-transform active:scale-95" class:animate-pulse-soft={listening} style:background={color}>
            <Mic size={17} strokeWidth={2} />
          </button>
        {/if}
      </div>
    </form>

    <!-- quick row -->
    <nav class="mt-4 flex flex-wrap items-center justify-center gap-2" aria-label="Shortcuts">
      {#each [{ l: 'Skills', i: Sparkles, u: 'owl://skills' }, { l: 'Agents', i: Bot, u: 'owl://agents' }, { l: 'Apps', i: Blocks, u: 'owl://apps' }, { l: 'Help', i: CircleHelp, u: 'https://github.com/varsen/owl#readme' }] as s (s.l)}
        <button type="button" onclick={() => (s.u.startsWith('owl://') ? openPage(s.u, tab.id) : owl.newTab(s.u))}
          class="flex h-8 items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] px-3.5 text-[13px] font-medium text-ink-2 shadow-[0_0_0_1px_var(--line)] hover:bg-surface hover:text-ink">
          <s.i size={14} strokeWidth={1.8} /> {s.l}
        </button>
      {/each}
    </nav>

    <!-- live runs -->
    {#if live.length}
      <section class="mt-8 w-full" aria-labelledby="nt-live">
        <div class="mb-2 flex items-baseline justify-between px-1">
          <h2 id="nt-live" class="text-[13px] font-medium text-ink-2">Working now</h2>
          <button type="button" class="owl-link text-[12.5px]" onclick={() => openPage('owl://agents', tab.id)}>All agents</button>
        </div>
        <div class="grid gap-2" style:grid-template-columns="repeat({live.length}, minmax(0, 1fr))">
          {#each live as r (r.id)}
            {@const st = statusMeta(r.status)}
            <button type="button" onclick={() => { store.panelRunId = r.id; store.panelOpen = true; }}
              class="glass flex min-w-0 flex-col gap-2 rounded-2xl p-3 text-left transition-transform active:scale-[.99]">
              <div class="flex items-center gap-2">
                <CompanionAvatar companion={r.companionId} size={22} status={r.status === 'running' ? 'running' : 'waiting'} />
                <Badge variant={st.variant}>{st.label}</Badge>
                <span class="tnum ml-auto text-[11.5px] text-ink-2">{fmtDuration(now - r.startedAt)}</span>
              </div>
              <div class="line-clamp-2 text-[13px] font-medium leading-snug">{r.task}</div>
              <div class="truncate text-[12px] text-ink-2">{lastStep(r)}</div>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <!-- quick access -->
    {#if !sitesLoaded}
      <div class="mt-8 flex gap-5" aria-hidden="true">{#each Array(6) as _, i (i)}<div class="flex w-[68px] flex-col items-center gap-2"><span class="owl-skel size-11 rounded-xl"></span><span class="owl-skel h-2.5 w-12 rounded"></span></div>{/each}</div>
    {:else if sites.length}
      <section class="mt-8 w-full" aria-label="Frequently visited">
        <ul class="flex flex-wrap justify-center gap-x-3 gap-y-2">
          {#each sites as s (s.host)}
            <li>
              <button type="button" onclick={() => owl.navigate(tab.id, s.url)} title={s.host}
                class="group flex w-[76px] flex-col items-center gap-1.5 rounded-xl px-1 py-2 hover:bg-[color-mix(in_srgb,var(--surface)_60%,transparent)]">
                <span class="owl-tile size-11 !rounded-[13px] transition-transform group-active:scale-95">
                  {#if s.favicon && !broken[s.host]}<img src={s.favicon} alt="" loading="lazy" onerror={() => (broken[s.host] = true)} />{:else}<span class="text-[15px] font-semibold text-ink-2">{s.host.charAt(0).toUpperCase()}</span>{/if}
                </span>
                <span class="w-full truncate text-center text-[11.5px] text-ink-2 group-hover:text-ink">{s.host.replace(/\.(com|org|net|io|ai|app|es|dev)$/, '')}</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- ideas -->
    <section class="glass glass-sheen mt-8 w-full rounded-[22px] p-4 pb-3" aria-labelledby="nt-ideas">
      <div class="mb-3 flex items-center gap-2 px-1">
        <div class="min-w-0 flex-1">
          <h2 id="nt-ideas" class="text-[14px] font-semibold tracking-[-0.01em]">Some ideas for you</h2>
          <p class="text-[12.5px] text-ink-2">Your first week in OWL</p>
        </div>
        <button type="button" aria-label="Previous ideas" onclick={() => scrollIdeas(-1)} class="grid size-7 place-items-center rounded-full text-ink-2 hover:bg-surface hover:text-ink"><ChevronLeft size={16} /></button>
        <button type="button" aria-label="Next ideas" onclick={() => scrollIdeas(1)} class="grid size-7 place-items-center rounded-full text-ink-2 hover:bg-surface hover:text-ink"><ChevronRight size={16} /></button>
      </div>
      <div bind:this={carousel} class="-mx-1 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-1 pb-2 [scrollbar-width:none]">
        {#each ideas as it (it.title)}
          <button type="button" onclick={it.act} class="flex w-[228px] shrink-0 snap-start flex-col gap-2 rounded-2xl bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] p-3.5 text-left shadow-[0_0_0_1px_var(--line)] transition-[background-color,transform] hover:bg-surface active:scale-[.99]">
            <span class="text-ink-2"><it.icon size={18} strokeWidth={1.7} /></span>
            <span class="text-[13.5px] font-medium">{it.title}</span>
            <span class="text-[12.5px] leading-snug text-ink-2">{it.body}</span>
          </button>
        {/each}
      </div>
    </section>
  </main>
</div>
