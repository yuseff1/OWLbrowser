/**
 * Persisted companion chat threads (per profile), replacing the UI's localStorage copy.
 * Shape matches the renderer's `Thread` (lib/threads.svelte.ts). Capped and sanitised on save.
 */
import { JsonStore } from './store';
import { profiles } from './profiles';

export type ThreadMsg = {
  id: string; role: 'user' | 'assistant'; content: string; t: number; companionId: string;
  runId?: string; pending?: boolean; error?: boolean; withPage?: boolean;
};
export type Thread = { id: string; title: string; companionId: string; createdAt: number; updatedAt: number; messages: ThreadMsg[] };

const MAX_THREADS = 300;
const MAX_MSGS = 400;
const MAX_CONTENT = 200_000;
const stores = new Map<string, JsonStore<Thread[]>>();

function store(profileId: string): JsonStore<Thread[]> {
  let s = stores.get(profileId);
  if (!s) { s = new JsonStore<Thread[]>('threads', [], profiles.dataDir(profileId)); stores.set(profileId, s); }
  return s;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Date.now());

function clean(t: any): Thread | null {
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id) return null;
  const msgs = Array.isArray(t.messages) ? t.messages : [];
  return {
    id: str(t.id, 64),
    title: str(t.title, 200) || 'New chat',
    companionId: str(t.companionId, 64),
    createdAt: num(t.createdAt),
    updatedAt: num(t.updatedAt),
    messages: msgs.slice(-MAX_MSGS).filter((m: any) => m && (m.role === 'user' || m.role === 'assistant')).map((m: any) => ({
      id: str(m.id, 64), role: m.role, content: str(m.content, MAX_CONTENT), t: num(m.t), companionId: str(m.companionId, 64),
      ...(m.runId ? { runId: str(m.runId, 64) } : {}), ...(m.error ? { error: true } : {}), ...(m.withPage ? { withPage: true } : {}),
    })),
  };
}

export const threads = {
  list(profileId: string): Thread[] {
    return [...store(profileId).get()].sort((a, b) => b.updatedAt - a.updatedAt);
  },
  get(profileId: string, id: string): Thread | null {
    return store(profileId).get().find((t) => t.id === id) ?? null;
  },
  /** upsert one thread (or several, for the one-time localStorage migration) */
  save(profileId: string, input: unknown): number {
    const arr = (Array.isArray(input) ? input : [input]).map(clean).filter(Boolean) as Thread[];
    if (!arr.length) return 0;
    store(profileId).update((l) => {
      const byId = new Map(l.map((t) => [t.id, t]));
      for (const t of arr) {
        const prev = byId.get(t.id);
        if (!prev || t.updatedAt >= prev.updatedAt) byId.set(t.id, t);
      }
      return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_THREADS);
    });
    return arr.length;
  },
  remove(profileId: string, id: string) {
    store(profileId).update((l) => l.filter((t) => t.id !== id));
  },
  clear(profileId: string) { store(profileId).set([]); },
  flush() { for (const s of stores.values()) s.flush(); },
};
