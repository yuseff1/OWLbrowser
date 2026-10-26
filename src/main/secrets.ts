import { safeStorage } from 'electron';
import { JsonStore } from './store';

/** Encrypted-at-rest secrets (API keys, passwords) using the OS keychain (DPAPI on Windows). */
const store = new JsonStore<Record<string, string>>('secrets', {});

let warnedPlain = false;
function enc(v: string): string {
  if (safeStorage.isEncryptionAvailable()) return 'e:' + safeStorage.encryptString(v).toString('base64');
  // Only reachable where the OS offers no keychain (e.g. Linux without libsecret); DPAPI is always present on Windows.
  if (!warnedPlain) { warnedPlain = true; console.warn('[secrets] OS encryption unavailable: secrets are stored obfuscated, not encrypted'); }
  return 'p:' + Buffer.from(v, 'utf8').toString('base64');
}
function dec(v: string): string {
  if (v.startsWith('e:')) return safeStorage.decryptString(Buffer.from(v.slice(2), 'base64'));
  if (v.startsWith('p:')) return Buffer.from(v.slice(2), 'base64').toString('utf8');
  return v;
}

export const secrets = {
  set(key: string, value: string | null) {
    store.update((d) => { if (value == null || value === '') delete d[key]; else d[key] = enc(value); });
  },
  get(key: string): string | null {
    const v = store.get()[key];
    if (!v) return null;
    try { return dec(v); } catch { return null; }
  },
  has(key: string) { return !!store.get()[key]; },
  flush() { store.flush(); },
};
