/**
 * UI side of the popup layer.
 *
 * Web pages are native WebContentsViews drawn on top of the UI, so anything the shell draws over the
 * page rect is hidden. In Electron, main keeps a transparent WebContentsView above every page view
 * (window.ts "popup layer"); menus and the omnibox dropdown are described here as plain data, drawn by
 * that view (lib/popup/PopupApp.svelte) and answered back as 'popup-event' { id, type, index }.
 *
 * In the browser preview (mock) there is no popup layer: callers fall back to their in-DOM rendering.
 */
import { mount, unmount, type Component } from 'svelte';
import { owl } from '../api';
import { isMock } from '../env';
import { kbdLabel } from './cn';
import type { MenuItem } from './Menu.svelte';

export const hasPopupLayer: boolean = !isMock && typeof (owl as any).popupShow === 'function';

export type Rect = { x: number; y: number; width: number; height: number };
export type PopupEvent = { id: number; type: 'select' | 'dismiss' | 'hover'; index?: number };
export type PopupMenuItem = { label?: string; icon?: string; kbd?: string; danger?: boolean; disabled?: boolean; separator?: boolean; heading?: string };
export type PopupSuggestItem = { title: string; prefix?: string; meta?: string; favicon?: string; icon?: string; avatar?: string; trail?: string };
export type PopupTheme = { dark: boolean; accent: string; accentInk: string; platform: string };

export type MenuSpec = {
  kind: 'menu';
  /** element rect (window CSS px) the menu attaches to, or a point for context menus */
  anchor: Rect;
  point?: boolean;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  width?: number;
  items: PopupMenuItem[];
  /** opened from the keyboard: highlight the first item */
  keyboard?: boolean;
  focus: true;
};
export type SuggestSpec = {
  kind: 'suggest';
  /** popup bounds in the window (includes `inset` px of room for the shadow on every side) */
  rect: Rect;
  inset: number;
  /** room above the box (kept small so the layer never covers the omnibox) */
  insetTop?: number;
  items: PopupSuggestItem[];
  sel: number;
  label?: string;
};
export type PopupSpec = (MenuSpec | SuggestSpec) & { id?: number; theme?: PopupTheme };

let seq = Math.floor(Math.random() * 1000);
const handlers = new Map<number, (e: PopupEvent) => void>();
let bound = false;
function bind() {
  if (bound) return;
  bound = true;
  owl.on((type, p) => { if (type === 'popup-event' && p && typeof p.id === 'number') handlers.get(p.id)?.(p as PopupEvent); });
}

export function theme(): PopupTheme {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  return { dark: root.classList.contains('dark'), accent: cs.getPropertyValue('--accent').trim(), accentInk: cs.getPropertyValue('--accent-ink').trim(), platform: owl.platform };
}

export type PopupHandle = { id: number; update(spec: PopupSpec): void; close(): void; readonly open: boolean };

/** Show a popup in the layer; `onEvent` gets hover/select/dismiss. 'select' and 'dismiss' end it. */
export function showPopup(spec: PopupSpec, onEvent: (e: PopupEvent) => void): PopupHandle {
  bind();
  const id = ++seq;
  let open = true;
  handlers.set(id, (e) => {
    if (e.type === 'select' || e.type === 'dismiss') { open = false; handlers.delete(id); }
    onEvent(e);
  });
  const send = (s: PopupSpec) => (owl as any).popupShow(JSON.parse(JSON.stringify({ ...s, id, theme: theme() })));
  send(spec);
  return {
    id,
    get open() { return open; },
    update(s) { if (open) send(s); },
    close() { if (!open) return; open = false; handlers.delete(id); (owl as any).popupHide(id); },
  };
}

// ---- icons: lucide components → static SVG markup (rendered once per component)
const iconCache = new Map<Component<any>, string>();
export function iconMarkup(icon: Component<any> | undefined, size = 15, strokeWidth = 1.75): string | undefined {
  if (!icon) return undefined;
  const hit = iconCache.get(icon);
  if (hit !== undefined) return hit;
  const host = document.createElement('div');
  let html = '';
  try {
    const inst = mount(icon, { target: host, props: { size, strokeWidth } });
    html = host.innerHTML.replace(/<!--[^]*?-->/g, '');
    unmount(inst);
  } catch { html = ''; }
  iconCache.set(icon, html);
  return html;
}

export function toPopupItems(items: MenuItem[]): PopupMenuItem[] {
  return items.map((it) => it.separator ? { separator: true } : it.heading ? { heading: it.heading } : {
    label: it.label, icon: iconMarkup(it.icon), kbd: it.kbd ? kbdLabel(it.kbd) : undefined, danger: it.danger, disabled: it.disabled,
  });
}

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/** Open a menu in the popup layer; resolves with the selected item's index, or null when dismissed. */
export function openMenu(opts: Omit<MenuSpec, 'kind' | 'focus' | 'items'> & { items: MenuItem[] }, onClose?: () => void): PopupHandle {
  const items = opts.items;
  return showPopup({ ...opts, kind: 'menu', focus: true, items: toPopupItems(items) }, (e) => {
    if (e.type === 'select' && typeof e.index === 'number') { const it = items[e.index]; if (it && !it.disabled && !it.separator) queueMicrotask(() => it.onSelect?.()); }
    if (e.type === 'select' || e.type === 'dismiss') onClose?.();
  });
}
