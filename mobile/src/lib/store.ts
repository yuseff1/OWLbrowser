import { useSyncExternalStore, useRef, useCallback } from 'react';

/**
 * Tiny external store (zustand-like) so components subscribe to exactly the slice they render.
 * Avoids context re-render storms when a WebView streams progress events.
 */
export type Store<T> = {
  get: () => T;
  set: (patch: Partial<T> | ((s: T) => Partial<T>)) => void;
  subscribe: (fn: () => void) => () => void;
};

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (patch) => {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is((a as any)[k], (b as any)[k])) return false;
  return true;
}

/** Subscribe to a derived slice; re-renders only when the slice changes (shallow compare). */
export function useStore<T extends object, S>(store: Store<T>, selector: (s: T) => S): S {
  const last = useRef<{ s: S } | null>(null);
  const sel = useRef(selector);
  sel.current = selector;
  const getSnapshot = useCallback(() => {
    const next = sel.current(store.get());
    if (last.current && shallowEqual(last.current.s, next)) return last.current.s;
    last.current = { s: next };
    return next;
  }, [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
