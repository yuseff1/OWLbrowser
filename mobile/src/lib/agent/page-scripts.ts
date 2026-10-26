// Scripts injected into the current tab's WebView while a companion drives it.
// Ported from desktop src/main/agents/page-scripts.ts. Desktop uses trusted input events
// (wc.sendInputEvent); mobile WebViews have no such API, so click/type are done with DOM events
// that frameworks (React, Vue, Angular) listen to, which works on the vast majority of sites.
//
// Every script is an EXPRESSION; bridge.ts wraps it so its (possibly async) value is posted back
// through window.ReactNativeWebView.postMessage.

/** Compact LLM-friendly snapshot: interactive elements get numeric refs (data-owl-ref) + visible text. */
export const SNAPSHOT_SCRIPT = `(() => {
  const MAX_EL = 150;
  const vw = innerWidth, vh = innerHeight;
  document.querySelectorAll('[data-owl-ref]').forEach(e => e.removeAttribute('data-owl-ref'));
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < -vh * 0.5 || r.top > vh * 3 || r.right < 0 || r.left > vw) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('alt') ||
      (el.labels && el.labels[0] && el.labels[0].innerText) || el.innerText || el.value || el.getAttribute('name') || '').trim();
    return t.replace(/\\s+/g, ' ').slice(0, 80);
  };
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox],[role=textbox],[contenteditable=""],[contenteditable=true],summary,label[for]';
  const all = Array.from(document.querySelectorAll(sel));
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
  const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 5000);
  return {
    url: location.href,
    title: document.title,
    scroll: { y: Math.round(scrollY), max: Math.round(document.documentElement.scrollHeight - vh) },
    elements: out.join('\\n'),
    text
  };
})()`;

const FIND = (ref: number) => `(document.querySelector('[data-owl-ref="${ref}"]') || Array.from(document.querySelectorAll('*')).map(h => h.shadowRoot && h.shadowRoot.querySelector('[data-owl-ref="${ref}"]')).find(Boolean))`;

/** Describe a ref'd element without acting (used by the approval guard before clicking). */
export const DESCRIBE_SCRIPT = (ref: number) => `(() => {
  const el = ${FIND(ref)};
  if (!el) return null;
  const label = ((el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || '') + '').trim().replace(/\\s+/g, ' ').slice(0, 80);
  return { tag: el.tagName.toLowerCase(), label, type: el.type || '', inForm: !!el.closest('form') };
})()`;

/** Scroll into view, show the companion cursor, then fire the pointer/mouse/click sequence. */
export const CLICK_SCRIPT = (ref: number) => `(() => {
  const el = ${FIND(ref)};
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  window.__owlCursor && window.__owlCursor(x, y);
  const target = document.elementFromPoint(x, y) || el;
  const hit = el.contains(target) ? target : el;
  const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window, button: 0 };
  try { hit.dispatchEvent(new PointerEvent('pointerdown', { ...o, pointerType: 'touch', isPrimary: true })); } catch (e) {}
  try { hit.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true })); } catch (e) {}
  hit.dispatchEvent(new MouseEvent('mousedown', o));
  if (typeof el.focus === 'function') el.focus({ preventScroll: true });
  try { hit.dispatchEvent(new PointerEvent('pointerup', { ...o, pointerType: 'touch', isPrimary: true })); } catch (e) {}
  try { hit.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true })); } catch (e) {}
  hit.dispatchEvent(new MouseEvent('mouseup', o));
  if (typeof el.click === 'function') el.click(); else hit.dispatchEvent(new MouseEvent('click', o));
  const label = ((el.getAttribute('aria-label') || el.innerText || el.value || '') + '').trim().replace(/\\s+/g, ' ').slice(0, 80);
  return { tag: el.tagName.toLowerCase(), label };
})()`;

/**
 * Type into inputs / textareas / contenteditable in a way React & co. notice
 * (native value setter + input/change events), optionally pressing Enter / submitting the form.
 */
export const TYPE_SCRIPT = (ref: number, text: string, opts: { submit?: boolean; clear?: boolean }) => `(() => {
  const el = ${FIND(ref)};
  if (!el) return null;
  const text = ${JSON.stringify(text)};
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  window.__owlCursor && window.__owlCursor(r.left + r.width / 2, r.top + r.height / 2);
  el.focus();
  if (el.isContentEditable) {
    if (${!!opts.clear}) { document.execCommand('selectAll', false); document.execCommand('delete', false); }
    document.execCommand('insertText', false, text);
  } else if ('value' in el) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    const next = ${!!opts.clear} ? text : (el.value || '') + text;
    setter.call(el, next);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    return { error: 'Element is not editable' };
  }
  let submitted = false;
  if (${!!opts.submit}) {
    const k = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    const notCancelled = el.dispatchEvent(new KeyboardEvent('keydown', k));
    el.dispatchEvent(new KeyboardEvent('keypress', k));
    el.dispatchEvent(new KeyboardEvent('keyup', k));
    const form = el.closest('form');
    if (form && notCancelled) {
      try { if (form.requestSubmit) form.requestSubmit(); else form.submit(); submitted = true; } catch (e) { try { form.submit(); submitted = true; } catch (e2) {} }
    }
  }
  return { tag: el.tagName.toLowerCase(), inForm: !!el.closest('form'), submitted, label: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || '').slice(0, 60) };
})()`;

export const SELECT_OPTION_SCRIPT = (ref: number, value: string) => `(() => {
  const el = ${FIND(ref)};
  if (!el || el.tagName !== 'SELECT') return 'not a select';
  const v = ${JSON.stringify(value)}.toLowerCase();
  const opt = Array.from(el.options).find(o => o.value.toLowerCase() === v || o.text.trim().toLowerCase() === v) || Array.from(el.options).find(o => o.text.toLowerCase().includes(v));
  if (!opt) return 'option not found. options: ' + Array.from(el.options).map(o => o.text.trim()).slice(0, 30).join(' | ');
  el.value = opt.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return 'selected ' + opt.text.trim();
})()`;

export const SCROLL_SCRIPT = (direction: string) => `(() => {
  const d = ${JSON.stringify(direction)};
  if (d === 'top') scrollTo(0, 0);
  else if (d === 'bottom') scrollTo(0, document.documentElement.scrollHeight);
  else scrollBy(0, (d === 'up' ? -1 : 1) * innerHeight * 0.8);
  return { y: Math.round(scrollY), max: Math.round(document.documentElement.scrollHeight - innerHeight) };
})()`;

/** Readable main content (rough Readability) as markdown-ish text. Also powers Reader mode. */
export const READ_SCRIPT = `(() => {
  const pick = document.querySelector('article, main, [role=main]') || document.body;
  const clone = pick.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,svg,nav,footer,header,aside,iframe,form,button').forEach(e => e.remove());
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
  const byline = (document.querySelector('meta[name=author]') || {}).content || '';
  const site = (document.querySelector('meta[property="og:site_name"]') || {}).content || location.hostname;
  const hero = (document.querySelector('meta[property="og:image"]') || {}).content || '';
  return { title: document.title, url: location.href, byline, site, hero, text: (out.length > 200 ? out : pick.innerText).slice(0, 40000) };
})()`;

/** In-page companion cursor (the ring itself is drawn natively over the WebView). */
export const CURSOR_SETUP_SCRIPT = (color: string) => `(() => {
  if (window.__owlCursor) return true;
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 12px rgba(0,0,0,.4);z-index:2147483647;pointer-events:none;transition:left .35s cubic-bezier(.2,.8,.2,1),top .35s cubic-bezier(.2,.8,.2,1),opacity .3s;left:-40px;top:-40px;opacity:0';
  document.documentElement.appendChild(c);
  window.__owlCursor = (x, y) => { c.style.opacity = '1'; c.style.left = x + 'px'; c.style.top = y + 'px'; };
  window.__owlCursorRemove = () => { c.remove(); window.__owlCursor = null; };
  return true;
})()`;

export const CURSOR_REMOVE_SCRIPT = `(() => { window.__owlCursorRemove && window.__owlCursorRemove(); return true; })()`;
