import type { Settings } from './types';

const ENGINES: Record<Settings['searchEngine'], string> = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q=',
  brave: 'https://search.brave.com/search?q=',
  startpage: 'https://www.startpage.com/do/search?q=',
};

export const ENGINE_NAMES: Record<Settings['searchEngine'], string> = {
  google: 'Google', duckduckgo: 'DuckDuckGo', bing: 'Bing', brave: 'Brave Search', startpage: 'Startpage',
};

/** Turn omnibox input into a URL: keeps schemes, adds https:// to hostnames, otherwise searches. */
export function toUrl(input: string, engine: Settings['searchEngine'] = 'google'): string {
  const s = input.trim();
  if (!s) return '';
  if (/^(https?|file|about|data):/i.test(s)) return s;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s)) return 'http://' + s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) && !s.includes(' ')) return 'https://' + s;
  return ENGINES[engine] + encodeURIComponent(s);
}

export function hostOf(url: string): string {
  const m = url.match(/^[a-z]+:\/\/([^/?#:]+)/i);
  return m ? m[1].replace(/^www\./, '') : '';
}

/** What the address bar shows when not editing: host for pages, the query for searches. */
export function displayUrl(url: string): string {
  if (!url) return '';
  try {
    const q = url.match(/[?&](q|query)=([^&]+)/);
    if (q && /google\.|duckduckgo\.|bing\.|brave\.|startpage\./.test(url)) return decodeURIComponent(q[2].replace(/\+/g, ' '));
  } catch {}
  return hostOf(url) || url;
}

export function faviconFor(url: string): string | null {
  const h = hostOf(url);
  return h ? `https://www.google.com/s2/favicons?domain=${h}&sz=64` : null;
}

export const isSecure = (url: string) => url.startsWith('https://');
