<script lang="ts">
  /**
   * Chrome-style permission prompt: a non-modal bubble anchored under the site-info icon of the address
   * bar. In Electron it is drawn by the popup layer, sized to the card only, so the page stays live around
   * it. Shown for the active tab's request; switching tabs parks it, coming back shows it again.
   * Block / Allow are remembered by main; the × (or a navigation) only answers this request.
   */
  import Icon from '../ui/Icon.svelte';
  import { owl } from '../api';
  import { store } from '../stores.svelte';
  import { hasPopupLayer, showPopup, iconMarkup, type PopupHandle } from '../ui/popup';
  import type { IconName } from '../ui/icons';

  type Prompt = { id: string; tabId: number; origin: string; permission: string; label: string; at: number };
  let prompts = $state<Prompt[]>([]);

  $effect(() => {
    (owl as any).permissionPrompts?.().then((l: Prompt[] | null) => { if (Array.isArray(l)) prompts = l; }, () => {});
    return owl.on((type, p: any) => {
      if (type === 'permission-prompt' && p?.id) prompts = [...prompts.filter((x) => x.id !== p.id), p];
      else if (type === 'permission-done' && p?.id) prompts = prompts.filter((x) => x.id !== p.id);
    });
  });

  const current = $derived(prompts.find((p) => p.tabId === store.win.activeTabId) ?? null);
  const ICONS: Record<string, IconName> = { notifications: 'alert', geolocation: 'location', media: 'video', 'clipboard-read': 'clipboard', 'display-capture': 'share-screen-start', midi: 'music-note-2', midiSysex: 'music-note-2', 'window-management': 'window' };
  const iconOf = (p: Prompt): IconName => (p.permission === 'media' && !/camera/i.test(p.label) ? 'mic' : ICONS[p.permission] ?? 'shield-question');
  const site = (o: string) => o.replace(/^https?:\/\//, '').replace(/^www\./, '');

  function answer(p: Prompt, choice: 'allow' | 'block' | 'dismiss') {
    prompts = prompts.filter((x) => x.id !== p.id);
    (owl as any).answerPermission?.(p.id, choice);
  }

  // ---- Electron: popup-layer bubble
  const W = 344, H = 132, INSET = 14;
  let handle: PopupHandle | null = null;
  let shownId: string | null = null;
  function anchor() {
    const el = document.querySelector('[data-omni-lead]') ?? document.querySelector('input[aria-label="Search or enter address"]');
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left, y: r.bottom, cx: r.left + r.width / 2 } : { x: 120, y: 80, cx: 140 };
  }
  function show(p: Prompt) {
    const a = anchor();
    const x = Math.max(4, Math.round(a.cx - 30 - INSET));
    const spec = {
      kind: 'bubble' as const, rect: { x, y: Math.round(a.y + 4) - 6, width: W + INSET * 2, height: H + INSET * 2 }, inset: INSET, arrowX: a.cx,
      site: site(p.origin), title: p.label, icon: iconMarkup(iconOf(p), 16), actions: ['Block', 'Allow'], label: `${site(p.origin)} wants to ${p.label.toLowerCase()}`,
    };
    handle?.close();
    shownId = p.id;
    handle = showPopup(spec, (e) => {
      if (e.type === 'select') answer(p, e.index === 1 ? 'allow' : 'block');
      else if (e.type === 'dismiss') answer(p, 'dismiss');
      if (e.type === 'select' || e.type === 'dismiss') { handle = null; shownId = null; }
    });
  }
  $effect(() => {
    if (!hasPopupLayer) return;
    const p = current;
    if (p && shownId !== p.id) show(p);
    else if (!p && handle) { handle.close(); handle = null; shownId = null; }
  });
  $effect(() => () => { handle?.close(); handle = null; });
</script>

{#if !hasPopupLayer && current}
  {@const p = current}
  <div class="pb glass-strong animate-in" role="dialog" aria-label="{site(p.origin)} wants to {p.label.toLowerCase()}">
    <div class="flex items-center gap-2">
      <span class="min-w-0 flex-1 truncate text-[13px] font-semibold">{site(p.origin)} wants to</span>
      <button class="x" aria-label="Close" onclick={() => answer(p, 'dismiss')}><Icon name="dismiss" size={14} /></button>
    </div>
    <div class="mt-2.5 flex items-center gap-2.5 text-[13px] text-ink-2"><Icon name={iconOf(p)} size={16} />{p.label}</div>
    <div class="mt-3 flex justify-end gap-2">
      <button class="btn" onclick={() => answer(p, 'block')}>Block</button>
      <button class="btn primary" onclick={() => answer(p, 'allow')}>Allow</button>
    </div>
  </div>
{/if}

<style>
  .pb { position: fixed; top: 84px; left: 120px; z-index: 76; width: 344px; padding: 14px 14px 12px 16px; border-radius: 16px; }
  .x { display: grid; place-items: center; width: 24px; height: 24px; border: 0; border-radius: 7px; background: transparent; color: var(--ink-2); }
  .x:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); }
  .btn { height: 30px; min-width: 76px; padding: 0 14px; border-radius: 9px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font: inherit; font-size: 12.5px; font-weight: 500; }
  .btn.primary { border-color: transparent; background: var(--ink); color: var(--surface); }
</style>
