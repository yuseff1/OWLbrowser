// Scripts injected into web pages (executed in the page's main world via executeJavaScript).
// Kept as strings so they run in any site without bundling.

/**
 * Page-side heuristics shared by LOCATE / FOCUS: secret fields (passwords, card data, one-time codes,
 * PINs) and payment forms. Page-controlled, so the main process treats a positive as authoritative and
 * a negative only as "no evidence" (labels on risky clicks are checked separately).
 */
const SENSITIVE_JS = `
  const SENS_RE = /(pass(word|wd|code|phrase)|\\bpwd\\b|\\botp\\b|one.?time|\\b2fa\\b|\\bmfa\\b|totp|verification.?code|security.?code|auth(entication)?.?code|\\bcvv|\\bcvc|\\bcsc\\b|card.?(number|no\\b|num)|\\bcc.?(num|number|csc)|cardnumber|\\biban\\b|\\bssn\\b|social.?security|\\bpin\\b|expiry|exp.?date)/i;
  const AC_RE = /^(cc-|one-time-code|current-password|new-password)/i;
  const isSecret = (el) => {
    if (!el || !/^(INPUT|TEXTAREA)$/.test(el.tagName)) return false;
    if (el.type === 'password') return true;
    const ac = (el.getAttribute('autocomplete') || '').trim();
    if (AC_RE.test(ac)) return true;
    const lab = (el.labels && el.labels[0] && el.labels[0].innerText) || '';
    const hint = [el.name, el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), lab, ac].join(' ');
    return SENS_RE.test(hint);
  };
  const PAY_SEL = '[autocomplete^="cc-"],input[name*="card" i],input[name*="cvv" i],input[name*="cvc" i],iframe[src*="stripe.com"],iframe[src*="braintree"],iframe[src*="adyen"],iframe[src*="checkout.com"],iframe[name*="card" i],iframe[title*="card" i],iframe[title*="payment" i]';
  const secretIn = (root) => !!root && (Array.from(root.querySelectorAll('input,textarea')).some(isSecret));
  const payIn = (root) => !!root && !!root.querySelector(PAY_SEL);
`;

/**
 * Builds a compact, LLM-friendly snapshot of the page: interactive elements get numeric refs
 * (data-owl-ref) the agent can target, plus a trimmed readable text of the viewport.
 */
export const SNAPSHOT_SCRIPT = `(() => {${SENSITIVE_JS}
  const MAX_EL = 150, MAX_EL_CHARS = 7000, MAX_TEXT = 4000;
  // a view that has not been laid out yet reports a ~0px viewport: judge visibility against a normal one
  const vw = innerWidth > 100 ? innerWidth : 1280, vh = innerHeight > 100 ? innerHeight : 800;
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
      (el.labels && el.labels[0] && el.labels[0].innerText) || el.innerText || (isSecret(el) ? '' : el.value) || el.getAttribute('name') || '').trim();
    return t.replace(/\\s+/g, ' ').slice(0, 80);
  };
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox],[role=textbox],[contenteditable=""],[contenteditable=true],summary,label[for]';
  const all = Array.from(document.querySelectorAll(sel));
  // include elements in open shadow roots (one level)
  document.querySelectorAll('*').forEach(h => { if (h.shadowRoot) all.push(...h.shadowRoot.querySelectorAll(sel)); });
  const out = [];
  let n = 0, chars = 0, cut = false;
  for (const el of all) {
    if (n >= MAX_EL || chars >= MAX_EL_CHARS) { cut = true; break; }
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'select' ? 'select' : tag === 'textarea' ? 'textbox' : tag === 'input' ? (el.type || 'text') : tag);
    n++;
    el.setAttribute('data-owl-ref', String(n));
    const inView = r.top >= 0 && r.bottom <= vh;
    let extra = '';
    const secretField = isSecret(el);
    if (tag === 'input' || tag === 'textarea') extra = el.value ? (secretField ? ' [filled]' : ' value="' + String(el.value).slice(0, 40) + '"') : '';
    if (el.type === 'checkbox' || el.type === 'radio') extra += el.checked ? ' [checked]' : '';
    if (tag === 'a') { const h = el.getAttribute('href') || ''; if (h && !h.startsWith('javascript')) extra += ' -> ' + h.slice(0, 80); }
    if (el.disabled) extra += ' [disabled]';
    const line = '[' + n + '] ' + role + ' "' + label(el) + '"' + extra + (inView ? '' : ' (offscreen)');
    chars += line.length + 1;
    out.push(line);
  }
  const full = (document.body ? document.body.innerText : '').replace(/[ \\t]+/g, ' ').replace(/\\n\\s*\\n+/g, '\\n\\n').trim();
  const text = full.length > MAX_TEXT ? full.slice(0, MAX_TEXT) + '\\n…(' + (full.length - MAX_TEXT) + ' more characters; use read_page or scroll)' : full;
  const more = cut ? '\\n…(more elements below; scroll to see them)' : '';
  return {
    url: location.href,
    title: document.title,
    scroll: { y: Math.round(scrollY), max: Math.round(document.documentElement.scrollHeight - vh) },
    elements: out.join('\\n') + more,
    text
  };
})()`;

/** Returns the viewport-center coordinates of a ref'd element after scrolling it into view, plus safety flags. */
export const LOCATE_SCRIPT = (ref: number) => `(() => {${SENSITIVE_JS}
  const el = document.querySelector('[data-owl-ref="${ref}"]') || Array.from(document.querySelectorAll('*')).map(h => h.shadowRoot && h.shadowRoot.querySelector('[data-owl-ref="${ref}"]')).find(Boolean);
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  const form = el.closest('form');
  const secret = isSecret(el);
  const label = ((el.getAttribute('aria-label') || el.innerText || (secret ? '' : el.value) || el.getAttribute('title') || '') + '').trim().slice(0, 80);
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tag: el.tagName.toLowerCase(), label, type: el.type || '', autocomplete: (el.getAttribute('autocomplete') || '') + '',
    inForm: !!form, sensitive: secret, sensitiveForm: secretIn(form) || payIn(form), paymentForm: payIn(form), paymentPage: payIn(document),
    editable: el.isContentEditable || /input|textarea|select/i.test(el.tagName) };
})()`;

/** Safety flags for the focused element (used before press_key Enter submits a form). */
export const FOCUS_SCRIPT = `(() => {${SENSITIVE_JS}
  let el = document.activeElement; while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  if (!el || el === document.body) return { inForm: false, sensitive: false, sensitiveForm: false, paymentPage: payIn(document) };
  const form = el.closest && el.closest('form');
  return { inForm: !!form, sensitive: isSecret(el), sensitiveForm: secretIn(form) || payIn(form), paymentPage: payIn(document), tag: el.tagName.toLowerCase(), label: ((el.getAttribute && el.getAttribute('aria-label')) || el.innerText || '').trim().slice(0, 80) };
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
export const OVERLAY_SCRIPT = (name: string, rawColor: string, color = /^#[0-9a-fA-F]{3,8}$/.test(rawColor) ? rawColor : '#4C6FFF') => `(() => {
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
