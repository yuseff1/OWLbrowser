import { JsonStore } from './store';
import { profiles } from './profiles';

/**
 * Per-site preferences of a profile (Chrome's "site settings"): zoom per host for now. Permissions stay
 * in the profile session store (`perms`, keyed "origin|permission") where the permission handlers read them.
 * Incognito windows read the profile's zoom levels but never write them (they keep their own in memory).
 */
type Prefs = { zoom: Record<string, number> };
const stores = new Map<string, JsonStore<Prefs>>();
const incognitoZoom = new Map<string, Map<string, number>>();

function store(profileId: string) {
  let s = stores.get(profileId);
  if (!s) { s = new JsonStore<Prefs>('site-prefs', { zoom: {} }, profiles.dataDir(profileId)); stores.set(profileId, s); }
  return s;
}

/** zoom is remembered per host ("www." ignored), like Chrome */
export function zoomKey(url: string): string | null {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:' ? (u.hostname.replace(/^www\./, '') || 'file') : null; } catch { return null; }
}

export const sitePrefs = {
  zoomFor(profileId: string, incognito: boolean, url: string): number {
    const k = zoomKey(url);
    if (!k) return 1;
    const inc = incognito ? incognitoZoom.get(profileId)?.get(k) : undefined;
    const z = inc ?? store(profileId).get().zoom[k];
    return typeof z === 'number' && Number.isFinite(z) && z > 0 ? z : 1;
  },
  setZoom(profileId: string, incognito: boolean, url: string, z: number) {
    const k = zoomKey(url);
    if (!k || !Number.isFinite(z)) return;
    if (incognito) {
      let m = incognitoZoom.get(profileId); if (!m) incognitoZoom.set(profileId, (m = new Map()));
      m.set(k, z);
      return;
    }
    store(profileId).update((d) => { if (Math.abs(z - 1) < 0.001) delete d.zoom[k]; else d.zoom[k] = z; });
  },
  zoomAll(profileId: string): Record<string, number> { return { ...store(profileId).get().zoom }; },
  clearZoom(profileId: string, host: string) { store(profileId).update((d) => { delete d.zoom[host.replace(/^www\./, '')]; }); },
  dropIncognito(profileId: string) { incognitoZoom.delete(profileId); },
  flush() { for (const s of stores.values()) s.flush(); },
};
