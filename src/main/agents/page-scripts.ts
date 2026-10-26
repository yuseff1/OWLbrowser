// Scripts injected into web pages (executed in the page's main world via executeJavaScript).
// Kept as strings so they run in any site without bundling.

/**
 * Builds a compact, LLM-friendly snapshot of the page: interactive elements get numeric refs
 * (data-owl-ref) the agent can target, plus a trimmed readable text of the viewport.
 */
export const SNAPSHOT_SCRIPT = `(() => {
  const MAX_EL = 180;
  const vw = innerWidth, vh = innerHeight;
  document.querySelectorAll('[data-owl-ref]').forEach(e => e.removeAttribute('data-owl-ref'));
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < -vh * 0.5 || r.top > vh * 2.5 || r.right < 0 || r.left > vw) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('alt') ||
      (el.labels && el.labels[0] && el.labels[0].innerText) || el.innerText || el.value || el.getAttribute('name') || '').trim();
    return t.replace(/\\s+/g, ' ').slice(0, 90);
  };
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox],[role=textbox],[contenteditable=""],[contenteditable=true],summary,label[for]';
  const all = Array.from(document.querySelectorAll(sel));
  // include elements in open shadow roots (one level)
  document.querySelectorAll('*').forEach(h => { if (h.shadowRoot) all.push(...h.shadowRoot.querySelectorAll(sel)); });
  const out = [];
  let n = 0;
  for (const el of all) {
    if (n >= MAX_EL) break;
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'select' ? 'select' : tag === 'textarea' ? 'textbox' : tag === 'input' ? (el.type || 'text') : tag);
    n++;
    el.setAttribute('data-owl-ref', String(n));
    const inView = r.top >= 0 && r.bottom <= vh;
    let extra = '';
    if (tag === 'input' || tag === 'textarea') extra = el.value ? ' value="' + String(el.value).slice(0, 40) + '"' : '';
    if (el.type === 'checkbox' || el.type === 'radio') extra += el.checked ? ' [checked]' : '';
    if (tag === 'a') { const h = el.getAttribute('href') || ''; if (h && !h.startsWith('javascript')) extra += ' -> ' + h.slice(0, 80); }
    if (el.disabled) extra += ' [disabled]';
    out.push('[' + n + '] ' + role + ' "' + label(el) + '"' + extra + (inView ? '' : ' (offscreen)'));
  }
  const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 6000);
  return {
    url: location.href,
    title: document.title,
    scroll: { y: Math.round(scrollY), max: Math.round(document.documentElement.scrollHeight - vh) },
    elements: out.join('\\n'),
    text
  };
})()`;

/** Returns the viewport-center coordinates of a ref'd element after scrolling it into view. */
export const LOCATE_SCRIPT = (ref: number) => `(() => {
  const el = document.querySelector('[data-owl-ref="${ref}"]') || Array.from(document.querySelectorAll('*')).map(h => h.shadowRoot && h.shadowRoot.querySelector('[data-owl-ref="${ref}"]')).find(Boolean);
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  const form = el.closest('form'); const label = ((el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || '') + '').trim().slice(0, 80); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tag: el.tagName.toLowerCase(), label, type: el.type || '', inForm: !!form, editable: el.isContentEditable || /input|textarea|select/i.test(el.tagName) };
})()`;

export const SELECT_OPTION_SCRIPT = (ref: number, value: string) => `(() => {
  const el = document.querySelector('[data-owl-ref="${ref}"]');
  if (!el || el.tagName !== 'SELECT') return 'not a select';
  const v = ${JSON.stringify(value)}.toLowerCase();
  const opt = Array.from(el.options).find(o => o.value.toLowerCase() === v || o.text.trim().toLowerCase() === v) || Array.from(el.options).find(o => o.text.toLowerCase().includes(v));
  if (!opt) return 'option not found. options: ' + Array.from(el.options).map(o => o.text.trim()).slice(0, 30).join(' | ');
  el.value = opt.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'selected ' + opt.text.trim();
})()`;

export const CLEAR_SCRIPT = (ref: number) => `(() => {
  const el = document.querySelector('[data-owl-ref="${ref}"]');
  if (!el) return false;
  el.focus();
  if ('value' in el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
  else if (el.isContentEditable) { el.textContent = ''; }
  return true;
})()`;

/** Readable main content (rough Readability) as markdown-ish text. */
export const READ_SCRIPT = `(() => {
  const pick = document.querySelector('article, main, [role=main]') || document.body;
  const clone = pick.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,svg,nav,footer,header,aside,iframe,form').forEach(e => e.remove());
  const lines = [];
  const walk = (n) => {
    for (const c of n.children) {
      const t = c.tagName;
      if (/^H[1-6]$/.test(t)) lines.push('\\n' + '#'.repeat(+t[1]) + ' ' + c.innerText.trim());
      else if (t === 'P' || t === 'BLOCKQUOTE') lines.push(c.innerText.trim());
      else if (t === 'LI') lines.push('- ' + c.innerText.trim());
      else if (t === 'A' && c.children.length === 0) lines.push('[' + c.innerText.trim() + '](' + c.href + ')');
      else if (t === 'TABLE') lines.push(Array.from(c.rows).slice(0, 40).map(r => Array.from(r.cells).map(x => x.innerText.trim()).join(' | ')).join('\\n'));
      else walk(c);
    }
  };
  walk(clone);
  const out = lines.filter(Boolean).join('\\n').replace(/\\n{3,}/g, '\\n\\n');
  return { title: document.title, url: location.href, text: (out.length > 200 ? out : pick.innerText).slice(0, 20000) };
})()`;

/** Visual overlay shown on a tab while a companion controls it (Strawberry-style "Controlled by X"). */
export const OVERLAY_SCRIPT = (name: string, color: string) => `(() => {
  if (window.__owlOverlay) { window.__owlOverlay.querySelector('b').textContent = ${JSON.stringify(name)}; return; }
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const sh = host.attachShadow({ mode: 'closed' });
  sh.innerHTML = '<style>.r{position:fixed;inset:0;border:3px solid ${color};border-radius:10px;box-shadow:inset 0 0 40px ${color}55;animation:p 2s ease-in-out infinite}@keyframes p{50%{box-shadow:inset 0 0 70px ${color}88}}.c{position:fixed;width:18px;height:18px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 10px #0006;transition:all .35s cubic-bezier(.2,.8,.2,1);left:-40px;top:-40px}</style><div class=r></div><div class=c></div>';
  document.documentElement.appendChild(host);
  window.__owlOverlay = host;
  window.__owlCursor = (x, y) => { const c = sh.querySelector('.c'); c.style.left = (x - 9) + 'px'; c.style.top = (y - 9) + 'px'; };
  const b = document.createElement('b'); host.appendChild(b); b.style.display = 'none'; b.textContent = ${JSON.stringify(name)};
})()`;

export const OVERLAY_REMOVE = `(() => { if (window.__owlOverlay) { window.__owlOverlay.remove(); window.__owlOverlay = null; } })()`;
export const CURSOR_SCRIPT = (x: number, y: number) => `window.__owlCursor && window.__owlCursor(${x}, ${y})`;
