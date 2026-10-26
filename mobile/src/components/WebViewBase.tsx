import type React from 'react';
import RNWebView from 'react-native-webview';

/** Imperative handle we use on react-native-webview instances. */
export type WebViewHandle = {
  injectJavaScript: (script: string) => void;
  reload: () => void;
  goBack: () => void;
  goForward: () => void;
  stopLoading: () => void;
};

/**
 * react-native-webview's TS entry intersects the iOS/Android/Windows prop types, which collapses to `never`
 * for platform-specific props under TS 6. Re-type it loosely; props are documented in WebViewTypes.ts.
 */
export const WebView = RNWebView as unknown as React.ComponentType<Record<string, any> & { ref?: React.Ref<WebViewHandle> }>;
