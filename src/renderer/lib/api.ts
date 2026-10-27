import type { OwlApi } from '../../preload/ui';

declare global {
  interface Window { owl: OwlApi }
}

/** Typed handle to the main process. In a plain browser (vite dev without Electron) a no-op stub keeps the UI renderable. */
export const owl: OwlApi = (typeof window !== 'undefined' && (window as any).owl) || (new Proxy({}, {
  get: (_t, k) => (k === 'on' ? () => () => {} : k === 'platform' ? 'win32' : async () => null),
}) as any);

export const params = new URLSearchParams(location.search);
export const PROFILE_ID = params.get('profile') || 'default';
export const INCOGNITO = params.get('incognito') === '1';
/** this document is the popup layer (lib/popup/PopupApp.svelte), not the browser UI */
export const IS_POPUP = params.get('popup') === '1';

export const art = {
  mark: './art/owl-mark.png',
  hero: './art/onboarding-hoot.png',
  companion: (id: string) => `./art/companions/${['hoot', 'nova', 'pip', 'echo', 'atlas', 'byte'].includes(id) ? id : 'custom'}.webp`,
  face: (id: string) => `./art/companions/${['hoot', 'nova', 'pip', 'echo', 'atlas', 'byte'].includes(id) ? id : 'custom'}-face.webp`,
};

export function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function faviconFor(url: string, given?: string) {
  if (given) return given;
  const h = hostOf(url);
  return h && /\./.test(h) ? `https://www.google.com/s2/favicons?domain=${h}&sz=64` : '';
}

export function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}
