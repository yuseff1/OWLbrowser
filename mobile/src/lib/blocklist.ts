/**
 * Compact ad/tracker blocking for mobile WebViews.
 *
 * react-native-webview cannot intercept sub-resource requests, so blocking happens in three layers:
 *  1. onShouldStartLoadWithRequest: blocks top-level navigations, popups and (iOS) iframe loads to these domains.
 *  2. BLOCKER_SCRIPT (injected before content loads): patches fetch / XHR / sendBeacon / script+iframe+img
 *     element src setters so in-page requests to these domains never leave the page.
 *  3. COSMETIC_CSS: hides common ad containers.
 */
export const BLOCKED_DOMAINS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com', 'googletagmanager.com',
  'googletagservices.com', 'adservice.google.com', 'pagead2.googlesyndication.com', 'imasdk.googleapis.com',
  'adnxs.com', 'adsrvr.org', 'amazon-adsystem.com', 'advertising.com', 'adform.net', 'adroll.com', 'criteo.com',
  'criteo.net', 'casalemedia.com', 'openx.net', 'pubmatic.com', 'rubiconproject.com', 'smartadserver.com',
  'taboola.com', 'outbrain.com', 'revcontent.com', 'mgid.com', 'zergnet.com', 'teads.tv', 'yieldmo.com',
  'moatads.com', 'scorecardresearch.com', 'quantserve.com', 'quantcount.com', 'chartbeat.com', 'chartbeat.net',
  'hotjar.com', 'mouseflow.com', 'fullstory.com', 'crazyegg.com', 'luckyorange.com', 'clarity.ms',
  'segment.io', 'segment.com', 'mixpanel.com', 'amplitude.com', 'heap.io', 'heapanalytics.com',
  'facebook.net', 'connect.facebook.net', 'ads-twitter.com', 'static.ads-twitter.com', 'analytics.twitter.com',
  'ads.linkedin.com', 'px.ads.linkedin.com', 'snap.licdn.com', 'bat.bing.com', 'ads.yahoo.com', 'analytics.yahoo.com',
  'tiktokads.com', 'analytics.tiktok.com', 'ads.pinterest.com', 'ct.pinterest.com', 'branch.io', 'app.link',
  'adcolony.com', 'applovin.com', 'unityads.unity3d.com', 'inmobi.com', 'mopub.com', 'vungle.com', 'chartboost.com',
  'popads.net', 'popcash.net', 'propellerads.com', 'exoclick.com', 'juicyads.com', 'trafficjunky.net', 'adsterra.com',
  'hilltopads.net', 'onclickads.net', 'adcash.com', 'bidswitch.net', 'contextweb.com', 'districtm.io', 'indexww.com',
  'lijit.com', 'sovrn.com', 'sharethrough.com', 'spotxchange.com', 'springserve.com', 'tremorhub.com', 'undertone.com',
  'adsafeprotected.com', 'doubleverify.com', 'serving-sys.com', 'flashtalking.com', 'innovid.com', 'media.net',
  'bluekai.com', 'krxd.net', 'demdex.net', 'omtrdc.net', 'everesttech.net', 'rlcdn.com', 'agkn.com', 'tapad.com',
  'adsymptotic.com', 'nr-data.net', 'newrelic.com', 'optimizely.com', 'cdn.optimizely.com', 'onesignal.com',
  'pushcrew.com', 'pushwoosh.com', 'yandex.ru/ads', 'mc.yandex.ru', 'an.yandex.ru', 'adfox.ru', 'cookielaw.org',
];

const SET = new Set(BLOCKED_DOMAINS.filter((d) => !d.includes('/')));

/** True when the URL's host is (a subdomain of) a blocked domain. O(labels). */
export function isBlocked(url: string): boolean {
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i);
  if (!m) return false;
  const parts = m[1].toLowerCase().split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (SET.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

export const COSMETIC_CSS = [
  '.adsbygoogle', 'ins.adsbygoogle', '[id^="google_ads_"]', '[id^="div-gpt-ad"]', '[data-ad-slot]', '[data-ad-unit]',
  '[data-google-query-id]', '.ad-banner', '.ad-container', '.ad-slot', '.ad-wrapper', '.advert', '.advertisement',
  '.ads-container', '.sponsored-ad', '.taboola', '[id^="taboola-"]', '.OUTBRAIN', '[data-widget-id^="outbrain"]',
  '#ad-banner', '#ad_container', 'iframe[src*="doubleclick.net"]', 'iframe[src*="googlesyndication"]',
  'amp-ad', 'amp-sticky-ad', '.mgid', '[id^="rc_widget"]',
].join(',') + '{display:none!important;visibility:hidden!important;height:0!important;min-height:0!important}';

/** Injected before content loads in every frame. Counts blocks and reports them to the app. */
export const BLOCKER_SCRIPT = `(function(){
  if (window.__owlBlocker) return; window.__owlBlocker = true;
  var D = ${JSON.stringify([...SET])};
  var S = {}; for (var i = 0; i < D.length; i++) S[D[i]] = 1;
  var count = 0, timer = null;
  function report(){ if (timer) return; timer = setTimeout(function(){ timer = null; try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ __owlBlocked: count })); } catch(e){} }, 800); }
  function blocked(u){
    try {
      var h = new URL(String(u), location.href).hostname.toLowerCase().split('.');
      for (var i = 0; i < h.length - 1; i++) if (S[h.slice(i).join('.')]) { count++; report(); return true; }
    } catch(e) {}
    return false;
  }
  var of = window.fetch;
  if (of) window.fetch = function(input, init){ var u = typeof input === 'string' ? input : (input && input.url); if (blocked(u)) return Promise.reject(new TypeError('Blocked by OWL')); return of.apply(this, arguments); };
  var oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u){ this.__owlBlocked = blocked(u); return oo.apply(this, arguments); };
  var os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(){ if (this.__owlBlocked) { var x = this; setTimeout(function(){ try { x.dispatchEvent(new Event('error')); x.dispatchEvent(new Event('loadend')); } catch(e){} }, 0); return; } return os.apply(this, arguments); };
  if (navigator.sendBeacon) { var ob = navigator.sendBeacon.bind(navigator); navigator.sendBeacon = function(u, d){ if (blocked(u)) return true; return ob(u, d); }; }
  function guard(proto, prop){
    var d = Object.getOwnPropertyDescriptor(proto, prop); if (!d || !d.set) return;
    Object.defineProperty(proto, prop, { configurable: true, enumerable: d.enumerable, get: d.get, set: function(v){ if (blocked(v)) return; d.set.call(this, v); } });
  }
  try { guard(HTMLScriptElement.prototype, 'src'); guard(HTMLIFrameElement.prototype, 'src'); guard(HTMLImageElement.prototype, 'src'); } catch(e) {}
  var osa = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(n, v){ if ((n === 'src' || n === 'href') && /^(SCRIPT|IFRAME|IMG|LINK)$/.test(this.tagName) && blocked(v)) return; return osa.apply(this, arguments); };
  var ow = window.open;
  window.open = function(u){ if (u && blocked(u)) return null; return ow.apply(this, arguments); };
  function css(){ try { var s = document.createElement('style'); s.textContent = ${JSON.stringify(COSMETIC_CSS)}; (document.head || document.documentElement).appendChild(s); } catch(e){} }
  if (document.documentElement) css(); else document.addEventListener('DOMContentLoaded', css);
  try {
    new MutationObserver(function(ms){
      for (var i = 0; i < ms.length; i++) for (var j = 0; j < ms[i].addedNodes.length; j++) {
        var n = ms[i].addedNodes[j];
        if (n.nodeType === 1 && /^(SCRIPT|IFRAME|IMG)$/.test(n.tagName) && n.src && blocked(n.src)) n.remove();
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch(e) {}
})(); true;`;
