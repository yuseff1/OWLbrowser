/**
 * Small in-page helpers for daily browsing (main frame only, injected before content loads):
 *  - long-press on a link or image → `{ __owlCtx: { href, text, src } }` so the app can show its own link menu
 *    (Blink fires `contextmenu` on long-press; a touch timer covers pages/WebViews that don't, deduped). The click
 *    that follows a long-press is swallowed so the link doesn't also open.
 *  - once the page is parsed → `{ __owlMeta: { image } }` (og:image / twitter:image) used as the tab card cover.
 */
export const PAGE_TOOLS_SCRIPT = `(function(){
  if (window.top !== window || window.__owlTools) return;
  window.__owlTools = 1;
  function post(m){ try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch(e){} }
  function abs(u){ try { return new URL(u, location.href).href; } catch(e){ return ''; } }
  var lastFire = 0, swallowUntil = 0, timer = 0, sx = 0, sy = 0;
  function target(el){
    var a = null, img = null;
    for (var n = el, i = 0; n && n.nodeType === 1 && i < 12; n = n.parentElement, i++) {
      if (!img && n.tagName === 'IMG' && (n.currentSrc || n.src)) img = n;
      if (!a && n.tagName === 'A' && n.getAttribute('href')) a = n;
    }
    var href = a ? abs(a.getAttribute('href')) : '';
    if (href && !/^https?:/i.test(href)) href = '';
    var src = img ? abs(img.currentSrc || img.src) : '';
    if (src && !/^https?:/i.test(src)) src = '';
    if (!href && !src) return null;
    var text = a ? (a.innerText || a.getAttribute('aria-label') || a.title || '').trim().slice(0, 200) : (img && img.alt || '').slice(0, 200);
    return { href: href, src: src, text: text };
  }
  function fire(el){
    var t = target(el); if (!t) return false;
    var now = Date.now();
    if (now - lastFire < 800) return true;
    lastFire = now; swallowUntil = now + 900;
    post({ __owlCtx: t });
    return true;
  }
  document.addEventListener('contextmenu', function(e){ if (fire(e.target)) { e.preventDefault(); } }, true);
  document.addEventListener('touchstart', function(e){
    clearTimeout(timer);
    if (!e.touches || e.touches.length !== 1) return;
    var el = e.target; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    if (!target(el)) return;
    timer = setTimeout(function(){ fire(el); }, 520);
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', function(e){
    if (!timer || !e.touches || !e.touches[0]) return;
    if (Math.abs(e.touches[0].clientX - sx) > 10 || Math.abs(e.touches[0].clientY - sy) > 10) { clearTimeout(timer); timer = 0; }
  }, { capture: true, passive: true });
  ['touchend','touchcancel'].forEach(function(k){ document.addEventListener(k, function(){ clearTimeout(timer); timer = 0; }, { capture: true, passive: true }); });
  document.addEventListener('click', function(e){ if (Date.now() < swallowUntil) { e.preventDefault(); e.stopPropagation(); swallowUntil = 0; } }, true);
  try {
    var st = document.createElement('style');
    st.textContent = 'a,img{-webkit-touch-callout:none}';
    (document.head || document.documentElement).appendChild(st);
  } catch(e){}
  function meta(){
    var q = function(s){ var m = document.querySelector(s); return m && m.getAttribute('content') || ''; };
    var img = abs(q('meta[property="og:image"]') || q('meta[name="og:image"]') || q('meta[name="twitter:image"]') || q('meta[property="twitter:image"]'));
    post({ __owlMeta: { image: /^https:/i.test(img) ? img : '' } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', meta, { once: true }); else meta();
  // Scroll direction for Safari's scroll-to-minimize dock. Posts only when the wanted state flips:
  // compact after 24 px of continuous downward travel once past the first 48 px; full again after 24 px upward,
  // near the top, or at the very bottom of the page. Works for window scrolling and for big inner scrollers.
  var lastY = -1, acc = 0, want = 0, sent = -1;
  function onScroll(e){
    var el = e && e.target && e.target !== document && e.target.nodeType === 1 ? e.target : null;
    var y, max, vh;
    if (el && el.clientHeight > window.innerHeight * 0.6) { y = el.scrollTop; max = el.scrollHeight; vh = el.clientHeight; }
    else if (!el) { y = window.scrollY || document.documentElement.scrollTop || 0; max = document.documentElement.scrollHeight; vh = window.innerHeight; }
    else return;
    if (lastY < 0) { lastY = y; return; }
    var d = y - lastY; lastY = y;
    if (!d) return;
    acc = (acc > 0) === (d > 0) ? acc + d : d;
    if (y < 48) want = 0;
    else if (y + vh >= max - 4) want = 0;
    else if (acc > 24) want = 1;
    else if (acc < -24) want = 0;
    if (want !== sent) { sent = want; post({ __owlScroll: want }); }
  }
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('pageshow', function(){ lastY = -1; acc = 0; want = 0; sent = -1; });
  // the app brought the dock back (tap on the pill, tab switch): start counting again so the next scroll down collapses it
  window.__owlScrollReset = function(){ acc = 0; want = 0; sent = 0; };
})();`;

/**
 * Find in page. Wraps text matches in <mark data-owl-find> (case-insensitive, skips scripts/inputs/hidden nodes, max
 * 500), scrolls the current one into view and returns { count, index } (index is 0-based, -1 when none).
 */
/** Tell a page's scroll watcher that the dock is full again. */
export const SCROLL_RESET_SCRIPT = 'try { window.__owlScrollReset && window.__owlScrollReset(); } catch (e) {} true;';

export const findScript = (query: string) => `(function(q){
  var W = window, D = document;
  function clear(){
    var ms = D.querySelectorAll('mark[data-owl-find]');
    for (var i = 0; i < ms.length; i++) { var m = ms[i], p = m.parentNode; if (!p) continue; p.replaceChild(D.createTextNode(m.textContent), m); p.normalize(); }
    W.__owlFind = null;
  }
  clear();
  if (!q) return { count: 0, index: -1 };
  var st = D.getElementById('owl-find-style');
  if (!st) { st = D.createElement('style'); st.id = 'owl-find-style'; st.textContent = 'mark[data-owl-find]{background:rgba(232,163,23,.35);color:inherit;border-radius:2px;padding:0}mark[data-owl-find].owl-cur{background:#E8A317;color:#141317}'; (D.head || D.documentElement).appendChild(st); }
  var ql = q.toLowerCase(), marks = [];
  var walker = D.createTreeWalker(D.body || D.documentElement, NodeFilter.SHOW_TEXT, { acceptNode: function(n){
    var p = n.parentElement; if (!p) return 2;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|OPTION|MARK)$/.test(p.tagName)) return 2;
    if (n.nodeValue.toLowerCase().indexOf(ql) < 0) return 2;
    if (!p.getClientRects().length) return 2;
    return 1;
  } });
  var nodes = []; while (walker.nextNode() && nodes.length < 500) nodes.push(walker.currentNode);
  for (var i = 0; i < nodes.length && marks.length < 500; i++) {
    var n = nodes[i];
    while (n) {
      var at = n.nodeValue.toLowerCase().indexOf(ql); if (at < 0) break;
      var hit = n.splitText(at); var rest = hit.splitText(q.length);
      var m = D.createElement('mark'); m.setAttribute('data-owl-find', ''); hit.parentNode.replaceChild(m, hit); m.appendChild(hit);
      marks.push(m); n = rest; if (marks.length >= 500) break;
    }
  }
  W.__owlFind = { marks: marks, i: -1 };
  function go(i){
    var f = W.__owlFind; if (!f || !f.marks.length) return { count: 0, index: -1 };
    if (f.i >= 0 && f.marks[f.i]) f.marks[f.i].classList.remove('owl-cur');
    f.i = (i + f.marks.length) % f.marks.length;
    var c = f.marks[f.i]; c.classList.add('owl-cur');
    try { c.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(e) { c.scrollIntoView(); }
    return { count: f.marks.length, index: f.i };
  }
  W.__owlFindGo = go;
  W.__owlFindClear = clear;
  return go(0);
})(${JSON.stringify(query)})`;

export const findStepScript = (dir: 1 | -1) =>
  `(function(){ var f = window.__owlFind; if (!f || !window.__owlFindGo) return { count: 0, index: -1 }; return window.__owlFindGo(f.i + (${dir})); })()`;

export const FIND_CLEAR_SCRIPT = `(function(){ window.__owlFindClear && window.__owlFindClear(); return true; })()`;

/** iOS has no WebView textZoom; scale text the way Safari's "Page zoom" does for text. */
export const textSizeScript = (pct: number) =>
  `(function(){ try { document.documentElement.style.webkitTextSizeAdjust = '${Math.round(pct)}%'; } catch(e){} })(); true;`;

export const TEXT_SIZES = [50, 67, 75, 85, 100, 115, 125, 150, 175, 200] as const;
