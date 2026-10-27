/**
 * Page insets for Android, where the WebView runs *under* the glass dock (so the dock can blur it) but has no
 * `contentInset` like iOS. Injected into the main frame only:
 *  - spacers before/after the document so the first and last content can scroll clear of the dock;
 *  - fixed / sticky bars pinned to the covered edge (cookie banners, sticky headers, bottom nav) are moved in by the
 *    inset, and restored when the inset goes away. Full scan on load + on DOM changes (throttled); while scrolling,
 *    only the elements at the two edges are probed (elementsFromPoint), so scrolling stays cheap.
 * `window.__owlSetInset(top, bottom)` updates a live page (bar moved top <-> bottom, setting toggled).
 */
export function insetBootScript(top: number, bottom: number) {
  return `(function(){
  if (window.top !== window || window.__owlSetInset) return;
  var I = { t: ${Math.round(top)}, b: ${Math.round(bottom)} };
  var style = null, gen = 0, scanTimer = 0, probeTimer = 0, lastScan = 0;
  function css(){
    if (!style) { style = document.createElement('style'); style.id = 'owl-inset'; }
    style.textContent = 'html::before{content:"";display:block;height:' + I.t + 'px;pointer-events:none}'
      + 'html::after{content:"";display:block;height:' + I.b + 'px;pointer-events:none}'
      + 'html{scroll-padding-top:' + I.t + 'px;scroll-padding-bottom:' + I.b + 'px}';
    var p = document.head || document.documentElement;
    if (p && style.parentNode !== p) p.appendChild(style);
  }
  function apply(e){
    if (!e || e.nodeType !== 1 || e === document.documentElement || e === document.body) return;
    var cs = getComputedStyle(e), pos = cs.position;
    if (pos !== 'fixed' && pos !== 'sticky') return;
    if (!e.__owl) e.__owl = { t: cs.top, b: cs.bottom, it: e.style.getPropertyValue('top'), ip: e.style.getPropertyPriority('top'), ib: e.style.getPropertyValue('bottom'), bp: e.style.getPropertyPriority('bottom') };
    var o = e.__owl, r = e.getBoundingClientRect(), vh = window.innerHeight;
    if (!r.height || r.height > vh * 0.6) return;
    var ot = parseFloat(o.t), ob = parseFloat(o.b);
    if (!isNaN(ot) && ot <= 24) {
      if (I.t) e.style.setProperty('top', (ot + I.t) + 'px', 'important');
      else if (e.__owlT) { if (o.it) e.style.setProperty('top', o.it, o.ip); else e.style.removeProperty('top'); }
      e.__owlT = !!I.t;
    } else if (!isNaN(ob) && ob <= 24) {
      if (I.b) e.style.setProperty('bottom', (ob + I.b) + 'px', 'important');
      else if (e.__owlB) { if (o.ib) e.style.setProperty('bottom', o.ib, o.bp); else e.style.removeProperty('bottom'); }
      e.__owlB = !!I.b;
    }
  }
  function scan(){
    lastScan = Date.now();
    var b = document.body; if (!b) return;
    try {
      var all = b.getElementsByTagName('*'), n = Math.min(all.length, 1500), i;
      for (i = 0; i < n; i++) apply(all[i]);
      var ch = b.children; for (i = 0; i < ch.length; i++) apply(ch[i]);
    } catch (e) {}
  }
  function soon(){ if (scanTimer) return; scanTimer = setTimeout(function(){ scanTimer = 0; scan(); }, Math.max(0, 1200 - (Date.now() - lastScan))); }
  function probe(){
    probeTimer = 0;
    if (!I.t && !I.b) return;
    var w = window.innerWidth, vh = window.innerHeight, ys = [], xs = [w * 0.2, w * 0.5, w * 0.8];
    if (I.t) ys.push(4, I.t * 0.5);
    if (I.b) ys.push(vh - 4, vh - I.b * 0.5);
    for (var a = 0; a < ys.length; a++) for (var c = 0; c < xs.length; c++) {
      var el = document.elementFromPoint(xs[c], ys[a]), d = 0;
      while (el && d++ < 12) { apply(el); el = el.parentElement; }
    }
  }
  window.__owlSetInset = function(t, b){ I.t = Math.round(t) || 0; I.b = Math.round(b) || 0; css(); scan(); };
  css();
  document.addEventListener('DOMContentLoaded', function(){ css(); scan(); try { new MutationObserver(soon).observe(document.body, { childList: true, subtree: true }); } catch (e) {} });
  window.addEventListener('load', function(){ scan(); setTimeout(scan, 1500); setTimeout(scan, 4000); });
  window.addEventListener('scroll', function(){ if (!probeTimer) probeTimer = setTimeout(probe, 250); }, { passive: true });
  window.addEventListener('resize', soon);
})(); true;`;
}

export function setInsetScript(top: number, bottom: number) {
  return `try { window.__owlSetInset && window.__owlSetInset(${Math.round(top)}, ${Math.round(bottom)}); } catch (e) {} true;`;
}
