import { owl, INCOGNITO, IS_POPUP } from './api';

/**
 * Companion panel chat threads. Main persists them per profile (owl.chats / saveChat / removeChat);
 * localStorage stays as an instant-start cache and is migrated to main once.
 */
export type ThreadMsg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  t: number;
  companionId: string;
  /** assistant message that is a live agent run */
  runId?: string;
  pending?: boolean;
  error?: boolean;
  withPage?: boolean;
};
export type Thread = { id: string; title: string; companionId: string; createdAt: number; updatedAt: number; messages: ThreadMsg[] };

const KEY = 'owl.threads';
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function load(): Thread[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

class Threads {
  list = $state<Thread[]>(load());
  currentId = $state<string | null>(null);
  private timer: any = null;

  private dirty = new Set<string>();

  constructor() {
    this.hydrate();
    owl.on((type, p) => {
      if (type !== 'chat-token' || !p?.threadId) return;
      const th = this.list.find((x) => x.id === p.threadId);
      const m = th ? [...th.messages].reverse().find((x) => x.role === 'assistant' && x.pending && !x.runId) : null;
      if (m) m.content += p.token;
    });
  }

  get current(): Thread | null { return this.list.find((t) => t.id === this.currentId) ?? null; }
  get recent(): Thread[] { return [...this.list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8); }

  /** load threads from main; push any local-only threads (one-time migration from localStorage) */
  private async hydrate() {
    if (INCOGNITO || IS_POPUP) return; // the popup layer document never owns chat data
    try {
      const remote = (await owl.chats()) as Thread[] | null;
      if (!Array.isArray(remote)) return;
      const byId = new Map(remote.map((t) => [t.id, t]));
      const localOnly = this.list.filter((t) => !byId.has(t.id) || (byId.get(t.id)!.updatedAt < t.updatedAt));
      for (const t of this.list) if (!byId.has(t.id) || byId.get(t.id)!.updatedAt < t.updatedAt) byId.set(t.id, t);
      this.list = [...byId.values()].sort((a, b) => a.updatedAt - b.updatedAt);
      if (localOnly.length) await owl.saveChat($state.snapshot(localOnly));
    } catch { /* main unavailable (plain vite dev): keep the local copy */ }
  }

  /** mark a thread changed; written to main + local cache shortly after */
  touch(id: string) { this.dirty.add(id); this.save(); }

  save() {
    if (this.current) this.dirty.add(this.current.id);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const snap = $state.snapshot(this.list) as Thread[];
      try { localStorage.setItem(KEY, JSON.stringify(snap.slice(-100))); } catch {}
      if (INCOGNITO || !this.dirty.size) return;
      const changed = snap.filter((t) => this.dirty.has(t.id));
      this.dirty.clear();
      owl.saveChat(changed).catch(() => {});
    }, 300);
  }

  start(companionId: string): Thread {
    const t: Thread = { id: uid(), title: 'New chat', companionId, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    this.list.push(t);
    this.currentId = t.id;
    return this.list[this.list.length - 1];
  }
  open(id: string) { this.currentId = id; }
  clear() { this.currentId = null; }
  remove(id: string) {
    this.list = this.list.filter((t) => t.id !== id);
    if (this.currentId === id) this.currentId = null;
    this.dirty.delete(id);
    if (!INCOGNITO) owl.removeChat(id).catch(() => {});
    this.save();
  }

  private ensure(companionId: string): Thread {
    return this.current ?? this.start(companionId);
  }

  /** open (or create) the thread that shows a given agent run */
  openRun(run: { id: string; companionId: string; task: string; startedAt: number }) {
    const existing = this.list.find((t) => t.messages.some((m) => m.runId === run.id));
    if (existing) { this.currentId = existing.id; return existing; }
    const t = this.start(run.companionId);
    t.title = run.task.slice(0, 64);
    t.createdAt = t.updatedAt = run.startedAt;
    t.messages.push(
      { id: uid(), role: 'user', content: run.task, t: run.startedAt, companionId: run.companionId },
      { id: uid(), role: 'assistant', content: '', t: run.startedAt, companionId: run.companionId, runId: run.id },
    );
    this.save();
    return t;
  }

  /** quick streaming Q&A */
  async ask(companionId: string, text: string, withPage: boolean) {
    const th = this.ensure(companionId);
    if (!th.messages.length) th.title = text.slice(0, 64);
    th.messages.push({ id: uid(), role: 'user', content: text, t: Date.now(), companionId, withPage });
    th.messages.push({ id: uid(), role: 'assistant', content: '', t: Date.now(), companionId, pending: true });
    const m = th.messages[th.messages.length - 1];
    th.updatedAt = Date.now();
    const history = th.messages.filter((x) => !x.runId && !x.error && x !== m).map((x) => ({ role: x.role, content: x.content }));
    try {
      const res = (await owl.chat(companionId, history, { threadId: th.id, withPage })) as { text?: string; error?: string } | null;
      if (res?.text) m.content = res.text;
      else if (!m.content) { m.content = res?.error || 'No reply. Check that a model is connected in Settings → Models.'; m.error = true; }
    } catch (e: any) {
      m.content = e?.message || 'Couldn’t reach the model.'; m.error = true;
    }
    m.pending = false;
    th.updatedAt = Date.now();
    this.touch(th.id);
  }

  /** agent mode: start a run on the current tab */
  async doIt(companionId: string, task: string) {
    const th = this.ensure(companionId);
    if (!th.messages.length) th.title = task.slice(0, 64);
    th.messages.push({ id: uid(), role: 'user', content: task, t: Date.now(), companionId });
    try {
      const run = (await owl.startRun(companionId, task, { useCurrentTab: true, background: false })) as { id: string } | null;
      if (run?.id) th.messages.push({ id: uid(), role: 'assistant', content: '', t: Date.now(), companionId, runId: run.id });
      else th.messages.push({ id: uid(), role: 'assistant', content: 'Couldn’t start the task. Check that a model is connected in Settings → Models.', t: Date.now(), companionId, error: true });
    } catch (e: any) {
      th.messages.push({ id: uid(), role: 'assistant', content: e?.message || 'Couldn’t start the task.', t: Date.now(), companionId, error: true });
    }
    th.updatedAt = Date.now();
    this.touch(th.id);
  }
}

export const threads = new Threads();
