import officialJson from './official-skills.json';
import { JsonStore, uid } from '../store';
import { profiles } from '../profiles';

export type Skill = { id: string; name: string; description: string; icon?: string; instructions: string; official?: boolean; createdAt?: number };

const stores = new Map<string, JsonStore<Skill[]>>();
function store(profileId: string) {
  let s = stores.get(profileId);
  if (!s) { s = new JsonStore<Skill[]>('skills', [], profiles.dataDir(profileId)); stores.set(profileId, s); }
  return s;
}

let officialCache: Skill[] | null = null;
function official(): Skill[] {
  if (officialCache) return officialCache;
  officialCache = ((officialJson as any[]) || []).map((s: Skill) => ({ ...s, official: true }));
  return officialCache!;
}

export const skills = {
  official,
  mine(profileId: string) { return store(profileId).get(); },
  all(profileId: string) { return [...this.mine(profileId), ...official()]; },
  get(profileId: string, id: string) { return this.all(profileId).find((s) => s.id === id) || null; },
  save(profileId: string, s: Partial<Skill>) {
    const id = s.id && !official().some((o) => o.id === s.id) ? s.id : uid('s_');
    const next: Skill = { id, name: s.name || 'Untitled skill', description: s.description || '', icon: s.icon || 'sparkles', instructions: s.instructions || '', createdAt: Date.now() };
    store(profileId).update((l) => { const i = l.findIndex((x) => x.id === id); if (i >= 0) l[i] = next; else l.unshift(next); });
    return next;
  },
  remove(profileId: string, id: string) { store(profileId).update((l) => l.filter((x) => x.id !== id)); },
  /** compact index for the system prompt; details loaded on demand via the use_skill tool */
  index(profileId: string): string {
    const all = this.all(profileId);
    if (!all.length) return '';
    return 'Skills you can load with use_skill(id) when relevant:\n' + all.map((s) => `- ${s.id}: ${s.name} — ${s.description}`).join('\n');
  },
};
