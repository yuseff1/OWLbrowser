<script lang="ts">
  /** favicons that failed to load: the row shows its type icon instead of a blank slot */
  let favFailed = $state<Record<string, boolean>>({});
  /**
   * The popup layer renderer (`index.html?popup=1`), loaded by main into a transparent WebContentsView
   * stacked above page views. It draws what the UI describes (lib/ui/popup.ts) and reports back:
   * hover / select / dismiss. It has no owl:* API access, only popupReady/popupEmit.
   */
  import { onMount, tick } from 'svelte';
  import { owl, params } from '../api';
  import { isMock } from '../env';
  import type { PopupSpec, MenuSpec, SuggestSpec, PopupTheme } from '../ui/popup';
  import { demoSpec } from './demo';

  type Live = PopupSpec & { id: number; origin?: { x: number; y: number } };
  let spec = $state<Live | null>(null);
  let active = $state(-1);
  let menuEl = $state<HTMLDivElement | null>(null);
  let pos = $state<{ x: number; y: number } | null>(null);
  let typed = '';
  let typedAt = 0;

  const emit = (type: string, index?: number) => { if (spec) (owl as any).popupEmit?.({ id: spec.id, type, index }); };

  function applyTheme(t?: PopupTheme) {
    if (!t) return;
    const root = document.documentElement;
    root.classList.toggle('dark', !!t.dark);
    if (t.accent) root.style.setProperty('--accent', t.accent);
    if (t.accentInk) root.style.setProperty('--accent-ink', t.accentInk);
    root.classList.toggle('platform-darwin', t.platform === 'darwin');
  }

  onMount(() => {
    document.documentElement.classList.add('popup-mode');
    const off = owl.on((type, p) => {
      if (type !== 'popup') return;
      const prev = spec;
      spec = p;
      if (!p) { pos = null; active = -1; return; }
      applyTheme(p.theme);
      if (p.kind === 'menu' && (!prev || prev.id !== p.id)) {
        pos = null;
        active = p.keyboard ? next(-1, 1, p) : -1;
        tick().then(place);
      }
    });
    if (isMock) { const d = demoSpec(params.get('popupDemo')); if (d) { spec = d as Live; applyTheme(d.theme); active = d.kind === 'menu' && d.keyboard ? next(-1, 1, d as Live) : -1; tick().then(place); } }
    else (owl as any).popupReady?.();
    return off;
  });

  const menu = $derived(spec?.kind === 'menu' ? (spec as MenuSpec & Live) : null);
  const sugg = $derived(spec?.kind === 'suggest' ? (spec as SuggestSpec & Live) : null);

  function selectable(s: Live | null, i: number) {
    const it = s && s.kind === 'menu' ? s.items[i] : null;
    return !!it && !!it.label && !it.disabled && !it.separator;
  }
  function next(from: number, dir: 1 | -1, s: Live | null = spec) {
    if (!s || s.kind !== 'menu') return -1;
    const n = s.items.length;
    for (let k = 1; k <= n; k++) { const i = (from + dir * k + n * 2) % n; if (selectable(s, i)) return i; }
    return -1;
  }

  /** place the menu next to its anchor (window coords → this view's coords), flipping/clamping to fit */
  function place() {
    if (!menu || !menuEl) return;
    const o = menu.origin ?? { x: 0, y: 0 };
    const a = { x: menu.anchor.x - o.x, y: menu.anchor.y - o.y, w: menu.anchor.width, h: menu.anchor.height };
    const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
    const vw = innerWidth, vh = innerHeight, pad = 8, gap = 6;
    let x: number, y: number;
    if (menu.point) {
      x = a.x + w > vw - pad ? a.x - w : a.x;
      y = a.y + h > vh - pad ? a.y - h : a.y;
    } else {
      const side = menu.side ?? 'bottom', align = menu.align ?? 'end';
      const alignX = () => (align === 'start' ? a.x : align === 'center' ? a.x + a.w / 2 - w / 2 : a.x + a.w - w);
      const alignY = () => (align === 'start' ? a.y : align === 'center' ? a.y + a.h / 2 - h / 2 : a.y + a.h - h);
      if (side === 'bottom' || side === 'top') {
        x = alignX();
        const below = a.y + a.h + gap, above = a.y - gap - h;
        y = side === 'bottom' ? (below + h <= vh - pad || above < pad ? below : above) : (above >= pad || below + h > vh - pad ? above : below);
      } else {
        y = alignY();
        const right = a.x + a.w + gap, left = a.x - gap - w;
        x = side === 'right' ? (right + w <= vw - pad || left < pad ? right : left) : (left >= pad || right + w > vw - pad ? left : right);
      }
    }
    pos = { x: Math.round(Math.max(pad, Math.min(x, vw - w - pad))), y: Math.round(Math.max(pad, Math.min(y, vh - h - pad))) };
    menuEl.focus({ preventScroll: true });
  }

  function onMenuKey(e: KeyboardEvent) {
    if (!menu) return;
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); active = next(active, 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); active = next(active < 0 ? 0 : active, -1); }
    else if (k === 'Home') { e.preventDefault(); active = next(-1, 1); }
    else if (k === 'End') { e.preventDefault(); active = next(0, -1); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); if (active >= 0 && selectable(spec, active)) emit('select', active); }
    else if (k === 'Escape' || k === 'Tab' || k === 'ArrowLeft') { e.preventDefault(); emit('dismiss'); }
    else if (k.length === 1 && /\S/.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      typed = now - typedAt < 700 ? typed + k.toLowerCase() : k.toLowerCase();
      typedAt = now;
      const i = menu.items.findIndex((it, j) => selectable(spec, j) && it.label!.toLowerCase().startsWith(typed));
      if (i >= 0) active = i;
    }
  }
  $effect(() => { if (menu && active >= 0) menuEl?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); });

  // suggestions: pointer events only (keyboard focus stays in the omnibox)
  let lastHover = -1;
  function hover(i: number) { if (i !== lastHover) { lastHover = i; emit('hover', i); } }
  $effect(() => { if (!sugg) lastHover = -1; });
</script>

<!-- main resizes this view to the window after sending a menu spec (it may still have the omnibox
     dropdown's small bounds when place() first runs), so re-place once the viewport settles -->
<svelte:window onresize={() => { if (menu) place(); }} />

{#if menu}
  <!-- full-window catcher: a click anywhere outside the menu closes it (like a native menu) -->
  <div class="catch" role="presentation" onpointerdown={(e) => { if (e.target === e.currentTarget) emit('dismiss'); }} oncontextmenu={(e) => { e.preventDefault(); emit('dismiss'); }}>
    <div bind:this={menuEl} class="owl-menu pop-surface" class:shown={!!pos} role="menu" tabindex="-1" aria-orientation="vertical"
      style:min-width="{menu.width ?? 220}px" style:left="{pos?.x ?? -9999}px" style:top="{pos?.y ?? -9999}px"
      aria-activedescendant={active >= 0 ? `pi-${active}` : undefined} onkeydown={onMenuKey}>
      {#each menu.items as it, i (i)}
        {#if it.separator}
          <div class="owl-menu-sep" role="separator"></div>
        {:else if it.heading}
          <div class="owl-menu-label" role="presentation">{it.heading}</div>
        {:else if it.label}
          <div id="pi-{i}" data-i={i} role="menuitem" tabindex="-1" aria-disabled={it.disabled || undefined}
            class="owl-menu-item" class:danger={it.danger} data-highlighted={active === i ? '' : undefined} data-disabled={it.disabled ? '' : undefined}
            onpointermove={() => { if (!it.disabled) active = i; }} onpointerleave={() => { if (active === i) active = -1; }}
            onclick={() => { if (!it.disabled) emit('select', i); }} onkeydown={() => {}}>
            {#if it.icon}<span class="ico" aria-hidden="true">{@html it.icon}</span>{/if}
            <span class="truncate">{it.label}</span>
            {#if it.kbd}<span class="k">{it.kbd}</span>{/if}
          </div>
        {/if}
      {/each}
    </div>
  </div>
{:else if sugg}
  <div class="sugg pop-surface" role="listbox" aria-label={sugg.label ?? 'Suggestions'} style:inset="{sugg.insetTop ?? sugg.inset}px {sugg.inset}px auto {sugg.inset}px"
    onpointerleave={() => hover(-1)}>
    {#each sugg.items as s, i (i)}
      <div role="option" tabindex="-1" aria-selected={i === sugg.sel} class="row" class:sel={i === sugg.sel}
        onpointermove={() => hover(i)} onpointerdown={(e) => { if (e.button === 0) { e.preventDefault(); emit('select', i); } }}>
        {#if s.avatar}
          <img class="av" src={s.avatar} alt="" width="20" height="20" />
        {:else if s.favicon && !favFailed[s.favicon]}
          <img class="fav" src={s.favicon} alt="" width="16" height="16" onerror={() => (favFailed[s.favicon!] = true)} />
        {:else}
          <span class="ic" aria-hidden="true">{@html s.icon ?? ''}</span>
        {/if}
        <span class="t">{#if s.prefix}<span class="pre">{s.prefix}</span>{/if}{s.title}</span>
        {#if s.meta}<span class="meta">{s.meta}</span>{/if}
        {#if s.trail}<span class="ic trail" aria-hidden="true">{@html s.trail}</span>{/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  :global(html.popup-mode), :global(html.popup-mode body), :global(html.popup-mode #app) { background: transparent !important; }
  .catch { position: fixed; inset: 0; }
  /* no backdrop blur here: this view is composited over the page, so it reads as a solid sheet */
  .pop-surface {
    background-color: var(--surface);
    background-image: var(--glass-sheen), var(--glass-hue);
    border: 1px solid var(--glass-edge);
    box-shadow: var(--glass-rim), var(--glass-float-drop);
  }
  .owl-menu { position: fixed; max-height: calc(100vh - 16px); overflow-y: auto; opacity: 0; }
  .owl-menu.shown { opacity: 1; animation: pop-in .14s var(--ease-out) both; }
  .ico { display: grid; place-items: center; width: 15px; height: 15px; color: var(--ink-2); flex: none; }
  .danger .ico { color: #d43a3f; }
  .ico :global(svg) { display: block; }
  @keyframes pop-in { from { opacity: 0; transform: translateY(-3px) scale(.985); } to { opacity: 1; transform: none; } }

  .sugg { position: fixed; padding: 6px; border-radius: 18px; animation: pop-in .12s var(--ease-out) both; }
  .row { display: flex; align-items: center; gap: 11px; height: 36px; padding: 0 10px; border-radius: 11px; color: var(--ink-2); font-size: 13.5px; cursor: default; }
  .row.sel { background: color-mix(in srgb, var(--ink) 7%, transparent); }
  .t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ink); }
  .pre { color: var(--ink-2); }
  .meta { font-size: 12px; color: var(--ink-3); white-space: nowrap; max-width: 40%; overflow: hidden; text-overflow: ellipsis; }
  .ic { display: grid; place-items: center; width: 16px; color: var(--ink-3); flex: none; }
  .ic :global(svg) { display: block; }
  .fav { border-radius: 4px; flex: none; }
  .av { border-radius: 99px; flex: none; }
  @media (prefers-reduced-motion: reduce) { .owl-menu.shown, .sugg { animation: none; } }
</style>
