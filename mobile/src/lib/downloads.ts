import { Alert, Linking } from 'react-native';

/** File name from a download URL (last path segment, decoded), or the host as a fallback. */
export function fileNameOf(url: string): string {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last || u.hostname;
  } catch {
    return 'file';
  }
}

let open = false;
/**
 * WebView downloads go to the system (Android's download manager / default handler) instead of being silently
 * dropped. Asks first, once at a time, so a page can't fling the user out of OWL with an auto-download.
 */
export function handOffDownload(url: string) {
  if (!url || open || !/^https?:\/\//i.test(url)) return;
  open = true;
  Alert.alert('Download file?', fileNameOf(url), [
    { text: 'Cancel', style: 'cancel', onPress: () => { open = false; } },
    { text: 'Download', onPress: () => { open = false; Linking.openURL(url).catch(() => {}); } },
  ], { cancelable: true, onDismiss: () => { open = false; } });
}
