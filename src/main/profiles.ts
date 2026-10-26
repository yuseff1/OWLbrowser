import { session, Session, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { JsonStore, uid } from './store';
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
  remove(id: string) {
    if (id === 'default') return;
    store.update((d) => { d.profiles = d.profiles.filter((p) => p.id !== id); });
    try { session.fromPartition(partitionFor(id)).clearStorageData(); } catch {}
  },
  /** directory for this profile's own JSON data (history, bookmarks, memory, ...) */
  dataDir(id: string) {
    const dir = path.join(app.getPath('userData'), 'profiles', id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  },
};

export function partitionFor(profileId: string, incognito = false) {
  return incognito ? `owl-incognito-${profileId}` : `persist:owl-${profileId}`;
}

export function sessionFor(profileId: string, incognito = false): Session {
  return session.fromPartition(partitionFor(profileId, incognito), { cache: !incognito });
}
