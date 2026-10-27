import React, { memo, useCallback, useRef } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import type { ShouldStartLoadRequest, WebViewMessageEvent, WebViewNavigation, WebViewNavigationEvent, WebViewProgressEvent } from 'react-native-webview/lib/WebViewTypes';
import { WebView, type WebViewHandle } from './WebViewBase';
import { browser, webviews, type BrowserTab } from '@/state/browser';
import { isBlocked, BLOCKER_SCRIPT } from '@/lib/blocklist';
import { useTheme } from '@/lib/theme';

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const PASSTHROUGH = /^(https?|about|data|blob|file|javascript):/i;

/**
 * Links to other apps (mailto:, tel:, market:, intent:, app schemes). These used to be handed to the OS straight
 * from onShouldStartLoadWithRequest, so any redirect, ad frame or script on a results page could throw the user
 * out of OWL into another app without a tap. Now: intent: links use their https fallback inside the tab, iframes
 * are ignored, and anything else asks first (at most one prompt at a time).
 */
let promptOpen = false;
function handOff(url: string, tabId: string, topFrame: boolean) {
  if (url.startsWith('intent:')) {
    const m = url.match(/;S\.browser_fallback_url=([^;]+)/);
    let fallback = '';
    try { fallback = m ? decodeURIComponent(m[1]) : ''; } catch {}
    if (topFrame && /^https?:\/\//i.test(fallback)) setTimeout(() => browser.navigate(tabId, fallback), 0);
    return;
  }
  if (!topFrame || promptOpen) return;
  const scheme = (url.match(/^([a-z][a-z0-9+.-]*):/i)?.[1] || '').toLowerCase();
  promptOpen = true;
  Alert.alert('Open in another app?', scheme === 'mailto' ? 'Email' : scheme === 'tel' ? 'Phone' : scheme, [
    { text: 'Cancel', style: 'cancel', onPress: () => { promptOpen = false; } },
    { text: 'Open', onPress: () => { promptOpen = false; Linking.openURL(url).catch(() => {}); } },
  ], { cancelable: true, onDismiss: () => { promptOpen = false; } });
}

type Props = {
  tab: BrowserTab;
  visible: boolean;
  incognito: boolean;
  adblock: boolean;
  desktopMode: boolean;
  bottomInset: number;
};

/** One WebView per live tab. Reports navigation/progress into browserStore and answers the agent bridge. */
function BrowserWebViewImpl({ tab, visible, incognito, adblock, desktopMode, bottomInset }: Props) {
  const t = useTheme();
  const ref = useRef<WebViewHandle | null>(null);
  const id = tab.id;

  const setRef = useCallback((r: WebViewHandle | null) => {
    ref.current = r;
    webviews.register(id, r);
  }, [id]);

  const onNav = useCallback((e: WebViewNavigation) => {
    browser.onPageNav(id, { url: e.url, title: e.title, loading: e.loading, canGoBack: e.canGoBack, canGoForward: e.canGoForward });
  }, [id]);

  // Android also fires loadStart for history.pushState (doUpdateVisitedHistory); those arrive with loading=false
  // once the page is complete, so only a start that is really loading turns the progress bar on.
  const onLoadStart = useCallback((e: WebViewNavigationEvent) => {
    if (e.nativeEvent?.loading) browser.onLoadStart(id);
  }, [id]);

  const onProgress = useCallback((e: WebViewProgressEvent) => {
    browser.onLoadProgress(id, e.nativeEvent.progress);
  }, [id]);

  const onLoadEnd = useCallback((e: any) => {
    const n = e?.nativeEvent || {};
    if (n.url) browser.onPageNav(id, { url: n.url, title: n.title, loading: false, canGoBack: !!n.canGoBack, canGoForward: !!n.canGoForward });
    browser.onLoadEnd(id);
  }, [id]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    webviews.handleMessage(id, e.nativeEvent.data);
  }, [id]);

  const onShouldStart = useCallback((req: ShouldStartLoadRequest) => {
    const url = req.url || '';
    if (!PASSTHROUGH.test(url)) {
      handOff(url, id, req.isTopFrame !== false);
      return false;
    }
    if (adblock && isBlocked(url) && url !== tab.src) return false;
    return true;
  }, [adblock, tab.src, id]);

  const onOpenWindow = useCallback((e: any) => {
    const url = e.nativeEvent?.targetUrl;
    if (url && !(adblock && isBlocked(url))) browser.newTab(url, { private: tab.private });
  }, [adblock, tab.private]);

  // Renderer died (OOM on low-end phones): clear the loading UI, then reload — at most once per 10 s so a page
  // that kills the renderer on load can't trap the app in a crash/reload loop.
  const lastCrash = useRef(0);
  const onCrash = useCallback(() => {
    browser.onLoadEnd(id);
    const now = Date.now();
    if (now - lastCrash.current > 10000) {
      lastCrash.current = now;
      ref.current?.reload();
    }
  }, [id]);

  const webview = (
    <WebView
      ref={setRef}
      key={`${id}:${tab.nonce}:${adblock ? 1 : 0}:${desktopMode ? 1 : 0}:${incognito ? 1 : 0}`}
      source={{ uri: tab.src }}
      style={{ flex: 1, backgroundColor: t.ground }}
      containerStyle={{ backgroundColor: t.ground }}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      incognito={incognito}
      sharedCookiesEnabled={!incognito}
      thirdPartyCookiesEnabled={!incognito}
      cacheEnabled={!incognito}
      allowsBackForwardNavigationGestures
      allowsInlineMediaPlayback
      allowsFullscreenVideo
      mediaPlaybackRequiresUserAction
      setSupportMultipleWindows
      javaScriptCanOpenWindowsAutomatically={false}
      pullToRefreshEnabled={false}
      contentInset={{ bottom: bottomInset }}
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      userAgent={desktopMode ? DESKTOP_UA : undefined}
      applicationNameForUserAgent={desktopMode ? undefined : 'OWL/0.1'}
      injectedJavaScriptBeforeContentLoaded={adblock ? BLOCKER_SCRIPT : 'true;'}
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
      injectedJavaScriptForMainFrameOnly
      onShouldStartLoadWithRequest={onShouldStart}
      onNavigationStateChange={onNav}
      onLoadStart={onLoadStart}
      onLoadProgress={onProgress}
      onLoadEnd={onLoadEnd}
      onMessage={onMessage}
      onOpenWindow={onOpenWindow}
      onContentProcessDidTerminate={onCrash}
      onRenderProcessGone={onCrash}
      onFileDownload={(e: any) => { Linking.openURL(e.nativeEvent.downloadUrl).catch(() => {}); }}
      webviewDebuggingEnabled={__DEV__}
      forceDarkOn={false}
    />
  );

  // The WebView is mounted directly (no ScrollView/RefreshControl wrapper on Android): the wrapper intercepted
  // vertical drags on pages that scroll an inner container, so those pages looked frozen. Reload is in the address bar.
  return (
    <View style={[StyleSheet.absoluteFill, !visible && styles.hidden]} pointerEvents={visible ? 'auto' : 'none'}>
      {webview}
    </View>
  );
}

export const BrowserWebView = memo(BrowserWebViewImpl);

const styles = StyleSheet.create({
  hidden: { opacity: 0, zIndex: -1 },
});
