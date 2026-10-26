import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/** JSON helpers over AsyncStorage. Keys are namespaced so profiles never collide. */
export async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem('owl:' + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced write: browsing generates many small updates (history, tab titles). */
export function saveJson(key: string, value: unknown, delay = 300) {
  const prev = timers.get(key);
  if (prev) clearTimeout(prev);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      AsyncStorage.setItem('owl:' + key, JSON.stringify(value)).catch(() => {});
    }, delay),
  );
}

export async function removeKey(key: string) {
  await AsyncStorage.removeItem('owl:' + key).catch(() => {});
}

// SecureStore keys must be [A-Za-z0-9._-]
const secKey = (k: string) => 'owl.' + k.replace(/[^A-Za-z0-9._-]/g, '_');

/** API keys live in the iOS Keychain / Android Keystore via expo-secure-store, never AsyncStorage. */
export const secrets = {
  async get(k: string): Promise<string | null> {
    try { return await SecureStore.getItemAsync(secKey(k)); } catch { return null; }
  },
  async set(k: string, v: string | null) {
    try {
      if (v == null || v === '') await SecureStore.deleteItemAsync(secKey(k));
      else await SecureStore.setItemAsync(secKey(k), v);
    } catch {}
  },
};
