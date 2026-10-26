/**
 * Tiny, safe markdown → HTML renderer for companion messages.
 * Everything is HTML-escaped first; only a fixed set of tags is produced.
 * Supports: headings, paragraphs, bold, italics, strikethrough, inline code, fenced code,
 * links (http/https/mailto/owl only), bullet + numbered lists (one nesting level), blockquotes, tables, hr.
 */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function safeUrl(u: string) {
  const url = u.trim().replace(/&amp;/g, '&');
  if (/^(https?:|mailto:|owl:)/i.test(url)) return esc(url);
  if (/^www\./i.test(url)) return esc('https://' + url);
  return null;
}

/** inline formatting on an already-escaped string */
function inline(s: string): string {
  const codes: string[] = [];
  s = s.replace(/`([^`\n]+)`/g, (_m, c) => `\u0000${codes.push(c) - 1}\u0000`);
  const links: string[] = [];
  const keep = (html: string) => `\u0001${links.push(html) - 1}\u0001`;
  // links [text](url)
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const u = safeUrl(url);
    return u ? keep(`<a href="${u}" target="_blank" rel="noopener noreferrer">${text}</a>`) : m;
  });
  // bare urls
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g, (m, pre, url) => {
    const u = safeUrl(url);
    return u ? `${pre}${keep(`<a href="${u}" target="_blank" rel="noopener noreferrer">${url}</a>`)}` : m;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  s = s.replace(/\u0001(\d+)\u0001/g, (_m, i) => links[+i]);
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[+i]}</code>`);
  return s;
}

function table(lines: string[]): string {
  const cells = (l: string) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  const head = cells(lines[0]);
  const aligns = cells(lines[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''));
  const al = (i: number) => (aligns[i] ? ` style="text-align:${aligns[i]}"` : '');
  const body = lines.slice(2).map((l) => `<tr>${cells(l).map((c, i) => `<td${al(i)}>${inline(c)}</td>`).join('')}</tr>`).join('');
  return `<div class="owl-prose-table"><table><thead><tr>${head.map((c, i) => `<th${al(i)}>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const LI = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function markdown(src: string): string {
  if (!src) return '';
  const lines = esc(src.replace(/\r\n?/g, '\n')).split('\n');
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`); para = []; } };

  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code${fence[1] ? ` data-lang="${fence[1]}"` : ''}>${buf.join('\n')}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flush(); const n = Math.min(6, h[1].length + 2); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flush();
      const buf = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) buf.push(lines[i++]);
      out.push(table(buf));
      continue;
    }
    if (/^&gt;\s?/.test(line)) {
      flush();
      const buf: string[] = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) buf.push(lines[i++].replace(/^&gt;\s?/, ''));
      out.push(`<blockquote>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
      continue;
    }
    const li = line.match(LI);
    if (li && li[1].length < 2) {
      flush();
      const ordered = /\d/.test(li[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(LI);
        if (m && m[1].length < 2) { items.push(inline(m[3].replace(/^\[( |x)\]\s/i, (_x, c) => (c.trim() ? '☑ ' : '☐ ')))); i++; continue; }
        if (m && items.length) {
          const subOrdered = /\d/.test(m[2]);
          const sub: string[] = [];
          while (i < lines.length) {
            const s = lines[i].match(LI);
            if (!s || s[1].length < 2) break;
            sub.push(`<li>${inline(s[3])}</li>`); i++;
          }
          const t = subOrdered ? 'ol' : 'ul';
          items[items.length - 1] += `<${t}>${sub.join('')}</${t}>`;
          continue;
        }
        if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += ' ' + inline(lines[i].trim()); i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${t}</li>`).join('')}</${tag}>`);
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return out.join('');
}
