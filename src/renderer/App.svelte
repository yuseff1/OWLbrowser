<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Tooltip } from 'bits-ui';
  import { owl } from './lib/api';
  import { store } from './lib/stores.svelte';
  import { isMock } from './lib/env';
  import { threads } from './lib/threads.svelte';
  import { prefs } from './lib/shell/prefs.svelte';
  import { profile } from './lib/shell/profile.svelte';
  import TabStrip from './lib/shell/TabStrip.svelte';
  import Toolbar from './lib/shell/Toolbar.svelte';
  import BookmarksBar from './lib/shell/BookmarksBar.svelte';
  import Sidebar from './lib/shell/Sidebar.svelte';
  import CompanionPanel from './lib/shell/CompanionPanel.svelte';
  import FindBar from './lib/shell/FindBar.svelte';
  import CommandPalette from './lib/shell/CommandPalette.svelte';
  import Toasts from './lib/shell/Toasts.svelte';
  import PasswordPrompt from './lib/shell/PasswordPrompt.svelte';
  import PermissionBubble from './lib/shell/PermissionBubble.svelte';
  import TaskManager from './lib/shell/TaskManager.svelte';
  import Onboarding from './lib/shell/Onboarding.svelte';
  import WebPlaceholder from './lib/shell/WebPlaceholder.svelte';
  import PageHost from './lib/pages/PageHost.svelte';
  import type { TabState } from '$shared/types';

  let ready = $state(false);
  let onboarding = $state(false);
  let systemDark = $state(matchMedia('(prefers-color-scheme: dark)').matches);

  // ---- theme + accent
  const dark = $derived(onboarding ? false : store.win.incognito || store.settings?.theme === 'dark' || (store.settings?.theme !== 'light' && systemDark));
  $effect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.style.setProperty('--accent', prefs.accent(dark));
    root.style.setProperty('--accent-ink', prefs.accentInk());
  });
  onMount(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const h = (e: MediaQueryListEvent) => (systemDark = e.matches);
    mq.addEventListener('change', h);
    document.documentElement.classList.add('platform-' + owl.platform);
    if (store.win.incognito) document.documentElement.classList.add('incognito');
    return () => mq.removeEventListener('change', h);
  });

  onMount(async () => {
    await store.init();
    profile.load();
    const ob = (await owl.onboarding()) as { done: boolean } | null;
    onboarding = !!ob && !ob.done;
    ready = true;
    if (isMock) {
      const q = new URLSearchParams(location.search);
      if (q.get('panel') === '1') store.panelOpen = true;
      if (q.get('palette') === '1') setTimeout(() => (store.paletteOpen = true), 300);
      if (q.get('sidebar') === '0') store.sidebarOpen = false;
      if (q.get('find') === '1') store.findOpen = true;
      if (q.get('thread') === '1') demoThread();
      // scripted interactions for design review: ?do=click:.sel;type:.sel:text;key:Escape
      const steps = (q.get('do') || '').split(';').filter(Boolean);
      (async () => {
        await new Promise((r) => setTimeout(r, 600));
        for (const st of steps) {
          const [kind, sel, ...rest] = st.split(':');
          const el = sel ? (document.querySelector(sel) as HTMLElement | null) : null;
          if (kind === 'click' && el) { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); el.click(); }
          else if (kind === 'focus' && el) el.focus();
          else if (kind === 'type' && el) { (el as HTMLInputElement).focus(); (el as HTMLInputElement).value = rest.join(':'); el.dispatchEvent(new Event('input', { bubbles: true })); }
          await new Promise((r) => setTimeout(r, 450));
        }
      })();
      if (q.get('thread') === '2') { const t = threads.start('nova'); t.title = 'Founders in Valencia'; t.messages.push({ id: 'n1', role: 'user', content: 'Find 20 seed-stage founders in Valencia building AI products and draft a short intro note for each', t: Date.now() - 420000, companionId: 'nova' }, { id: 'n2', role: 'assistant', content: '', t: Date.now() - 410000, companionId: 'nova', runId: 'r2' }); store.setCompanion('nova'); store.panelOpen = true; }
    }
  });
  function demoThread() {
    const t = threads.start('hoot');
    t.title = 'Cheapest flight to Lisbon';
    t.messages.push(
      { id: 'u1', role: 'user', content: 'What is this page about?', t: Date.now() - 200000, companionId: 'hoot', withPage: true },
      { id: 'a1', role: 'assistant', content: 'It’s **Skyscanner** results for Valencia → Lisbon, 14–17 Nov. Direct flights run **€58–€112** return:\n\n| Airline | Out | Price |\n|---|---|--:|\n| Ryanair | 06:40 | €58 |\n| Vueling | 13:15 | €74 |\n| TAP | 19:05 | €112 |\n\nTAP is the only fare with a carry-on included.', t: Date.now() - 190000, companionId: 'hoot' },
      { id: 'u2', role: 'user', content: 'Find the cheapest direct flight with a carry-on included', t: Date.now() - 100000, companionId: 'hoot' },
      { id: 'a2', role: 'assistant', content: '', t: Date.now() - 95000, companionId: 'hoot', runId: 'r1' },
    );
    store.panelOpen = true;
  }
  function doneOnboarding(r: { companionId: string }) {
    store.setCompanion(r.companionId);
    store.refreshCompanions();
    profile.load();
    onboarding = false;
  }

  // ---- layout
  const modern = $derived(store.layout === 'modern');
  const active = $derived(store.activeTab);
  const splitTab = $derived(store.win.splitTabId ? store.win.tabs.find((t) => t.id === store.win.splitTabId && t.id !== store.win.activeTabId) ?? null : null);
  const chrome = $derived(!store.fullscreen);

  // ---- page rect → main (native views draw on top of it)
  let mainEl = $state<HTMLDivElement | null>(null);
  let splitEl = $state<HTMLDivElement | null>(null);
  let toolbarEl = $state<HTMLDivElement | null>(null);
  let last = '';
  let raf = 0;
  const rectOf = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; };
  function sendBounds() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      let b: any, s: any = null;
      if (onboarding || !ready) b = { x: 0, y: 0, width: 0, height: 0 };
      else if (store.fullscreen) b = { x: 0, y: 0, width: innerWidth, height: innerHeight };
      else if (mainEl) { b = rectOf(mainEl); if (splitEl) s = rectOf(splitEl); }
      if (!b) return;
      store.pageRects = [b, s].filter((r) => r && r.width > 0 && r.height > 0);
      const key = JSON.stringify([b, s]);
      if (key === last) return;
      last = key;
      owl.setBounds(b, s);
    });
  }
  $effect(() => {
    const els = [mainEl, splitEl].filter(Boolean) as HTMLElement[];
    const ro = new ResizeObserver(sendBounds);
    els.forEach((e) => ro.observe(e));
    if (toolbarEl) ro.observe(toolbarEl);
    sendBounds();
    return () => ro.disconnect();
  });
  $effect(() => {
    // position-only changes (sidebar/panel/bars toggling) also move the rect
    store.sidebarOpen; store.panelOpen; store.layout; store.findOpen; store.fullscreen; store.settings?.showBookmarksBar; splitTab; onboarding; ready;
    tick().then(sendBounds);
  });
  onMount(() => { addEventListener('resize', sendBounds); return () => removeEventListener('resize', sendBounds); });

  // where the chrome band sits (for toasts / prompts that must not overlap the page)
  let topBand = $state(44);
  let pageTop = $state(88);
  $effect(() => {
    store.layout; store.settings?.showBookmarksBar; store.sidebarOpen; ready;
    tick().then(() => {
      if (toolbarEl) { const r = toolbarEl.getBoundingClientRect(); topBand = Math.round(r.top + (r.height - 34) / 2); }
      if (mainEl) pageTop = Math.round(mainEl.getBoundingClientRect().top) + 8;
    });
  });

  // ---- keyboard: in Electron, main turns shortcuts into 'command' events; the preview handles them here
  function onKey(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (store.findOpen) { store.findOpen = false; if (active) owl.stopFind(active.id); }
      return;
    }
    if (!isMock || !ctrl) return;
    const k = e.key.toLowerCase();
    const map: Record<string, () => void> = {
      k: () => store.onCommand('palette'), j: () => store.onCommand(e.shiftKey ? 'toggle-companion' : 'downloads'), l: () => store.onCommand('focus-omnibox'),
      '\\': () => store.onCommand('toggle-sidebar'), f: () => store.onCommand('find'), t: () => owl.newTab(),
      w: () => active && owl.closeTab(active.id),
    };
    if (map[k]) { e.preventDefault(); map[k](); }
  }

  const pageVisible = (t: TabState | null) => !!t;
</script>

<svelte:window onkeydown={onKey} />

<Tooltip.Provider delayDuration={500}>
  {#if !ready}
    <div class="h-full"></div>
  {:else if onboarding}
    <Onboarding onDone={doneOnboarding} />
  {:else}
    <div class="app" class:fs={!chrome} class:incog={store.win.incognito}>
      {#if chrome && store.sidebarOpen}
        <div class="sidebar-col"><Sidebar {modern} /></div>
      {/if}

      <div class="main-col">
        {#if chrome}
          {#if !modern}<TabStrip />{/if}
          <div bind:this={toolbarEl}><Toolbar {modern} /></div>
          {#if store.settings?.showBookmarksBar}<BookmarksBar />{/if}
        {/if}

        <div class="body">
          <div class="page-area" class:split={!!splitTab}>
            {#if chrome && store.findOpen && active && !active.internal}
              <div class="findrow"><FindBar /></div>
            {/if}
            <div class="panes">
              <div class="pane" bind:this={mainEl} class:internal={!!active?.internal} aria-label="Page">
                {#if active?.internal}
                  <PageHost tab={active} />
                {:else if pageVisible(active)}
                  <WebPlaceholder tab={active!} />
                {/if}
                {#if store.overlayShot && !active?.internal}
                  <img class="shot" src={store.overlayShot} alt="" aria-hidden="true" />
                {/if}
              </div>
              {#if splitTab}
                <div class="pane" bind:this={splitEl} class:internal={!!splitTab.internal} aria-label="Split page">
                  {#if splitTab.internal}<PageHost tab={splitTab} />{:else}<WebPlaceholder tab={splitTab} />{/if}
                </div>
              {/if}
            </div>
          </div>

          {#if chrome && (store.panelOpen || store.panelRunId)}
            <CompanionPanel />
          {/if}
        </div>
      </div>
    </div>

    <CommandPalette />
    <Toasts top={topBand} right={modern ? 148 : 8} />
    <PasswordPrompt top={pageTop} />
    <PermissionBubble />
    {#if store.taskManagerOpen}<TaskManager />{/if}
  {/if}
</Tooltip.Provider>

<style>
  .app { display: flex; height: 100%; background: var(--ground); }
  .sidebar-col { width: 244px; flex: none; height: 100%; }
  .main-col { flex: 1; min-width: 0; display: flex; flex-direction: column; height: 100%; }
  .body { flex: 1; min-height: 0; display: flex; }
  .page-area { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 0 6px 6px; }
  .app:has(.sidebar-col) .page-area { padding-left: 0; }
  .findrow { display: flex; justify-content: flex-end; padding: 0 0 6px; flex: none; }
  .panes { flex: 1; min-height: 0; display: flex; gap: 8px; }
  .pane {
    position: relative; flex: 1; min-width: 0; border-radius: 10px; overflow: hidden; background: var(--surface);
    box-shadow: 0 0 0 1px var(--line), 0 1px 3px rgba(0,0,0,.04);
  }
  :global(.dark) .pane { box-shadow: 0 0 0 1px var(--line), 0 1px 3px rgba(0,0,0,.3); }
  .shot { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: blur(3px) saturate(1.1); transform: scale(1.01); pointer-events: none; }
  .app.fs .page-area { padding: 0; }
  .app.fs .pane { border-radius: 0; box-shadow: none; }
</style>
