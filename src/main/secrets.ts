import { app, safeStorage } from 'electron';
import { JsonStore } from './store';
import { logLine } from './crash';

/**
 * Encrypted-at-rest secrets (API keys, saved passwords, MCP tokens) with Electron safeStorage:
 * DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux.
 *
 * Stored values carry a prefix:
 *   'e:' safeStorage ciphertext (base64)       — the normal case
 *   'p:' base64 only, NOT encrypted            — written only when the OS offers no keychain
 *        (Linux 'basic_text' backend); upgraded to 'e:' as soon as encryption becomes available
 *   no prefix: legacy plaintext from very early builds — upgraded the same way
 *
 * `migrate()` runs once after app 'ready' (safeStorage is unusable before) and re-encrypts every
 * 'p:' / legacy entry. A value that fails to decrypt (e.g. Windows profile moved to another user)
 * is kept on disk untouched rather than deleted, so nothing is lost silently.
 */
export interface Cipher {
  available(): boolean;
  encrypt(v: string): Buffer;
  decrypt(b: Buffer): string;
  backend(): string;
}

const osCipher: Cipher = {
  available() {
    if (!app.isReady()) return false;
    try {
      // Linux without a keyring: Chromium's 'basic_text' backend uses a hard-coded key. Treat it as
      // unavailable so the UI can say "not encrypted" honestly instead of pretending.
      if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
      return safeStorage.isEncryptionAvailable();
    } catch { return false; }
  },
  encrypt: (v) => safeStorage.encryptString(v),
  decrypt: (b) => safeStorage.decryptString(b),
  backend() {
    if (process.platform === 'win32') return 'dpapi';
    if (process.platform === 'darwin') return 'keychain';
    try { return safeStorage.getSelectedStorageBackend(); } catch { return 'unknown'; }
  },
};

let cipher: Cipher = osCipher;
let store: JsonStore<Record<string, string>> | null = null;
const st = () => (store ||= new JsonStore<Record<string, string>>('secrets', {}));

let warnedPlain = false;
function enc(v: string): string {
  if (cipher.available()) {
    try { return 'e:' + cipher.encrypt(v).toString('base64'); }
    catch (e) { logLine('warn', 'secrets: encrypt failed, storing obfuscated', e); }
  }
  if (!warnedPlain) { warnedPlain = true; logLine('warn', '[secrets] OS encryption unavailable: secrets are stored obfuscated (base64), not encrypted'); }
  return 'p:' + Buffer.from(v, 'utf8').toString('base64');
}
function dec(v: string): string {
  if (v.startsWith('e:')) return cipher.decrypt(Buffer.from(v.slice(2), 'base64'));
  if (v.startsWith('p:')) return Buffer.from(v.slice(2), 'base64').toString('utf8');
  return v;
}

export const secrets = {
  set(key: string, value: string | null) {
    st().update((d) => { if (value == null || value === '') delete d[key]; else d[key] = enc(value); });
  },
  get(key: string): string | null {
    const v = st().get()[key];
    if (!v) return null;
    try { return dec(v); } catch { return null; }
  },
  has(key: string) { return !!st().get()[key]; },
  /** every key with this prefix (used to drop all of a removed profile's secrets) */
  keys(prefix = ''): string[] { return Object.keys(st().get()).filter((k) => k.startsWith(prefix)); },
  /**
   * Re-encrypts base64-only ('p:') and legacy unprefixed values once OS encryption is available.
   * Returns how many entries were upgraded. Safe to call repeatedly.
   */
  migrate(): number {
    if (!cipher.available()) return 0;
    let n = 0;
    st().update((d) => {
      for (const [k, v] of Object.entries(d)) {
        if (typeof v !== 'string' || v.startsWith('e:')) continue;
        try {
          const plain = dec(v);
          const next = 'e:' + cipher.encrypt(plain).toString('base64');
          if (cipher.decrypt(Buffer.from(next.slice(2), 'base64')) !== plain) continue; // never swap in a value we can't read back
          d[k] = next; n++;
        } catch (e) { logLine('warn', `secrets: could not upgrade ${k.split(':')[0]}:…`, e); }
      }
    });
    if (n) { st().flush(); logLine('info', `secrets: upgraded ${n} value(s) to OS encryption (${cipher.backend()})`); }
    return n;
  },
  /** what the Settings page shows: are secrets really encrypted, and by what */
  status(): { encrypted: boolean; backend: string; plainCount: number } {
    const plainCount = Object.values(st().get()).filter((v) => typeof v === 'string' && !v.startsWith('e:')).length;
    return { encrypted: cipher.available(), backend: cipher.backend(), plainCount };
  },
  flush() { st().flush(); },
  /** tests only: swap the OS cipher and/or the backing store directory */
  __test(opts: { cipher?: Cipher | null; dir?: string }): () => void {
    const prev = { cipher, store };
    if (opts.cipher !== undefined) cipher = opts.cipher || osCipher;
    if (opts.dir) store = new JsonStore<Record<string, string>>('secrets', {}, opts.dir);
    return () => { cipher = prev.cipher; store = prev.store; };
  },
};
