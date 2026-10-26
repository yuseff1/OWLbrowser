import { owl } from './api';

/** Companion panel chat threads, persisted locally (see docs/ui-requests.md: main-side thread storage). */
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

  constructor() {
    owl.on((type, p) => {
      if (type !== 'chat-token' || !p?.threadId) return;
      const th = this.list.find((x) => x.id === p.threadId);
      const m = th ? [...th.messages].reverse().find((x) => x.role === 'assistant' && x.pending && !x.runId) : null;
      if (m) m.content += p.token;
    });
  }

  get current(): Thread | null { return this.list.find((t) => t.id === this.currentId) ?? null; }
  get recent(): Thread[] { return [...this.list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8); }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify($state.snapshot(this.list).slice(-100))); } catch {}
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
  remove(id: string) { this.list = this.list.filter((t) => t.id !== id); if (this.currentId === id) this.currentId = null; this.save(); }

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
    this.save();
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
    this.save();
  }
}

export const threads = new Threads();
