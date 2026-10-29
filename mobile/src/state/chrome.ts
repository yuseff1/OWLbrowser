import { Animated } from 'react-native';
import { createStore } from '@/lib/store';

/**
 * Browser chrome state shared between the dock, the page and the tab overview (Safari-style behaviours, see
 * docs/research-safari.md):
 *  - compact: the dock is minimized to a domain pill because the page scrolled down (Safari's scroll-to-minimize).
 *  - peek: while the address capsule is being swiped, which neighbour is sliding in (a tab id, or 'new' for the
 *    blank tab that a swipe past the last tab creates) and from which side.
 * The Animated values are module singletons so the dock (which owns the gesture) and the page (which moves) share one
 * native-driven value without re-rendering.
 */
export type Peek = { id: string; dir: 1 | -1 } | null;
export const chromeStore = createStore<{ compact: boolean; peek: Peek }>({ compact: false, peek: null });

export const chrome = {
  setCompact(v: boolean) {
    if (chromeStore.get().compact !== v) chromeStore.set({ compact: v });
  },
  expand() {
    if (!chromeStore.get().compact) return;
    this.setCompact(false);
    resetHook.current?.();
  },
  setPeek(p: Peek) {
    const cur = chromeStore.get().peek;
    if (cur?.id === p?.id && cur?.dir === p?.dir) return;
    chromeStore.set({ peek: p });
  },
};

/** Horizontal offset of the page while the address capsule is swiped (px, follows the finger 1:1). */
export const pageSwipeX = new Animated.Value(0);
/** Gap between the current page and the neighbour sliding in (Safari shows the two pages side by side). */
export const PAGE_GAP = 16;

/**
 * Tab overview zoom: the live page container scales from full screen into the current tab's card (and back).
 * scale + translate with a top-left origin; `pageFade` lets the page hand over to the card at the end.
 */
export const overviewAnim = {
  scale: new Animated.Value(1),
  tx: new Animated.Value(0),
  ty: new Animated.Value(0),
  pageFade: new Animated.Value(1),
  /** 0 = browsing, 1 = overview (drives the dock fade) */
  progress: new Animated.Value(0),
};
/** Where the page container sits on screen (window coords), measured by the browser screen. */
export const pageFrame = { x: 0, y: 0, w: 0, h: 0 };
/** Set by the browser screen: measures the page container before a zoom starts. */
export const pageMeasure: { current: null | (() => Promise<void>) } = { current: null };
/** Set by the dock right before a committed swipe switches tabs; the page screen zeroes pageSwipeX once it renders. */
export const pendingSwipeReset = { current: false };
/** Installed by the browser state: tells the active page's scroll watcher the dock is full again. */
export const resetHook: { current: null | (() => void) } = { current: null };
