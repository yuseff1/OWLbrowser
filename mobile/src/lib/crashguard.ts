import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { flushAll } from './storage';

/**
 * In a release build React Native treats any uncaught JS exception (a throw inside an event handler, timer or
 * native callback such as a WebView event) as fatal and closes the app. Reopened, OWL started from a blank tab
 * because the last tab state was still sitting in a debounced write: it looked like being "logged out".
 *
 * This guard (1) writes pending state to disk before anything else happens, (2) keeps the app alive for
 * non-render errors in release builds (render errors still reach the router ErrorBoundary), and (3) records the
 * last error so it can be inspected. It never deletes user data.
 */
let installed = false;
export function installCrashGuard() {
  if (installed) return;
  installed = true;
  AppState.addEventListener('change', (s) => { if (s !== 'active') flushAll(); });
  const EU = (globalThis as any).ErrorUtils;
  if (!EU?.setGlobalHandler) return;
  const prev = EU.getGlobalHandler?.();
  EU.setGlobalHandler((error: any, isFatal?: boolean) => {
    try { flushAll(); } catch {}
    try {
      AsyncStorage.setItem('owl:lastError', JSON.stringify({ at: Date.now(), fatal: !!isFatal, message: String(error?.message || error), stack: String(error?.stack || '').slice(0, 2000) })).catch(() => {});
    } catch {}
    if (__DEV__) prev?.(error, isFatal);
    else console.error('[owl] uncaught', error);
  });
}
