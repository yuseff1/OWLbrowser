import { owl } from '$lib/api';

/** Tiny, safe markdown → HTML (escapes everything first). Enough for run results and skill instructions. */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);

function inline(s: string) {
  let out = esc(s);
  const codes: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  out = out
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[+i]}</code>`);
}

export function md(src: string): string {
  if (!src) return '';
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;
  let para: string[] = [];
  const flush = () => { if (para.length) { html.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flush(); const n = Math.min(4, h[1].length + 2); html.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      flush();
      const ordered = /^\s*\d+[.)]/.test(l);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        let t = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        const box = t.match(/^\[( |x)\]\s+/i);
        if (box) t = `<span class="md-box${box[1].trim() ? ' on' : ''}" aria-hidden="true"></span>` + inline(t.slice(box[0].length));
        else t = inline(t);
        items.push(`<li>${t}</li>`);
        i++;
      }
      html.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const row = (r: string) => r.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
      const head = row(l);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      html.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^>\s?/.test(l)) { flush(); const buf: string[] = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); html.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`); continue; }
    if (/^\s*$/.test(l)) { flush(); i++; continue; }
    if (/^---+\s*$/.test(l)) { flush(); html.push('<hr>'); i++; continue; }
    para.push(l.trim());
    i++;
  }
  flush();
  return html.join('\n');
}

/** Svelte action: open markdown links in a new browser tab instead of navigating the UI. */
export function extLinks(node: HTMLElement) {
  const h = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    owl.newTab(a.getAttribute('href')!);
  };
  node.addEventListener('click', h);
  return { destroy: () => node.removeEventListener('click', h) };
}
