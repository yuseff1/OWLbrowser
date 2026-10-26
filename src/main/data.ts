import { JsonStore, uid } from './store';
import { profiles } from './profiles';
import type { Bookmark, DownloadItem, HistoryEntry, MemoryItem, Routine, Artifact, Companion, AgentRun, ChatMessage } from '../shared/types';

type ProfileData = {
  history: JsonStore<HistoryEntry[]>;
  bookmarks: JsonStore<Bookmark[]>;
  downloads: JsonStore<DownloadItem[]>;
  memory: JsonStore<MemoryItem[]>;
  routines: JsonStore<Routine[]>;
  artifacts: JsonStore<Artifact[]>;
  companions: JsonStore<Companion[]>;
  runs: JsonStore<AgentRun[]>;
  chats: JsonStore<Record<string, ChatMessage[]>>;
  session: JsonStore<{ windows: { urls: string[]; active: number }[] }>;
  closedTabs: string[];
};

const cache = new Map<string, ProfileData>();

export function dataFor(profileId: string): ProfileData {
  let d = cache.get(profileId);
  if (d) return d;
  const dir = profiles.dataDir(profileId);
  d = {
    history: new JsonStore<HistoryEntry[]>('history', [], dir),
    bookmarks: new JsonStore<Bookmark[]>('bookmarks', [], dir),
    downloads: new JsonStore<DownloadItem[]>('downloads', [], dir),
    memory: new JsonStore<MemoryItem[]>('memory', [], dir),
    routines: new JsonStore<Routine[]>('routines', [], dir),
    artifacts: new JsonStore<Artifact[]>('artifacts', [], dir),
    companions: new JsonStore<Companion[]>('companions', [], dir),
    runs: new JsonStore<AgentRun[]>('runs', [], dir),
    chats: new JsonStore<Record<string, ChatMessage[]>>('chats', {}, dir),
    session: new JsonStore<{ windows: { urls: string[]; active: number }[] }>('session', { windows: [] }, dir),
    closedTabs: [],
  };
  cache.set(profileId, d);
  return d;
}

export function flushAll() {
  for (const d of cache.values()) {
    for (const k of Object.keys(d)) { const s: any = (d as any)[k]; if (s && typeof s.flush === 'function') s.flush(); }
  }
}

const MAX_HISTORY = 50000;

export const history = {
  add(profileId: string, url: string, title: string, favicon?: string) {
    if (!/^https?:/.test(url)) return;
    const h = dataFor(profileId).history;
    h.update((list) => {
      const i = list.findIndex((e) => e.url === url);
      if (i >= 0) {
        const e = list[i];
        e.visits++; e.lastVisit = Date.now(); if (title) e.title = title; if (favicon) e.favicon = favicon;
        list.splice(i, 1); list.unshift(e);
      } else {
        list.unshift({ url, title: title || url, visits: 1, lastVisit: Date.now(), favicon });
        if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
      }
    });
  },
  updateTitle(profileId: string, url: string, title: string, favicon?: string) {
    const h = dataFor(profileId).history;
    const e = h.get().find((x) => x.url === url);
    if (e) { if (title) e.title = title; if (favicon) e.favicon = favicon; h.set(h.get()); }
  },
  search(profileId: string, q: string, limit = 8): HistoryEntry[] {
    const list = dataFor(profileId).history.get();
    if (!q) return list.slice(0, limit);
    const ql = q.toLowerCase();
    const scored: { e: HistoryEntry; s: number }[] = [];
    for (const e of list) {
      const u = e.url.toLowerCase(); const t = (e.title || '').toLowerCase();
      let s = 0;
      const host = u.replace(/^https?:\/\/(www\.)?/, '');
      if (host.startsWith(ql)) s += 100;
      else if (u.includes(ql)) s += 40;
      if (t.includes(ql)) s += 30;
      if (!s) continue;
      s += Math.min(e.visits, 50) + Math.max(0, 30 - (Date.now() - e.lastVisit) / 86400000);
      scored.push({ e, s });
      if (scored.length > 2000) break;
    }
    return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.e);
  },
  list(profileId: string, offset = 0, limit = 200, q = '') {
    const list = dataFor(profileId).history.get();
    const f = q ? list.filter((e) => (e.url + ' ' + e.title).toLowerCase().includes(q.toLowerCase())) : list;
    return f.slice(offset, offset + limit);
  },
  remove(profileId: string, url: string) { dataFor(profileId).history.update((l) => l.filter((e) => e.url !== url)); },
  clear(profileId: string) { dataFor(profileId).history.set([]); },
  importMany(profileId: string, entries: HistoryEntry[]) {
    const h = dataFor(profileId).history;
    h.update((list) => {
      const seen = new Map(list.map((e) => [e.url, e] as const));
      for (const e of entries) {
        const x = seen.get(e.url);
        if (x) { x.visits = Math.max(x.visits, e.visits); x.lastVisit = Math.max(x.lastVisit, e.lastVisit); }
        else { seen.set(e.url, e); }
      }
      return [...seen.values()].sort((a, b) => b.lastVisit - a.lastVisit).slice(0, MAX_HISTORY);
    });
  },
};

export const bookmarks = {
  list(profileId: string) { return dataFor(profileId).bookmarks.get(); },
  has(profileId: string, url: string) { return this.list(profileId).some((b) => b.url === url); },
  toggle(profileId: string, url: string, title: string, favicon?: string) {
    const s = dataFor(profileId).bookmarks;
    if (this.has(profileId, url)) { s.update((l) => l.filter((b) => b.url !== url)); return false; }
    s.update((l) => { l.push({ id: uid('b_'), url, title: title || url, createdAt: Date.now(), favicon, folder: 'Bookmarks bar' }); });
    return true;
  },
  add(profileId: string, b: Omit<Bookmark, 'id' | 'createdAt'>) {
    dataFor(profileId).bookmarks.update((l) => { if (!l.some((x) => x.url === b.url && x.folder === b.folder)) l.push({ ...b, id: uid('b_'), createdAt: Date.now() }); });
  },
  remove(profileId: string, id: string) { dataFor(profileId).bookmarks.update((l) => l.filter((b) => b.id !== id)); },
  rename(profileId: string, id: string, title: string) {
    dataFor(profileId).bookmarks.update((l) => { const b = l.find((x) => x.id === id); if (b) b.title = title; });
  },
};
