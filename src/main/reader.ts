/**
 * Reader mode (F9 / the book icon in the address bar). A small Readability-style extractor runs in an
 * isolated world of the tab (the page's own scripts can't see or patch it), scores the blocks of text,
 * keeps the article (headings, paragraphs, figures, lists, quotes, code, tables) with every attribute
 * stripped except a short allow-list, and swaps the document for a clean reading page. Everything stays
 * inside the unprivileged web renderer: no page HTML ever reaches the OWL UI. Exit = reload the page.
 */
import type { WebContents } from 'electron';

const WORLD = 4471; // isolated world id for reader mode (any number other than 0 / 999)

export type ReaderResult = { ok: true; title: string; words: number } | { ok: false; reason: string };

/** runs in the page (isolated world); returns ReaderResult */
const EXTRACT = String.raw`(() => {
  const NEG = /(^|[\s_-])(comment|comments|footer|foot|nav|navbar|menu|sidebar|side|aside|share|sharing|social|related|recommend|promo|advert|ads?|banner|sponsor|subscribe|newsletter|cookie|consent|popup|modal|breadcrumb|pagination|pager|widget|masthead|header|toolbar|tags?|author-bio|outbrain|taboola)([\s_-]|$)/i;
  const POS = /(article|body|content|entry|main|post|story|text|prose|blog)/i;
  const doc = document;
  const tx = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const cls = (el) => ((el.className && typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || ''));
  const linkDensity = (el) => { const t = tx(el).length || 1; let l = 0; el.querySelectorAll('a').forEach((a) => (l += tx(a).length)); return l / t; };

  // 1. candidate: an obvious article container, else the best-scored parent of the paragraphs
  let best = null;
  const explicit = [...doc.querySelectorAll('article, [itemprop="articleBody"], main, [role="main"]')].filter((e) => tx(e).length > 600).sort((a, b) => tx(b).length - tx(a).length);
  const scores = new Map();
  for (const p of doc.querySelectorAll('p, pre, blockquote, td')) {
    const t = tx(p);
    if (t.length < 25) continue;
    const add = (el, f) => { if (!el || el === doc.body || el === doc.documentElement) return; let s = scores.get(el); if (s == null) { s = 0; const c = cls(el); if (NEG.test(c) && !POS.test(c)) s -= 25; if (POS.test(c)) s += 25; if (/^(ARTICLE|MAIN|SECTION)$/.test(el.tagName)) s += 5; } scores.set(el, s + f); };
    const pts = 1 + (t.match(/[,，、]/g) || []).length + Math.min(Math.floor(t.length / 100), 3);
    add(p.parentElement, pts);
    add(p.parentElement && p.parentElement.parentElement, pts / 2);
  }
  for (const [el, s] of scores) { const v = s * (1 - linkDensity(el)); if (!best || v > best.v) best = { el, v }; }
  let root = best ? best.el : null;
  if (explicit[0] && (!root || explicit[0].contains(root) && tx(explicit[0]).length < tx(root).length * 2.5)) root = explicit[0];
  if (!root) return { ok: false, reason: 'No article found on this page' };
  const words = tx(root).split(' ').length;
  if (words < 120) return { ok: false, reason: 'This page doesn’t look like an article' };

  // 2. metadata
  const meta = (sel) => { const m = doc.querySelector(sel); return m ? (m.getAttribute('content') || '').trim() : ''; };
  const h1 = root.querySelector('h1') || doc.querySelector('h1');
  const title = meta('meta[property="og:title"]') || (h1 && tx(h1)) || doc.title || location.hostname;
  const site = meta('meta[property="og:site_name"]') || location.hostname.replace(/^www\./, '');
  const byline = meta('meta[name="author"]') || meta('meta[property="article:author"]').replace(/^https?:\/\/\S+$/, '');
  const published = meta('meta[property="article:published_time"]') || (doc.querySelector('time[datetime]') || {}).getAttribute?.('datetime') || '';

  // 3. clean copy
  const KEEP = new Set(['P','H1','H2','H3','H4','H5','H6','IMG','FIGURE','FIGCAPTION','PICTURE','UL','OL','LI','BLOCKQUOTE','PRE','CODE','TABLE','THEAD','TBODY','TR','TD','TH','A','EM','STRONG','B','I','U','S','SUB','SUP','BR','HR','DL','DT','DD','SPAN','DIV','SECTION','ARTICLE','MARK','SMALL','ABBR','TIME','CAPTION']);
  const DROP = 'script,style,noscript,iframe,frame,object,embed,form,input,button,select,textarea,nav,aside,footer,svg,canvas,video,audio,dialog,template,link,meta';
  const clone = root.cloneNode(true);
  clone.querySelectorAll(DROP).forEach((e) => e.remove());
  clone.querySelectorAll('*').forEach((e) => {
    if (!e.isConnected) return;
    const c = cls(e);
    const t = tx(e);
    if (e.tagName !== 'IMG' && e.tagName !== 'FIGURE' && e.tagName !== 'PICTURE' && (NEG.test(c) && !POS.test(c) && t.length < 600 || (t.length < 200 && linkDensity(e) > 0.6 && !/^(A|LI|P)$/.test(e.tagName) && !e.querySelector('img')))) { e.remove(); return; }
    if (e.getAttribute('aria-hidden') === 'true' || e.hidden) { e.remove(); }
  });
  if (h1 && clone.contains && clone.querySelector('h1') && tx(clone.querySelector('h1')) === title) clone.querySelector('h1').remove();
  const abs = (u) => { try { const x = new URL(u, location.href); return /^(https?|data):$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
  const out = doc.createElement('div');
  const copy = (src, dst) => {
    for (const n of [...src.childNodes]) {
      if (n.nodeType === 3) { dst.appendChild(doc.createTextNode(n.textContent)); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (!KEEP.has(tag)) { copy(n, dst); continue; }
      if (tag === 'IMG') {
        const src0 = n.getAttribute('src') || '';
        const lazy = n.getAttribute('data-src') || n.getAttribute('data-lazy-src') || n.getAttribute('data-original') || (n.getAttribute('srcset') || n.getAttribute('data-srcset') || '').split(',').pop().trim().split(' ')[0];
        const u = abs(!src0 || src0.startsWith('data:') ? lazy || src0 : src0);
        if (!u || (n.width && n.width < 40 && n.height && n.height < 40)) continue;
        const img = doc.createElement('img'); img.src = u; img.alt = (n.getAttribute('alt') || '').slice(0, 300); img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
        dst.appendChild(img); continue;
      }
      if (tag === 'PICTURE') { const i = n.querySelector('img'); if (i) copy({ childNodes: [i] }, dst); continue; }
      const el = doc.createElement(tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' ? 'div' : tag === 'SPAN' ? 'span' : tag.toLowerCase());
      if (tag === 'A') { const h = abs(n.getAttribute('href') || ''); if (h) { el.setAttribute('href', h); el.setAttribute('rel', 'noopener noreferrer'); } }
      if ((tag === 'TD' || tag === 'TH')) { for (const a of ['colspan', 'rowspan']) { const v = n.getAttribute(a); if (v && /^\d{1,2}$/.test(v)) el.setAttribute(a, v); } }
      copy(n, el);
      if ((el.tagName === 'DIV' || el.tagName === 'SPAN' || el.tagName === 'P') && !el.textContent.trim() && !el.querySelector('img')) continue;
      dst.appendChild(el);
    }
  };
  copy(clone, out);

  // 4. the reading page
  const fmtDate = (s) => { const d = new Date(s); return isNaN(+d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); };
  const mins = Math.max(1, Math.round(words / 230));
  const html = doc.documentElement;
  for (const a of [...html.attributes]) html.removeAttribute(a.name);
  html.setAttribute('lang', html.lang || 'en');
  html.setAttribute('data-owl-reader', 'light');
  const head = doc.createElement('head');
  const mt = doc.createElement('meta'); mt.setAttribute('charset', 'utf-8'); head.appendChild(mt);
  const ti = doc.createElement('title'); ti.textContent = title; head.appendChild(ti);
  const body = doc.createElement('body');
  const bar = doc.createElement('div'); bar.className = 'owl-r-bar';
  const mk = (label, title, fn, cls = '') => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; b.setAttribute('aria-label', title); if (cls) b.className = cls; b.addEventListener('click', fn); bar.appendChild(b); return b; };
  const state = { size: 20, theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', serif: true };
  try { Object.assign(state, JSON.parse(sessionStorage.getItem('owl-reader') || '{}')); } catch {}
  const apply = () => { html.setAttribute('data-owl-reader', state.theme); html.style.setProperty('--r-size', state.size + 'px'); html.classList.toggle('owl-r-sans', !state.serif); try { sessionStorage.setItem('owl-reader', JSON.stringify(state)); } catch {} };
  mk('A−', 'Smaller text', () => { state.size = Math.max(15, state.size - 1); apply(); });
  mk('A+', 'Larger text', () => { state.size = Math.min(30, state.size + 1); apply(); });
  const sep = () => { const s = doc.createElement('span'); s.className = 'owl-r-sep'; bar.appendChild(s); };
  sep();
  mk('Aa', 'Serif / sans-serif', () => { state.serif = !state.serif; apply(); }, 'owl-r-font');
  for (const [t, label] of [['light', 'Light'], ['sepia', 'Sepia'], ['dark', 'Dark']]) mk('', label + ' theme', () => { state.theme = t; apply(); }, 'owl-r-sw owl-r-' + t);
  const art = doc.createElement('article'); art.className = 'owl-r';
  const hdr = doc.createElement('header');
  const s1 = doc.createElement('div'); s1.className = 'owl-r-site'; s1.textContent = site; hdr.appendChild(s1);
  const h = doc.createElement('h1'); h.textContent = title; hdr.appendChild(h);
  const m = doc.createElement('div'); m.className = 'owl-r-meta'; m.textContent = [byline, fmtDate(published), mins + ' min read'].filter(Boolean).join(' · '); hdr.appendChild(m);
  art.appendChild(hdr);
  const content = doc.createElement('div'); content.className = 'owl-r-body';
  while (out.firstChild) content.appendChild(out.firstChild);
  art.appendChild(content);
  body.appendChild(bar); body.appendChild(art);
  html.replaceChildren(head, body);
  apply();
  scrollTo(0, 0);
  return { ok: true, title, words };
})()`;

const CSS = `
html[data-owl-reader] { --r-size: 20px; --bg: #fbfaf8; --ink: #1d1b19; --ink2: #5e5a55; --line: rgba(0,0,0,.09); --link: #8a5a00; --code: rgba(0,0,0,.05); color-scheme: light; background: var(--bg) !important; }
html[data-owl-reader="sepia"] { --bg: #f4ecd8; --ink: #3b2f22; --ink2: #6f604d; --line: rgba(59,47,34,.14); --link: #8a4b00; --code: rgba(59,47,34,.07); }
html[data-owl-reader="dark"] { --bg: #1b1a19; --ink: #e8e4de; --ink2: #a39e96; --line: rgba(255,255,255,.1); --link: #f0b445; --code: rgba(255,255,255,.07); color-scheme: dark; }
html[data-owl-reader] body { margin: 0 !important; background: var(--bg) !important; color: var(--ink) !important; -webkit-font-smoothing: antialiased; }
html[data-owl-reader] .owl-r { max-width: 680px; margin: 0 auto; padding: 72px 28px 120px; font: 400 var(--r-size)/1.65 Charter, 'Iowan Old Style', 'Source Serif Pro', Georgia, Cambria, 'Times New Roman', serif; }
html.owl-r-sans[data-owl-reader] .owl-r { font-family: 'Inter Variable', Inter, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif; line-height: 1.6; }
html[data-owl-reader] .owl-r header { margin-bottom: 2.2em; padding-bottom: 1.4em; border-bottom: 1px solid var(--line); font-family: 'Inter Variable', Inter, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif; }
html[data-owl-reader] .owl-r-site { font-size: 13px; font-weight: 600; letter-spacing: .01em; color: var(--ink2); margin-bottom: 12px; }
html[data-owl-reader] .owl-r h1 { font-size: 2em; line-height: 1.15; letter-spacing: -.02em; margin: 0 0 14px; font-weight: 700; text-wrap: balance; }
html[data-owl-reader] .owl-r-meta { font-size: 14px; color: var(--ink2); }
html[data-owl-reader] .owl-r-body h2, html[data-owl-reader] .owl-r-body h3, html[data-owl-reader] .owl-r-body h4 { line-height: 1.25; margin: 1.8em 0 .6em; letter-spacing: -.01em; text-wrap: balance; }
html[data-owl-reader] .owl-r-body h2 { font-size: 1.4em; } html[data-owl-reader] .owl-r-body h3 { font-size: 1.2em; } html[data-owl-reader] .owl-r-body h4 { font-size: 1.05em; }
html[data-owl-reader] .owl-r-body p { margin: 0 0 1.1em; text-wrap: pretty; }
html[data-owl-reader] .owl-r-body a { color: var(--link); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
html[data-owl-reader] .owl-r-body img { display: block; max-width: 100%; height: auto; margin: 1.6em auto; border-radius: 6px; }
html[data-owl-reader] .owl-r-body figure { margin: 1.6em 0; } html[data-owl-reader] .owl-r-body figcaption { font-size: .78em; color: var(--ink2); margin-top: -.8em; text-align: center; }
html[data-owl-reader] .owl-r-body blockquote { margin: 1.4em 0; padding: 0 0 0 1.1em; border-left: 3px solid var(--line); color: var(--ink2); font-style: italic; }
html[data-owl-reader] .owl-r-body pre { overflow-x: auto; padding: 14px 16px; border-radius: 8px; background: var(--code); font-size: .78em; line-height: 1.5; }
html[data-owl-reader] .owl-r-body code { font-family: ui-monospace, 'Cascadia Code', Consolas, monospace; font-size: .85em; background: var(--code); padding: .1em .3em; border-radius: 4px; } html[data-owl-reader] .owl-r-body pre code { background: none; padding: 0; }
html[data-owl-reader] .owl-r-body ul, html[data-owl-reader] .owl-r-body ol { padding-left: 1.4em; margin: 0 0 1.1em; } html[data-owl-reader] .owl-r-body li { margin: .3em 0; }
html[data-owl-reader] .owl-r-body table { border-collapse: collapse; width: 100%; font-size: .85em; margin: 1.4em 0; display: block; overflow-x: auto; }
html[data-owl-reader] .owl-r-body td, html[data-owl-reader] .owl-r-body th { border-bottom: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
html[data-owl-reader] .owl-r-body hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }
html[data-owl-reader] .owl-r-bar { position: fixed; top: 14px; right: 16px; z-index: 10; display: flex; align-items: center; gap: 4px; padding: 4px; border-radius: 12px; background: var(--bg); border: 1px solid var(--line); box-shadow: 0 6px 24px rgba(0,0,0,.08); font: 500 13px/1 'Inter Variable', Inter, 'Segoe UI', system-ui, sans-serif; opacity: .55; transition: opacity .2s; }
html[data-owl-reader] .owl-r-bar:hover, html[data-owl-reader] .owl-r-bar:focus-within { opacity: 1; }
html[data-owl-reader] .owl-r-bar button { height: 30px; min-width: 32px; padding: 0 8px; border: 0; border-radius: 8px; background: transparent; color: var(--ink); font: inherit; cursor: pointer; }
html[data-owl-reader] .owl-r-bar button:hover { background: var(--code); }
html[data-owl-reader] .owl-r-bar button:focus-visible { outline: 2px solid #e8a317; outline-offset: 1px; }
html[data-owl-reader] .owl-r-font { font-family: Georgia, serif !important; }
html[data-owl-reader] .owl-r-sw { width: 30px; padding: 0 !important; display: grid; place-items: center; }
html[data-owl-reader] .owl-r-sw::after { content: ''; width: 16px; height: 16px; border-radius: 99px; border: 1px solid rgba(0,0,0,.18); }
html[data-owl-reader] .owl-r-light::after { background: #fbfaf8; } html[data-owl-reader] .owl-r-sepia::after { background: #f4ecd8; } html[data-owl-reader] .owl-r-dark::after { background: #1b1a19; border-color: rgba(255,255,255,.25); }
html[data-owl-reader="light"] .owl-r-light::after, html[data-owl-reader="sepia"] .owl-r-sepia::after, html[data-owl-reader="dark"] .owl-r-dark::after { box-shadow: 0 0 0 2px var(--bg), 0 0 0 3.5px #e8a317; }
html[data-owl-reader] .owl-r-sep { width: 1px; height: 18px; background: var(--line); margin: 0 4px; }
@media (max-width: 760px) { html[data-owl-reader] .owl-r { padding-top: 64px; } }
@media print { html[data-owl-reader] .owl-r-bar { display: none; } }
`;

/** turn the page into its reading view; the caller marks the tab and listens for the next navigation */
export async function enterReader(wc: WebContents): Promise<ReaderResult> {
  if (wc.isDestroyed()) return { ok: false, reason: 'Tab closed' };
  try {
    const r = (await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: EXTRACT }], false)) as ReaderResult;
    if (r && r.ok) await wc.insertCSS(CSS, { cssOrigin: 'author' }).catch(() => {});
    return r && typeof r === 'object' ? r : { ok: false, reason: 'Reader mode is not available on this page' };
  } catch (e: any) {
    return { ok: false, reason: 'Reader mode is not available on this page' };
  }
}
