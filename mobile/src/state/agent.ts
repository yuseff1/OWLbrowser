// The mobile agent runtime: one companion drives the current tab at a time.
// Same tool loop as desktop src/main/agents/runner.ts (finish / ask_user / request_approval / remember / recall
// + browser tools), streaming every step into agentStore for the live run view.
import { createStore, uid } from '@/lib/store';
import { chat, type LlmMessage, type LlmTool } from '@/lib/agent/llm';
import { BROWSER_TOOLS, runBrowserTool, type ToolCtx } from '@/lib/agent/tools';
import { CURSOR_SETUP_SCRIPT, CURSOR_REMOVE_SCRIPT } from '@/lib/agent/page-scripts';
import { companionById } from '@/lib/companions';
import { appStore, app } from './app';
import { browser, browserStore, webviews } from './browser';
import type { AgentRun, AgentStep } from '@/lib/types';

const MAX_STEPS = 40;

const fn = (name: string, description: string, properties: any = {}, required: string[] = []): LlmTool => ({
  type: 'function', function: { name, description, parameters: { type: 'object', properties, required } },
});

const CORE_TOOLS: LlmTool[] = [
  fn('finish', 'Call when the task is complete. Give the final answer for the user in markdown (concise, with links/sources where relevant).', { answer: { type: 'string' } }, ['answer']),
  fn('ask_user', 'Ask the user a question when you truly cannot continue without their input (a choice, missing info, a login/2FA code).', { question: { type: 'string' } }, ['question']),
  fn('request_approval', 'Ask the user for approval BEFORE a consequential action (sending a message/email, posting, buying, paying, deleting, submitting an application).', { action: { type: 'string' }, detail: { type: 'string' } }, ['action', 'detail']),
  fn('remember', 'Save a durable fact or preference about the user to on-device memory.', { text: { type: 'string' }, kind: { type: 'string', enum: ['fact', 'preference', 'person', 'project', 'habit'] } }, ['text']),
  fn('recall', 'Search on-device memory about the user.', { query: { type: 'string' } }, ['query']),
];

export type AgentState = { runs: AgentRun[]; activeRunId: string | null; viewRunId: string | null; sheetOpen: boolean };
export const agentStore = createStore<AgentState>({ runs: [], activeRunId: null, viewRunId: null, sheetOpen: false });

type Live = { ctrl: AbortController; resolve?: (v: any) => void; followUps: string[] };
const live = new Map<string, Live>();

function update(id: string, patch: Partial<AgentRun> | ((r: AgentRun) => Partial<AgentRun>)) {
  agentStore.set((s) => ({
    runs: s.runs.map((r) => (r.id === id ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)),
  }));
}

function addStep(id: string, step: Omit<AgentStep, 't'>) {
  update(id, (r) => ({ steps: [...r.steps, { t: Date.now(), ...step }].slice(-300) }));
}

function getRun(id: string) {
  return agentStore.get().runs.find((r) => r.id === id);
}

function describe(name: string, a: any): string {
  switch (name) {
    case 'navigate': return `Going to ${a.url}`;
    case 'click': return `Tapping [${a.ref}]`;
    case 'type': return `Typing “${String(a.text ?? '').slice(0, 60)}”`;
    case 'web_search': return `Searching “${a.query}”`;
    case 'fetch_url': return `Reading ${a.url}`;
    case 'snapshot': return 'Looking at the page';
    case 'read_page': return 'Reading the page';
    case 'scroll': return `Scrolling ${a.direction}`;
    case 'finish': return 'Wrapping up';
    case 'remember': return `Remembering: ${a.text}`;
    case 'recall': return `Recalling “${a.query}”`;
    case 'ask_user': return 'Asking you a question';
    case 'request_approval': return `Asking approval: ${a.action}`;
    default: return name.replace(/_/g, ' ');
  }
}

function systemPrompt(companionId: string, task: string): string {
  const c = companionById(companionId);
  const s = appStore.get();
  const mem = s.memory.slice(0, 40);
  const relevant = app.recall(task, 10);
  const memLines = [...new Map([...relevant, ...mem].map((m) => [m.id, m])).values()].slice(0, 40).map((m) => `- (${m.kind}) ${m.text}`);
  const now = new Date();
  return [
    `You are ${c.name}, ${c.role} — an AI companion living inside OWL, an agentic web browser, running on the user's phone. ${c.tagline}`,
    c.instructions,
    s.settings.userName ? `The user's name is ${s.settings.userName}.` : '',
    `You work in the user's real mobile browser tab, inside their own signed-in sessions. Today is ${now.toDateString()}, local time ${now.toLocaleTimeString()}.`,
    `How to work:
- Plan briefly, then act. Prefer web_search / fetch_url for quick public lookups; use the tab (navigate, snapshot, click, type) for interactive sites, logins, forms and anything dynamic.
- After navigating or acting, call snapshot to see refs before clicking. Refs change after each snapshot.
- Pages are mobile layouts: menus may be behind a hamburger button; scroll to find content.
- If a login is required and the user isn't signed in, ask_user to sign in (they can pause you and take over the tab), then continue.
- Never guess emails, prices or facts — read them from pages and cite URLs.
- Before sending, posting, buying, deleting or submitting anything on the user's behalf, call request_approval (unless the user explicitly told you to do it without asking).
- Never type passwords or payment details you were not given; never reveal secrets.
- Save durable things you learn about the user with remember. Keep answers concise and phone-friendly. End with finish(answer).`,
    memLines.length ? `What you remember about the user:\n${memLines.join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

/** keep context small on phones: shorten old tool outputs */
function compact(msgs: LlmMessage[]): LlmMessage[] {
  return msgs.map((m, i) =>
    m.role === 'tool' && i < msgs.length - 10 && m.content.length > 1200 ? { ...m, content: m.content.slice(0, 1200) + '\n…(older output shortened)' } : m,
  );
}

function waitForUser<T>(id: string): Promise<T | null> {
  return new Promise((resolve) => {
    const l = live.get(id);
    if (!l) return resolve(null);
    l.resolve = resolve;
  });
}

async function guard(id: string, action: string, detail: string): Promise<boolean> {
  const mode = appStore.get().settings.approvalMode;
  if (mode === 'autonomous') return true;
  update(id, { status: 'waiting-approval', pendingApproval: { action, detail } });
  addStep(id, { kind: 'approval', text: `Needs approval: ${action} — ${detail}` });
  agentStore.set({ sheetOpen: true });
  const ok = await waitForUser<boolean>(id);
  return !!ok;
}

async function setCursor(tabId: string, on: boolean, color: string) {
  try { await webviews.eval(tabId, on ? CURSOR_SETUP_SCRIPT(color) : CURSOR_REMOVE_SCRIPT, 3000); } catch {}
}

async function runTool(run: AgentRun, name: string, args: any, ctx: ToolCtx): Promise<string> {
  switch (name) {
    case 'finish': return 'ok';
    case 'ask_user': {
      update(run.id, { status: 'waiting-user', pendingQuestion: { question: String(args.question) } });
      addStep(run.id, { kind: 'message', text: String(args.question) });
      agentStore.set({ sheetOpen: true });
      const a = await waitForUser<string>(run.id);
      return a == null ? 'The user did not answer. Continue as best you can or finish.' : `User answered: ${a}`;
    }
    case 'request_approval': {
      const ok = await guard(run.id, String(args.action), String(args.detail || ''));
      return ok ? 'Approved. Go ahead.' : 'Denied. Do not do it.';
    }
    case 'remember': {
      const item = app.addMemory(String(args.text), args.kind || 'fact', 'agent:' + run.companionId);
      return item ? 'Saved to memory.' : 'Already remembered.';
    }
    case 'recall': {
      const items = app.recall(String(args.query), 10);
      return items.length ? items.map((m) => `- ${m.text}`).join('\n') : 'Nothing relevant in memory.';
    }
  }
  if (name === 'snapshot' || name === 'click' || name === 'type') {
    await setCursor(ctx.tabId, true, '#E8A317');
  }
  return runBrowserTool(name, args, ctx);
}

async function execute(id: string) {
  const run = getRun(id)!;
  const l = live.get(id)!;
  const c = companionById(run.companionId);
  const ctx: ToolCtx = { tabId: run.tabId, signal: l.ctrl.signal, guard: (a, d) => guard(id, a, d) };
  const tools = [...CORE_TOOLS, ...BROWSER_TOOLS];
  const tab = browserStore.get().tabs.find((t) => t.id === run.tabId);
  const where = tab?.url ? `\n\n(The user is currently on: ${tab.title || ''} ${tab.url})` : '';
  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt(run.companionId, run.task) },
    { role: 'user', content: run.task + where },
  ];
  let status: AgentRun['status'] = 'done';
  let result = '';
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (l.ctrl.signal.aborted) return;
      if (l.followUps.length) messages.push({ role: 'user', content: 'Follow-up from the user: ' + l.followUps.splice(0).join('\n') });
      const res = await chat({ messages: compact(messages), tools, signal: l.ctrl.signal, temperature: 0.2 });
      update(id, (r) => ({ tokens: r.tokens + res.usage }));
      if (res.content?.trim()) addStep(id, { kind: 'thought', text: res.content.trim().slice(0, 1500) });
      if (!res.toolCalls.length) { result = res.content || 'Done.'; break; }
      messages.push({ role: 'assistant', content: res.content || null, tool_calls: res.toolCalls });
      let finished = false;
      for (const call of res.toolCalls) {
        if (l.ctrl.signal.aborted) return;
        let args: any = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
        const name = call.function.name;
        addStep(id, { kind: 'tool', tool: name, text: describe(name, args) });
        let out: string;
        try { out = await runTool(getRun(id)!, name, args, ctx); }
        catch (e: any) { out = 'Error: ' + (e?.message || String(e)); }
        if (getRun(id)?.status !== 'running' && !l.ctrl.signal.aborted) update(id, { status: 'running', pendingApproval: undefined, pendingQuestion: undefined });
        if (name === 'finish') { result = String(args.answer || out); finished = true; }
        const text = out.length > 12000 ? out.slice(0, 12000) + '\n…(truncated)' : out;
        messages.push({ role: 'tool', tool_call_id: call.id, content: text });
        if (name !== 'finish') addStep(id, { kind: 'result', tool: name, text: text.slice(0, 500) });
        if (finished) break;
      }
      if (finished) break;
      if (step === MAX_STEPS - 1) result = 'I hit my step limit. Here is where I got to — ask me to continue.';
    }
  } catch (e: any) {
    if (l.ctrl.signal.aborted) return;
    status = 'failed';
    result = e?.message || String(e);
    addStep(id, { kind: 'error', text: result });
  } finally {
    if (!l.ctrl.signal.aborted) {
      if (status === 'done') addStep(id, { kind: 'message', text: result || 'Done.' });
      update(id, { status, result, endedAt: Date.now(), pendingApproval: undefined, pendingQuestion: undefined });
    }
    setCursor(run.tabId, false, '#E8A317');
    live.delete(id);
    agentStore.set((s) => ({ activeRunId: s.activeRunId === id ? null : s.activeRunId }));
  }
}

export const agent = {
  /** Start a companion on a task, driving the current tab (Home tab becomes the work tab). */
  start(task: string, companionId = appStore.get().settings.companionId): AgentRun | null {
    const t = task.trim();
    if (!t) return null;
    const current = agentStore.get().activeRunId;
    if (current) this.stop(current);
    const tab = browser.active();
    const run: AgentRun = {
      id: uid('run_'), companionId, task: t, tabId: tab.id, status: 'running', steps: [{ t: Date.now(), kind: 'user', text: t }],
      startedAt: Date.now(), tokens: 0,
    };
    live.set(run.id, { ctrl: new AbortController(), followUps: [] });
    agentStore.set((s) => ({ runs: [run, ...s.runs].slice(0, 30), activeRunId: run.id, viewRunId: run.id, sheetOpen: true }));
    execute(run.id);
    return run;
  },
  stop(id: string) {
    const l = live.get(id);
    if (l) { l.ctrl.abort(); l.resolve?.(null); }
    const r = getRun(id);
    if (r && !['done', 'failed', 'stopped'].includes(r.status)) {
      update(id, { status: 'stopped', endedAt: Date.now(), pendingApproval: undefined, pendingQuestion: undefined });
      addStep(id, { kind: 'error', text: 'Stopped.' });
    }
    agentStore.set((s) => ({ activeRunId: s.activeRunId === id ? null : s.activeRunId }));
  },
  approve(id: string, ok: boolean) {
    const r = getRun(id);
    const l = live.get(id);
    if (!r || !l?.resolve) return;
    addStep(id, { kind: 'approval', text: ok ? `Approved: ${r.pendingApproval?.action}` : `Denied: ${r.pendingApproval?.action}` });
    update(id, { status: 'running', pendingApproval: undefined });
    const res = l.resolve; l.resolve = undefined; res(ok);
  },
  answer(id: string, text: string) {
    const r = getRun(id);
    const l = live.get(id);
    if (!r || !l) return;
    addStep(id, { kind: 'user', text });
    if (l.resolve && r.status === 'waiting-user') {
      update(id, { status: 'running', pendingQuestion: undefined });
      const res = l.resolve; l.resolve = undefined; res(text);
    } else {
      l.followUps.push(text);
    }
  },
  openSheet(open: boolean) { agentStore.set({ sheetOpen: open }); },
  view(id: string) { agentStore.set({ viewRunId: id, sheetOpen: true }); },
  clearFinished() { agentStore.set((s) => ({ runs: s.runs.filter((r) => live.has(r.id)) })); },
};
