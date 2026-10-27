import { createStore, uid } from '@/lib/store';
import { loadJson, saveJson, secrets, removeKey } from '@/lib/storage';
import { PROVIDER_PRESETS } from '@/lib/providers';
import type { Bookmark, HistoryEntry, MemoryItem, ModelProvider, Profile, ProviderKind, Settings } from '@/lib/types';

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: 'google',
  theme: 'system',
  adblock: true,
  approvalMode: 'ask-risky',
  defaultModel: null,
  companionId: 'hoot',
  userName: '',
  desktopMode: false,
  barPosition: 'bottom',
  glassBlur: true,
};

const DEFAULT_PROFILE: Profile = { id: 'default', name: 'Personal', color: '#E8A317', isolated: false, createdAt: 0 };

export type AppState = {
  ready: boolean;
  profiles: Profile[];
  profileId: string;
  settings: Settings;
  providers: ModelProvider[];
  bookmarks: Bookmark[];
  history: HistoryEntry[];
  memory: MemoryItem[];
};

export const appStore = createStore<AppState>({
  ready: false,
  profiles: [DEFAULT_PROFILE],
  profileId: 'default',
  settings: DEFAULT_SETTINGS,
  providers: [],
  bookmarks: [],
  history: [],
  memory: [],
});

const pk = (key: string, profileId = appStore.get().profileId) => `p:${profileId}:${key}`;

const arr = <T,>(v: unknown, fallback: T[] = []): T[] => (Array.isArray(v) ? (v as T[]) : fallback);
const obj = <T extends object>(v: unknown, fallback: T): T => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback);

/** Stored data is validated on load: a corrupt value must never stop the app from starting. */
async function loadProfileData(profileId: string) {
  const [settings, bookmarks, history, memory] = await Promise.all([
    loadJson<Partial<Settings>>(pk('settings', profileId), {}),
    loadJson<Bookmark[]>(pk('bookmarks', profileId), []),
    loadJson<HistoryEntry[]>(pk('history', profileId), []),
    loadJson<MemoryItem[]>(pk('memory', profileId), []),
  ]);
  return {
    settings: { ...DEFAULT_SETTINGS, ...obj<Partial<Settings>>(settings, {}) },
    bookmarks: arr<Bookmark>(bookmarks),
    history: arr<HistoryEntry>(history).slice(0, 3000),
    memory: arr<MemoryItem>(memory),
  };
}

async function withKeyFlags(list: ModelProvider[]): Promise<ModelProvider[]> {
  return Promise.all(list.map(async (p) => ({ ...p, hasKey: !!(await secrets.get('provider:' + p.id)) })));
}

export const app = {
  async init() {
    try {
      const [rawProfiles, profileId, rawProviders] = await Promise.all([
        loadJson<Profile[]>('profiles', [DEFAULT_PROFILE]),
        loadJson<string>('profileId', 'default'),
        loadJson<ModelProvider[]>('providers', []),
      ]);
      const profiles = arr<Profile>(rawProfiles).filter((p) => p && typeof p.id === 'string');
      if (!profiles.length) profiles.push(DEFAULT_PROFILE);
      const pid = profiles.some((p) => p.id === profileId) ? profileId : profiles[0].id;
      const data = await loadProfileData(pid);
      const providers = arr<ModelProvider>(rawProviders).filter((p) => p && typeof p.id === 'string');
      // Keystore reads can hang on some devices right after install; never let them block startup.
      const withKeys = await Promise.race([
        withKeyFlags(providers),
        new Promise<ModelProvider[]>((r) => setTimeout(() => r(providers), 3000)),
      ]);
      appStore.set({ profiles, profileId: pid, providers: withKeys, ...data, ready: true });
    } catch {
      appStore.set({ ready: true }); // start with defaults rather than an endless spinner
    }
  },

  profile(): Profile {
    const s = appStore.get();
    return s.profiles.find((p) => p.id === s.profileId) || s.profiles[0];
  },

  async switchProfile(id: string) {
    const data = await loadProfileData(id);
    appStore.set({ profileId: id, ...data });
    saveJson('profileId', id, 0);
  },

  addProfile(name: string, color: string, isolated: boolean): Profile {
    const p: Profile = { id: uid('pr_'), name: name.trim() || 'Profile', color, isolated, createdAt: Date.now() };
    const profiles = [...appStore.get().profiles, p];
    appStore.set({ profiles });
    saveJson('profiles', profiles, 0);
    return p;
  },

  updateProfile(id: string, patch: Partial<Profile>) {
    const profiles = appStore.get().profiles.map((p) => (p.id === id ? { ...p, ...patch, id } : p));
    appStore.set({ profiles });
    saveJson('profiles', profiles, 0);
  },

  async removeProfile(id: string) {
    if (id === 'default') return;
    const profiles = appStore.get().profiles.filter((p) => p.id !== id);
    appStore.set({ profiles });
    saveJson('profiles', profiles, 0);
    await Promise.all(['settings', 'bookmarks', 'history', 'memory', 'tabs'].map((k) => removeKey(pk(k, id))));
    if (appStore.get().profileId === id) await this.switchProfile('default');
  },

  patchSettings(patch: Partial<Settings>) {
    const settings = { ...appStore.get().settings, ...patch };
    appStore.set({ settings });
    saveJson(pk('settings'), settings, 0);
  },

  // ---------- bookmarks ----------
  isBookmarked(url: string) {
    return appStore.get().bookmarks.some((b) => b.url === url);
  },
  toggleBookmark(url: string, title: string): boolean {
    const list = appStore.get().bookmarks;
    const exists = list.some((b) => b.url === url);
    const bookmarks = exists ? list.filter((b) => b.url !== url) : [{ id: uid('b_'), url, title: title || url, createdAt: Date.now() }, ...list];
    appStore.set({ bookmarks });
    saveJson(pk('bookmarks'), bookmarks, 0);
    return !exists;
  },
  removeBookmark(id: string) {
    const bookmarks = appStore.get().bookmarks.filter((b) => b.id !== id);
    appStore.set({ bookmarks });
    saveJson(pk('bookmarks'), bookmarks, 0);
  },

  // ---------- history (never written for private tabs) ----------
  addHistory(url: string, title: string) {
    if (!/^https?:/.test(url)) return;
    const list = appStore.get().history;
    const i = list.findIndex((h) => h.url === url);
    const now = Date.now();
    let history: HistoryEntry[];
    if (i >= 0) {
      const e = { ...list[i], title: title || list[i].title, visits: list[i].visits + 1, lastVisit: now };
      history = [e, ...list.slice(0, i), ...list.slice(i + 1)];
    } else {
      history = [{ url, title: title || url, visits: 1, lastVisit: now }, ...list].slice(0, 3000);
    }
    appStore.set({ history });
    saveJson(pk('history'), history, 1500);
  },
  updateHistoryTitle(url: string, title: string) {
    const list = appStore.get().history;
    const i = list.findIndex((h) => h.url === url);
    if (i < 0 || !title || list[i].title === title) return;
    const history = list.slice();
    history[i] = { ...history[i], title };
    appStore.set({ history });
    saveJson(pk('history'), history, 1500);
  },
  removeHistory(url: string) {
    const history = appStore.get().history.filter((h) => h.url !== url);
    appStore.set({ history });
    saveJson(pk('history'), history, 0);
  },
  clearHistory() {
    appStore.set({ history: [] });
    saveJson(pk('history'), [], 0);
  },

  // ---------- on-device memory ----------
  addMemory(text: string, kind: MemoryItem['kind'] = 'fact', source = 'user'): MemoryItem | null {
    const t = text.trim();
    if (!t) return null;
    const list = appStore.get().memory;
    if (list.some((m) => m.text.toLowerCase() === t.toLowerCase())) return null;
    const item: MemoryItem = { id: uid('m_'), kind, text: t.slice(0, 500), source, createdAt: Date.now() };
    const memory = [item, ...list].slice(0, 500);
    appStore.set({ memory });
    saveJson(pk('memory'), memory, 0);
    return item;
  },
  removeMemory(id: string) {
    const memory = appStore.get().memory.filter((m) => m.id !== id);
    appStore.set({ memory });
    saveJson(pk('memory'), memory, 0);
  },
  clearMemory() {
    appStore.set({ memory: [] });
    saveJson(pk('memory'), [], 0);
  },
  recall(query: string, limit = 8): MemoryItem[] {
    const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const scored = appStore.get().memory.map((m) => {
      const t = m.text.toLowerCase();
      return { m, s: words.reduce((a, w) => a + (t.includes(w) ? 1 : 0), 0) };
    });
    return scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.m);
  },

  // ---------- model providers (keys in SecureStore) ----------
  async upsertProvider(p: Partial<ModelProvider> & { kind: ProviderKind; apiKey?: string }): Promise<ModelProvider> {
    const preset = PROVIDER_PRESETS[p.kind];
    const list = appStore.get().providers;
    const id = p.id || uid(p.kind + '_');
    const existing = list.find((x) => x.id === id);
    const next: ModelProvider = {
      id,
      kind: p.kind,
      name: p.name || existing?.name || preset.name,
      baseUrl: (p.baseUrl || existing?.baseUrl || preset.baseUrl).trim().replace(/\/+$/, ''),
      models: p.models ?? existing?.models ?? preset.models,
      local: p.local ?? existing?.local ?? preset.local,
      enabled: p.enabled ?? existing?.enabled ?? true,
    };
    if (p.apiKey !== undefined) await secrets.set('provider:' + id, p.apiKey.trim());
    next.hasKey = !!(await secrets.get('provider:' + id));
    const providers = existing ? list.map((x) => (x.id === id ? next : x)) : [...list, next];
    appStore.set({ providers });
    saveJson('providers', providers.map(({ hasKey, ...rest }) => rest), 0);
    const s = appStore.get().settings;
    if (!s.defaultModel && next.models.length && (next.local || next.hasKey)) {
      this.patchSettings({ defaultModel: { providerId: id, model: next.models[0] } });
    }
    return next;
  },
  async removeProvider(id: string) {
    const providers = appStore.get().providers.filter((p) => p.id !== id);
    appStore.set({ providers });
    saveJson('providers', providers.map(({ hasKey, ...rest }) => rest), 0);
    await secrets.set('provider:' + id, null);
    if (appStore.get().settings.defaultModel?.providerId === id) this.patchSettings({ defaultModel: null });
  },
  providerKey(id: string) {
    return secrets.get('provider:' + id);
  },
};
