import { EventEmitter } from 'events';
import { chat, type LlmMessage, type LlmTool } from './llm';
import { BROWSER_TOOLS, runBrowserTool, type BrowserHost, type ToolCtx } from './browser-tools';
import { COMPUTER_TOOLS, runComputerTool, computer } from './computer';
import { mcp, mcpToolsAsFunctions, parseMcpToolName } from '../mcp';
import { memory, memoryTools, runMemoryTool } from './memory';
import { companions } from './companions';
import { skills } from './skills';
import { settings } from '../settings';
import { dataFor } from '../data';
import { uid } from '../store';
import { OVERLAY_SCRIPT, OVERLAY_REMOVE } from './page-scripts';
import type { AgentRun, AgentStep, Companion, Artifact } from '../../shared/types';

const MAX_STEPS = 60;

const fn = (name: string, description: string, properties: any = {}, required: string[] = []): LlmTool => ({
  type: 'function', function: { name, description, parameters: { type: 'object', properties, required } },
});

const CORE_TOOLS: LlmTool[] = [
  fn('finish', 'Call when the task is complete. Give the final answer for the user in markdown (concise, with links/sources where relevant).', { answer: { type: 'string' } }, ['answer']),
  fn('ask_user', 'Ask the user a question when you truly cannot continue without their input (a choice, missing info, a login/2FA code).', { question: { type: 'string' } }, ['question']),
  fn('request_approval', 'Ask the user for approval BEFORE a consequential action (sending a message/email, posting, buying, paying, deleting, submitting an application).', { action: { type: 'string' }, detail: { type: 'string' } }, ['action', 'detail']),
  fn('remember', 'Save a durable fact or preference about the user to long-term memory.', { text: { type: 'string' }, kind: { type: 'string', enum: ['fact', 'preference', 'person', 'project', 'habit'] } }, ['text']),
  fn('recall', 'Search long-term memory about the user.', { query: { type: 'string' } }, ['query']),
  fn('use_skill', 'Load the full instructions of a skill by id.', { id: { type: 'string' } }, ['id']),
  fn('create_artifact', 'Create a visual artifact (report, slide deck, dashboard, chart, table) as a single self-contained HTML document. Opens in a tab and is saved to the Library.', { title: { type: 'string' }, html: { type: 'string' } }, ['title', 'html']),
  fn('spawn_agent', 'Delegate an independent sub-task to another companion running in parallel (its own tabs). Returns its run id; use wait_agent to get the result.', { companion_id: { type: 'string' }, task: { type: 'string' } }, ['task']),
  fn('wait_agent', 'Wait for a spawned agent run to finish and return its result.', { run_id: { type: 'string' } }, ['run_id']),
];

type Pending = { resolve: (v: any) => void };

export interface RuntimeHooks {
  host: (profileId: string) => BrowserHost;
  openArtifact: (profileId: string, a: Artifact) => void;
  notify: (title: string, body: string) => void;
}

/**
 * The agent runtime. Many companions can run at once, each in its own tabs ("spin up bots").
 * Emits 'update' with the run after every step so the UI can stream progress.
 */
export class AgentRuntime extends EventEmitter {
  private runs = new Map<string, AgentRun & { profileId: string }>();
  private controllers = new Map<string, AbortController>();
  private pending = new Map<string, Pending>();
  private queue: string[] = [];
  private followUps = new Map<string, string[]>();
  private takeover = new Set<string>();

  constructor(private hooks: RuntimeHooks) { super(); }

  list(profileId: string): AgentRun[] {
    const live = [...this.runs.values()].filter((r) => r.profileId === profileId);
    const old = dataFor(profileId).runs.get().filter((r) => !this.runs.has(r.id));
    return [...live, ...old].sort((a, b) => b.startedAt - a.startedAt).slice(0, 200);
  }

  get(id: string) { return this.runs.get(id) || null; }

  start(profileId: string, companionId: string, task: string, opts: { background?: boolean; routineId?: string; tabId?: number | null; parentRunId?: string } = {}): AgentRun {
    const run: AgentRun & { profileId: string; startTab?: number | null } = {
      id: uid('run_'), companionId, task, status: 'queued', steps: [], tabIds: [], startedAt: Date.now(),
      routineId: opts.routineId, background: opts.background ?? true, tokens: 0, profileId, startTab: opts.tabId ?? null,
    };
    this.runs.set(run.id, run);
    this.queue.push(run.id);
    this.emitUpdate(run);
    this.pump();
    return run;
  }

  private active() { return [...this.runs.values()].filter((r) => ['running', 'waiting-approval', 'waiting-user'].includes(r.status)).length; }

  private pump() {
    const max = Math.max(1, settings.get().maxParallelAgents);
    while (this.queue.length && this.active() < max) {
      const id = this.queue.shift()!;
      const run = this.runs.get(id);
      if (!run || run.status !== 'queued') continue;
      this.execute(run).catch((e) => console.error('[agent] crashed', e));
    }
  }

  stop(id: string) {
    const r = this.runs.get(id);
    if (!r) return;
    this.controllers.get(id)?.abort();
    const p = this.pending.get(id); if (p) { p.resolve(null); this.pending.delete(id); }
    if (!['done', 'failed'].includes(r.status)) { r.status = 'stopped'; r.endedAt = Date.now(); }
    this.queue = this.queue.filter((q) => q !== id);
    this.finalize(r);
  }

  /** user typed while the agent works: queued as a follow-up instruction (Strawberry's "Queue a follow-up") */
  followUp(id: string, text: string) {
    const r = this.runs.get(id); if (!r) return;
    if (r.status === 'waiting-user' && this.pending.has(id)) { this.answer(id, text); return; }
    const l = this.followUps.get(id) || []; l.push(text); this.followUps.set(id, l);
    this.addStep(r, { kind: 'user', text });
  }

  answer(id: string, text: string) {
    const r = this.runs.get(id); const p = this.pending.get(id);
    if (!r || !p) return;
    this.addStep(r, { kind: 'user', text });
    r.pendingQuestion = undefined; r.status = 'running';
    this.pending.delete(id); p.resolve(text);
  }

  approve(id: string, ok: boolean) {
    const r = this.runs.get(id); const p = this.pending.get(id);
    if (!r || !p) return;
    this.addStep(r, { kind: 'approval', text: ok ? `Approved: ${r.pendingApproval?.action}` : `Denied: ${r.pendingApproval?.action}` });
    r.pendingApproval = undefined; r.status = 'running';
    this.pending.delete(id); p.resolve(ok);
  }

  /** user takes over the tab: the agent pauses until resume() */
  setTakeover(id: string, on: boolean) {
    const r = this.runs.get(id); if (!r) return;
    if (on) { this.takeover.add(id); r.status = 'paused'; } else { this.takeover.delete(id); r.status = 'running'; const p = this.pending.get(id + ':takeover'); if (p) { p.resolve(true); this.pending.delete(id + ':takeover'); } }
    this.emitUpdate(r);
  }

  private emitUpdate(r: AgentRun) { this.emit('update', r); }

  private addStep(r: AgentRun, s: Omit<AgentStep, 't'>) {
    r.steps.push({ t: Date.now(), ...s });
    if (r.steps.length > 400) r.steps.splice(1, r.steps.length - 400);
    this.emitUpdate(r);
  }

  private waitFor<T>(key: string): Promise<T> { return new Promise((resolve) => this.pending.set(key, { resolve })); }

  private async buildTools(c: Companion, profileId: string): Promise<LlmTool[]> {
    const tools = [...CORE_TOOLS];
    if (c.tools.includes('memory')) tools.push(...memoryTools);
    if (c.tools.includes('browser')) tools.push(...BROWSER_TOOLS);
    if (c.tools.includes('computer') && settings.get().computerUse && computer.available()) tools.push(...(COMPUTER_TOOLS as LlmTool[]));
    if (c.tools.includes('apps')) {
      try { tools.push(...(mcpToolsAsFunctions(await mcp.tools(profileId)) as LlmTool[])); } catch {}
    }
    return tools;
  }

  private async systemPrompt(c: Companion, profileId: string, task: string): Promise<string> {
    const mem = await memory.contextBlockAsync(profileId, task).catch(() => memory.contextBlock(profileId, task));
    const now = new Date();
    return [
      `You are ${c.name}, ${c.role} — an AI companion living inside OWL, an agentic web browser. ${c.tagline}`,
      c.instructions,
      `You work in real browser tabs inside the user's own signed-in sessions, so you can use any website as the user would. Today is ${now.toDateString()}, local time ${now.toLocaleTimeString()}.`,
      `How to work:
- Plan briefly, then act. Prefer fetch_url/web_search for quick public lookups; use tabs (open_tab, snapshot, click, type) for interactive sites, logins, forms and anything dynamic.
- After navigating or acting, call snapshot to see refs before clicking. Refs change after each snapshot.
- Open several tabs to work in parallel when researching many things; close tabs you no longer need.
- If a login is required and the user isn't signed in, ask_user to sign in in the tab (they can take over), then continue.
- Never guess emails, prices or facts — read them from pages and cite URLs.
- Before sending, posting, buying, deleting or submitting anything on the user's behalf, call request_approval (unless the user explicitly told you to do it without asking).
- Never type passwords or payment details you were not given; never reveal secrets.
- Save durable things you learn about the user with remember. Keep answers concise. End with finish(answer).`,
      mem,
      skills.index(profileId),
    ].filter(Boolean).join('\n\n');
  }

  private async execute(run: AgentRun & { profileId: string; startTab?: number | null }) {
    const profileId = run.profileId;
    const c = companions.get(profileId, run.companionId);
    const ctrl = new AbortController();
    this.controllers.set(run.id, ctrl);
    run.status = 'running';
    this.emitUpdate(run);
    const host = this.hooks.host(profileId);

    const ctx: ToolCtx = {
      host, runId: run.id, agentId: c.id, tabId: run.startTab ?? null, background: run.background, signal: ctrl.signal,
      setTab: (id) => {
        ctx.tabId = id;
        if (!run.tabIds.includes(id)) run.tabIds.push(id);
        const t = host.getTab(id);
        t?.wc.executeJavaScript(OVERLAY_SCRIPT(c.name, c.look.body)).catch(() => {});
        t?.wc.on('did-finish-load', () => { if (this.runs.get(run.id)?.status === 'running') t.wc.executeJavaScript(OVERLAY_SCRIPT(c.name, c.look.body)).catch(() => {}); });
        this.emitUpdate(run);
      },
      guard: (action, detail) => this.guard(run, action, detail),
    };
    if (ctx.tabId != null) ctx.setTab(ctx.tabId);

    let tools: LlmTool[] = [];
    try { tools = await this.buildTools(c, profileId); } catch {}
    const messages: LlmMessage[] = [
      { role: 'system', content: await this.systemPrompt(c, profileId, run.task) },
      { role: 'user', content: run.task },
    ];

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (ctrl.signal.aborted) return;
        if (this.takeover.has(run.id)) await this.waitFor(run.id + ':takeover');
        const fu = this.followUps.get(run.id);
        if (fu?.length) { messages.push({ role: 'user', content: 'Follow-up from the user: ' + fu.splice(0).join('\n') }); }

        const res = await chat({ model: c.model, messages: compact(messages), tools, signal: ctrl.signal, temperature: 0.2 });
        run.tokens += res.usage;
        if (res.content?.trim()) this.addStep(run, { kind: 'thought', text: res.content.trim().slice(0, 2000) });
        if (!res.toolCalls.length) {
          // model answered without tools → treat as final
          run.result = res.content || 'Done.';
          run.status = 'done';
          break;
        }
        messages.push({ role: 'assistant', content: res.content || null, tool_calls: res.toolCalls });
        let finished = false;
        for (const call of res.toolCalls) {
          let args: any = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
          const name = call.function.name;
          this.addStep(run, { kind: 'tool', tool: name, text: describe(name, args) });
          let out: { text: string; image?: string };
          try {
            out = await this.runTool(name, args, ctx, run, c, profileId);
          } catch (e: any) {
            out = { text: 'Error: ' + (e?.message || String(e)) };
          }
          if (name === 'finish') { run.result = args.answer || out.text; finished = true; }
          if (['open_tab', 'navigate', 'click', 'type', 'create_artifact', 'request_approval'].includes(name)) {
            try { memory.observe(profileId, { sessionId: 'run:' + run.id, type: name === 'navigate' || name === 'open_tab' ? 'visit' : 'action', title: describe(name, args), detail: out.text.slice(0, 300), url: ctx.tabId != null ? host.getTab(ctx.tabId)?.url : undefined }); } catch {}
          }
          const toolText = out.text.length > 14000 ? out.text.slice(0, 14000) + '\n…(truncated)' : out.text;
          messages.push({ role: 'tool', tool_call_id: call.id, content: toolText });
          if (out.image) {
            messages.push({ role: 'user', content: [{ type: 'text', text: `Image from ${name}:` }, { type: 'image_url', image_url: { url: out.image } }] });
            this.addStep(run, { kind: 'result', text: out.text.slice(0, 300), image: out.image });
          } else if (name !== 'finish') {
            this.addStep(run, { kind: 'result', text: toolText.slice(0, 600) });
          }
          if (finished) break;
        }
        if (finished) { run.status = 'done'; break; }
        if (step === MAX_STEPS - 1) { run.status = 'done'; run.result = run.result || 'I hit my step limit. Here is where I got to — ask me to continue.'; }
      }
    } catch (e: any) {
      if (ctrl.signal.aborted) return;
      run.status = 'failed';
      run.result = e?.message || String(e);
      this.addStep(run, { kind: 'error', text: run.result });
    } finally {
      if (!run.endedAt) run.endedAt = Date.now();
      if (run.status === 'done') {
        this.addStep(run, { kind: 'message', text: run.result || 'Done.' });
        if (run.background) this.hooks.notify(`${c.name} finished`, (run.result || '').slice(0, 140));
      }
      this.finalize(run);
    }
  }

  private finalize(run: AgentRun & { profileId: string }) {
    this.controllers.delete(run.id);
    const host = this.hooks.host(run.profileId);
    for (const id of run.tabIds) host.getTab(id)?.wc.executeJavaScript(OVERLAY_REMOVE).catch(() => {});
    const store = dataFor(run.profileId).runs;
    store.update((l) => {
      const slim = { ...run, steps: run.steps.map((s) => ({ ...s, image: undefined })) } as any;
      delete slim.profileId; delete slim.startTab;
      const i = l.findIndex((x) => x.id === run.id); if (i >= 0) l[i] = slim; else l.unshift(slim);
      if (l.length > 300) l.length = 300;
    });
    this.emitUpdate(run);
    // learn from the run in the background
    const transcript = `Task: ${run.task}\n` + run.steps.filter((s) => s.kind !== 'result').map((s) => `${s.kind}: ${s.text}`).join('\n');
    memory.distill(run.profileId, transcript, 'run:' + run.id).catch(() => {});
    setTimeout(() => { if (this.runs.get(run.id)?.endedAt) this.runs.delete(run.id); }, 10 * 60 * 1000);
    this.pump();
  }

  private async guard(run: AgentRun, action: string, detail: string): Promise<boolean> {
    const mode = settings.get().approvalMode;
    if (mode === 'autonomous') return true;
    run.pendingApproval = { id: uid('ap_'), action, detail };
    run.status = 'waiting-approval';
    this.addStep(run, { kind: 'approval', text: `Needs approval: ${action} — ${detail}` });
    const c = companions.get((run as any).profileId, run.companionId);
    this.hooks.notify(`${c.name} needs your OK`, action);
    const ok = await this.waitFor<boolean>(run.id);
    return !!ok;
  }

  private async runTool(name: string, args: any, ctx: ToolCtx, run: AgentRun & { profileId: string }, c: Companion, profileId: string): Promise<{ text: string; image?: string }> {
    switch (name) {
      case 'finish': return { text: 'ok' };
      case 'ask_user': {
        run.pendingQuestion = { id: uid('q_'), question: String(args.question) };
        run.status = 'waiting-user';
        this.addStep(run, { kind: 'message', text: String(args.question) });
        this.hooks.notify(`${c.name} has a question`, String(args.question).slice(0, 120));
        const a = await this.waitFor<string>(run.id);
        return { text: a == null ? 'The user did not answer. Continue as best you can or finish.' : `User answered: ${a}` };
      }
      case 'request_approval': {
        const ok = await this.guard(run, String(args.action), String(args.detail || ''));
        return { text: ok ? 'Approved. Go ahead.' : 'Denied. Do not do it.' };
      }
      case 'remember': { memory.add(profileId, String(args.text), args.kind || 'fact', 'agent:' + c.id); return { text: 'Saved to memory.' }; }
      case 'recall': {
        const items = memory.recall(profileId, String(args.query), 10);
        return { text: items.length ? items.map((m) => `- ${m.text}`).join('\n') : 'Nothing relevant in memory.' };
      }
      case 'use_skill': {
        const s = skills.get(profileId, String(args.id));
        return { text: s ? `# Skill: ${s.name}\n${s.instructions}` : 'Unknown skill id.' };
      }
      case 'create_artifact': {
        const a: Artifact = { id: uid('art_'), title: String(args.title || 'Artifact'), html: String(args.html || ''), createdAt: Date.now(), companionId: c.id };
        dataFor(profileId).artifacts.update((l) => { l.unshift(a); if (l.length > 500) l.length = 500; });
        this.hooks.openArtifact(profileId, a);
        return { text: `Artifact "${a.title}" created and opened (id ${a.id}).` };
      }
      case 'spawn_agent': {
        const sub = this.start(profileId, args.companion_id && companions.list(profileId).some((x) => x.id === args.companion_id) ? args.companion_id : c.id, String(args.task), { background: true, parentRunId: run.id });
        return { text: `Started run ${sub.id}.` };
      }
      case 'wait_agent': {
        const id = String(args.run_id);
        for (let i = 0; i < 600; i++) {
          const r = this.runs.get(id) || dataFor(profileId).runs.get().find((x) => x.id === id);
          if (!r) return { text: 'Unknown run.' };
          if (['done', 'failed', 'stopped'].includes(r.status)) return { text: `${r.status}: ${r.result || ''}` };
          if (ctx.signal.aborted) return { text: 'Stopped.' };
          await new Promise((res) => setTimeout(res, 1000));
        }
        return { text: 'Still running after 10 minutes.' };
      }
    }
    if (name.startsWith('memory_')) return { text: await Promise.resolve(runMemoryTool(profileId, name, args)) };
    if (name.startsWith('computer_')) {
      if (!settings.get().computerUse) return { text: 'Computer use is turned off in Settings.' };
      if (name === 'computer_open_app') {
        const ok = await this.guard(run, 'Open an app on your computer', String(args.command || args.app || ''));
        if (!ok) return { text: 'Denied.' };
        return runComputerTool(name, args, { allowRunApp: true });
      }
      return runComputerTool(name, args);
    }
    const m = parseMcpToolName(name);
    if (m) {
      const text = await mcp.call(profileId, m.serverId, m.toolName, args);
      return { text };
    }
    return runBrowserTool(name, args, ctx);
  }
}

function describe(name: string, a: any): string {
  switch (name) {
    case 'open_tab': case 'navigate': return `${name === 'open_tab' ? 'Opening' : 'Going to'} ${a.url}`;
    case 'click': return `Clicking [${a.ref}]`;
    case 'type': return `Typing "${String(a.text).slice(0, 60)}"`;
    case 'web_search': return `Searching “${a.query}”`;
    case 'fetch_url': return `Reading ${a.url}`;
    case 'snapshot': return 'Looking at the page';
    case 'read_page': return 'Reading the page';
    case 'scroll': return `Scrolling ${a.direction}`;
    case 'finish': return 'Wrapping up';
    case 'remember': return `Remembering: ${a.text}`;
    case 'create_artifact': return `Creating “${a.title}”`;
    case 'spawn_agent': return `Delegating: ${String(a.task).slice(0, 80)}`;
    default: return name.replace(/_/g, ' ');
  }
}

/** keep context small: drop old images and shorten old tool outputs */
function compact(msgs: LlmMessage[]): LlmMessage[] {
  const out = msgs.slice();
  let imgs = 0;
  for (let i = out.length - 1; i >= 0; i--) {
    const m: any = out[i];
    if (m.role === 'user' && Array.isArray(m.content)) {
      imgs++;
      if (imgs > 2) out[i] = { role: 'user', content: '(earlier screenshot omitted)' };
    }
    if (m.role === 'tool' && i < out.length - 12 && m.content.length > 1500) out[i] = { ...m, content: m.content.slice(0, 1500) + '\n…(older output shortened)' };
  }
  return out;
}
