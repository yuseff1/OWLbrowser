import { session, Session, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { JsonStore, uid, disposeStoresUnder } from './store';
import { logLine } from './crash';
import type { Profile } from '../shared/types';

const COLORS = ['#5B8CFF', '#FF7A59', '#22C3A6', '#B57BFF', '#F5B83D', '#FF5C8A', '#3DB2FF'];

const store = new JsonStore<{ profiles: Profile[]; lastUsed: string }>('profiles', {
  profiles: [],
  lastUsed: 'default',
});

function ensureDefault() {
  const d = store.get();
  if (!d.profiles.length) {
    d.profiles.push({ id: 'default', name: 'Personal', color: COLORS[0], avatar: 'P', createdAt: Date.now() });
    store.set(d);
  }
}

export const profiles = {
  list(): Profile[] { ensureDefault(); return store.get().profiles; },
  get(id: string) { return this.list().find((p) => p.id === id) ?? this.list()[0]; },
  lastUsed() { ensureDefault(); const id = store.get().lastUsed; return this.list().some((p) => p.id === id) ? id : 'default'; },
  setLastUsed(id: string) { store.update((d) => { d.lastUsed = id; }); },
  create(name: string, color?: string): Profile {
    const p: Profile = {
      id: uid('p_'),
      name: name || 'New profile',
      color: color || COLORS[this.list().length % COLORS.length],
      avatar: (name || 'N').trim().charAt(0).toUpperCase(),
      createdAt: Date.now(),
    };
    store.update((d) => { d.profiles.push(p); });
    return p;
  },
  rename(id: string, name: string, color?: string) {
    store.update((d) => {
      const p = d.profiles.find((x) => x.id === id);
      if (p) { p.name = name; p.avatar = name.charAt(0).toUpperCase(); if (color) p.color = color; }
    });
  },
  /**
   * Removes the profile from the list and deletes everything it stored on disk: its JSON data folder
   * (history, bookmarks, memory, passwords metadata…), its Chromium partition (cookies, cache, local
   * storage) and its extensions. Call after its windows are closed. Whatever is still locked (Windows
   * keeps partition files open while the session lives) is queued and deleted on the next start, before
   * any session for it could be created again.
   */
  async remove(id: string): Promise<void> {
    if (id === 'default' || !/^[A-Za-z0-9_-]+$/.test(id)) return;
    store.update((d) => { d.profiles = d.profiles.filter((p) => p.id !== id); if (d.lastUsed === id) d.lastUsed = 'default'; });
    store.flush();
    disposeStoresUnder(profileDir(id));
    try { const ses = session.fromPartition(partitionFor(id)); await ses.clearStorageData(); await ses.clearCache(); } catch (e) { logLine('warn', 'profile remove: clear session', e); }
    const left = purgeDirs(id);
    if (left.length) { pending.update((d) => { if (!d.ids.includes(id)) d.ids.push(id); }); pending.flush(); }
  },
  /** startup: finish deleting profiles whose folders were locked when they were removed */
  purgePending(): void {
    const ids = pending.get().ids.filter((id) => id !== 'default' && !store.get().profiles.some((p) => p.id === id));
    const still = ids.filter((id) => purgeDirs(id).length > 0);
    if (still.length !== pending.get().ids.length) { pending.set({ ids: still }); pending.flush(); }
  },
  /** every folder a profile owns on disk (exported for tests) */
  dirsOf(id: string): string[] {
    const ud = app.getPath('userData');
    return [profileDir(id), path.join(ud, 'Partitions', `owl-${id}`), path.join(ud, 'extensions', id)];
  },
  /** directory for this profile's own JSON data (history, bookmarks, memory, ...) */
  dataDir(id: string) {
    const dir = profileDir(id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  },
};

const pending = new JsonStore<{ ids: string[] }>('profiles-pending-delete', { ids: [] });
function profileDir(id: string) { return path.join(app.getPath('userData'), 'profiles', id); }
/** deletes a removed profile's folders; returns the ones that could not be deleted yet */
function purgeDirs(id: string): string[] {
  const left: string[] = [];
  for (const dir of profiles.dirsOf(id)) {
    if (!fs.existsSync(dir)) continue;
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch (e) { logLine('warn', `profile remove: ${dir} still locked, will retry at next start`, e); }
    if (fs.existsSync(dir)) left.push(dir);
  }
  return left;
}

export function partitionFor(profileId: string, incognito = false) {
  return incognito ? `owl-incognito-${profileId}` : `persist:owl-${profileId}`;
}

export function sessionFor(profileId: string, incognito = false): Session {
  return session.fromPartition(partitionFor(profileId, incognito), { cache: !incognito });
}
