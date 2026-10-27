/**
 * Pure helpers for omnibox suggestions (no Electron imports, unit-tested in tests/main/unit.js).
 */
export type Suggestion = { type: string; title: string; url: string; favicon?: string; inline?: string };

/**
 * One key per page as a person sees it: scheme (http/https), "www.", default ports, a trailing slash,
 * the #fragment and letter case of the host don't make two different rows.
 * "https://www.Wikipedia.org/" and "http://wikipedia.org" → "wikipedia.org/".
 */
export function urlKey(u: string): string {
  try {
    const x = new URL(u);
    if (x.protocol !== 'http:' && x.protocol !== 'https:') return u;
    const host = x.hostname.toLowerCase().replace(/^www\./, '');
    const port = x.port && x.port !== '80' && x.port !== '443' ? ':' + x.port : '';
    let p = x.pathname.replace(/\/+$/, '') || '';
    if (p === '/index.html' || p === '/index.htm') p = '';
    return host + port + (p || '/') + x.search;
  } catch { return u; }
}

/** Keeps the first row for each page (callers order rows by priority: url, tab, bookmark, history). */
export function dedupeSuggestions<T extends Suggestion>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of list) {
    // tab rows carry the tab id in `url`; search rows are unique by query
    const key = s.type === 'tab' || s.type === 'search' ? s.type + ':' + s.url : urlKey(s.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Chrome-style inline autocomplete: when what the user typed is the start of a site they visited
 * ("wik" → "wikipedia.org"), returns the completed text. Only hosts (and host + first path segment when
 * the user already typed a "/"), never a search, never anything with spaces.
 */
export function inlineCompletion(typed: string, visited: Array<{ url: string; visits?: number }>): string | null {
  const q = typed.trim().toLowerCase();
  if (!q || /\s/.test(q) || q.length < 2 || /^[a-z][a-z0-9+.-]*:/.test(q)) return null;
  const qq = q.replace(/^www\./, '');
  let best: { text: string; score: number } | null = null;
  for (const e of visited) {
    let x: URL;
    try { x = new URL(e.url); } catch { continue; }
    if (x.protocol !== 'http:' && x.protocol !== 'https:') continue;
    const host = x.host.toLowerCase().replace(/^www\./, ''); // keeps a non-default port (localhost:3000)
    let cand = '';
    if (qq.includes('/')) {
      const seg = x.pathname.split('/').filter(Boolean)[0];
      const hp = seg ? `${host}/${seg}` : host;
      if (hp.startsWith(qq) && hp.length > qq.length) cand = hp;
    } else if (host.startsWith(qq) && host.length > qq.length) cand = host;
    if (!cand) continue;
    const score = (e.visits ?? 1) * 10 - cand.length; // most visited, then shortest
    if (!best || score > best.score) best = { text: cand, score };
  }
  return best ? best.text : null;
}
