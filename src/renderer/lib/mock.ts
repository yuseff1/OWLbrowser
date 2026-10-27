/**
 * Browser-preview mock of `window.owl`.
 * Installed ONLY when `window.owl` is missing (plain `vite` / `vite preview`, never inside Electron),
 * so the UI renders filled with realistic data for design review.
 * Query params: ?theme=dark|light  ?onboarding=1  ?layout=modern  ?panel=1  ?palette=1  ?page=settings
 */
import type { AgentRun, Companion, Settings, TabState, WindowState } from '$shared/types';

if (typeof window !== 'undefined' && !(window as any).owl) install();

function install() {
  const q = new URLSearchParams(location.search);
  const now = Date.now();
  const listeners = new Set<(t: string, p: any) => void>();
  const emit = (t: string, p: any) => listeners.forEach((l) => l(t, p));
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

  const look = (body: string, belly: string, accent: string, shape: any, ears: any, eyes: any, prop: any) => ({ body, belly, accent, shape, ears, eyes, prop });
  const companions: Companion[] = [
    { id: 'hoot', name: 'Hoot', role: 'Research Scout', tagline: 'Digs through the web and comes back with sourced answers.', instructions: '', look: look('#4C6FFF', '#DCE4FF', '#1B2A6B', 'round', 'tufts', 'glasses', 'none'), tools: [], official: true, hired: true, createdAt: 0 },
    { id: 'nova', name: 'Nova', role: 'Lead Hunter', tagline: 'Finds qualified leads and drafts outreach in your voice.', instructions: '', look: look('#FF9A3D', '#FFE7CF', '#7A3A00', 'wide', 'tufts', 'big', 'headset'), tools: [], official: true, hired: true, createdAt: 0 },
    { id: 'pip', name: 'Pip', role: 'Inbox & Calendar', tagline: 'Morning brief, triaged inbox, replies drafted, follow-ups kept.', instructions: '', look: look('#2FCB94', '#D8F7EA', '#0D5A3F', 'bean', 'none', 'sleepy', 'bowtie'), tools: [], official: true, hired: true, createdAt: 0 },
    { id: 'echo', name: 'Echo', role: 'Social & Marketing', tagline: 'Learns what works for you and writes posts for every channel.', instructions: '', look: look('#FF6F91', '#FFE0E8', '#7A1630', 'drop', 'leaf', 'wink', 'scarf'), tools: [], official: true, hired: false, createdAt: 0 },
    { id: 'atlas', name: 'Atlas', role: 'Data Analyst', tagline: 'Pulls data from any site into clean tables, charts and dashboards.', instructions: '', look: look('#8B5CF6', '#EDE4FF', '#3B1C7A', 'tall', 'horns', 'big', 'monocle'), tools: [], official: true, hired: false, createdAt: 0 },
    { id: 'byte', name: 'Byte', role: 'Dev & QA', tagline: 'Tests your web apps, files bugs and automates the boring stuff.', instructions: '', look: look('#14B8C4', '#D4F6F8', '#0A4D52', 'square', 'antenna', 'visor', 'cap'), tools: [], official: true, hired: false, createdAt: 0 },
  ];

  const tab = (id: number, url: string, title: string, extra: Partial<TabState> = {}): TabState => ({
    id, url, title, loading: false, canGoBack: true, canGoForward: false, pinned: false, muted: false, audible: false, sleeping: false, zoom: 1, ...extra,
  });
  const page = q.get('page') as TabState['internal'] | null;
  const win: WindowState = {
    windowId: 1, profileId: 'default', incognito: false,
    tabs: [
      tab(1, 'https://mail.google.com/mail/u/0/#inbox', 'Inbox (12) – hello@varsen.tech', { pinned: true }),
      tab(2, 'https://github.com/varsen/owl', 'varsen/owl: An agentic Chromium browser'),
      tab(3, 'https://www.skyscanner.es/transport/flights/vlc/lis/', 'Valencia → Lisbon · Skyscanner', { agentId: 'hoot', agentRunId: 'r1', loading: true }),
      tab(4, 'https://www.linkedin.com/search/results/people/', 'Founders in Valencia | LinkedIn', { agentId: 'nova', agentRunId: 'r2' }),
      tab(5, 'https://open.spotify.com/playlist/lofi', 'Lo-fi beats to build to', { audible: true, groupId: q.get('groups') === '0' ? undefined : 'gread' }),
      tab(6, 'https://news.ycombinator.com/', 'Hacker News', { sleeping: true, groupId: q.get('groups') === '0' ? undefined : 'gread' }),
      tab(7, page ? `owl://${page}` : 'owl://newtab', page ? page[0].toUpperCase() + page.slice(1) : 'New Tab', { internal: page || 'newtab', canGoBack: false }),
    ],
    activeTabId: q.get('internal') === '0' ? 2 : 7,
    splitTabId: null,
    groups: q.get('groups') === '0' ? [] : [{ id: 'gread', title: 'Reading', color: 'yellow', collapsed: q.get('collapsed') === '1' }],
  };
  if (q.get('active')) win.activeTabId = +q.get('active')!;
  if (q.get('split')) win.splitTabId = +q.get('split')!;

  const settings: Settings = {
    searchEngine: 'google', homeWallpaper: 'aurora', theme: (q.get('theme') as any) || 'light', adblock: true, memorySaver: true,
    sleepAfterMinutes: 20, maxAwakeTabs: 12, defaultModel: { providerId: 'openrouter', model: 'anthropic/claude-sonnet-4.5' }, visionModel: null,
    computerUse: false, approvalMode: 'ask-risky', maxParallelAgents: 4, showBookmarksBar: true, restoreSession: true, sendDoNotTrack: true,
  };

  const runs: AgentRun[] = [
    {
      id: 'r1', companionId: 'hoot', task: 'Find the cheapest direct flight Valencia → Lisbon on 14 Nov, back 17 Nov, carry-on only', status: 'running', background: false, tokens: 18420,
      tabIds: [3], startedAt: now - 1000 * 95,
      steps: [
        { t: now - 95000, kind: 'thought', text: 'Start with a metasearch to get the price range, then check the airlines directly.' },
        { t: now - 90000, kind: 'tool', tool: 'navigate', text: 'Opened skyscanner.es — VLC → LIS, 14–17 Nov' },
        { t: now - 70000, kind: 'tool', tool: 'click', text: 'Filter: Direct only' },
        { t: now - 52000, kind: 'tool', tool: 'extract', text: 'Read 9 results (TAP, Ryanair, Vueling)' },
        { t: now - 30000, kind: 'message', text: 'Cheapest so far: **Ryanair FR 7612**, 06:40 → 07:05, **€58** return without bags. TAP is €112 with a carry-on included.' },
        { t: now - 9000, kind: 'tool', tool: 'navigate', text: 'Checking ryanair.com for the carry-on price' },
      ],
    },
    {
      id: 'r2', companionId: 'nova', task: 'Find 20 seed-stage founders in Valencia building AI products and draft a short intro note for each', status: 'waiting-approval', background: true, tokens: 40210,
      tabIds: [4], startedAt: now - 1000 * 60 * 7,
      steps: [
        { t: now - 400000, kind: 'tool', tool: 'search', text: 'LinkedIn: "founder" AI Valencia' },
        { t: now - 300000, kind: 'result', text: 'Shortlisted 14 people with public profiles' },
        { t: now - 120000, kind: 'approval', text: 'Wants to send a connection request to Marta Ibáñez' },
      ],
      pendingApproval: { id: 'a1', action: 'Send LinkedIn connection request', detail: 'To Marta Ibáñez (Co-founder, Lumo AI) with the note: “Hi Marta — saw Lumo at Startup Valencia, would love to swap notes on agents.”' },
    },
    {
      id: 'r3', companionId: 'pip', task: 'Morning brief: unread mail, today’s meetings, anything due', status: 'done', background: true, tokens: 9120,
      tabIds: [], startedAt: now - 1000 * 60 * 60 * 3, endedAt: now - 1000 * 60 * 60 * 3 + 80000, result: '3 emails need a reply, 1 meeting at 16:00.', steps: [],
    },
  ];

  const history = [
    { url: 'https://github.com/varsen/owl/pulls', title: 'Pull requests · varsen/owl', visits: 14, lastVisit: now - 3600e3 },
    { url: 'https://bits-ui.com/docs/components/popover', title: 'Popover – Bits UI', visits: 6, lastVisit: now - 7200e3 },
    { url: 'https://www.electronjs.org/docs/latest/api/web-contents-view', title: 'WebContentsView | Electron', visits: 9, lastVisit: now - 9000e3 },
    { url: 'https://svelte.dev/docs/svelte/$state', title: '$state • Svelte Docs', visits: 11, lastVisit: now - 86400e3 },
  ];
  const bookmarks = [
    { id: 'b1', url: 'https://github.com', title: 'GitHub', createdAt: now },
    { id: 'b2', url: 'https://mail.google.com', title: 'Gmail', createdAt: now },
    { id: 'b3', url: 'https://linear.app', title: 'Linear', createdAt: now },
    { id: 'b4', url: 'https://vercel.com/dashboard', title: 'Vercel', createdAt: now },
    { id: 'b5', url: 'https://supabase.com/dashboard', title: 'Supabase', createdAt: now },
    { id: 'b6', url: 'https://www.figma.com', title: 'Figma', createdAt: now },
    { id: 'b7', url: 'https://news.ycombinator.com', title: 'Hacker News', createdAt: now },
  ];
  const providers = [
    { id: 'openrouter', kind: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', hasKey: true, models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5-mini', 'google/gemini-2.5-flash'], local: false, enabled: true },
    { id: 'ollama', kind: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', models: ['qwen3:8b', 'llama3.2-vision'], local: true, enabled: true },
  ];

  let nextId = 20;
  const push = () => emit('state', clone(win));
  const internalOf = (url: string) => (url.startsWith('owl://') ? (url.slice(6).split(/[#?]/)[0] as any) : undefined);

  const impl: Record<string, (...a: any[]) => any> = {
    getState: () => clone(win),
    setBounds: () => null,
    setOverlay: () => null,
    newTab: (url = 'owl://newtab', opts: any = {}) => {
      const internal = internalOf(url);
      const t = tab(nextId++, url, internal ? internal[0].toUpperCase() + internal.slice(1) : url, { internal, canGoBack: false });
      win.tabs.push(t);
      if (!opts.background) win.activeTabId = t.id;
      push();
      return t.id;
    },
    closeTab: (id: number) => {
      const i = win.tabs.findIndex((t) => t.id === id);
      if (i < 0) return;
      win.tabs.splice(i, 1);
      if (win.activeTabId === id) win.activeTabId = win.tabs[Math.min(i, win.tabs.length - 1)]?.id ?? null;
      if (win.splitTabId === id) win.splitTabId = null;
      push();
    },
    activateTab: (id: number) => { win.activeTabId = id; const t = win.tabs.find((x) => x.id === id); if (t) t.sleeping = false; push(); },
    moveTab: (id: number, index: number) => { const i = win.tabs.findIndex((t) => t.id === id); const [t] = win.tabs.splice(i, 1); win.tabs.splice(index, 0, t); push(); },
    navigate: (id: number, input: string) => {
      const t = win.tabs.find((x) => x.id === id); if (!t) return;
      const url = /^[\w-]+(\.[\w-]+)+/.test(input) && !input.includes(' ') ? 'https://' + input : input.startsWith('owl://') || /^https?:/.test(input) ? input : 'https://www.google.com/search?q=' + encodeURIComponent(input);
      t.url = url; t.internal = internalOf(url); t.title = t.internal ? t.internal : url.replace(/^https?:\/\/(www\.)?/, ''); push();
    },
    pinTab: (id: number) => { const t = win.tabs.find((x) => x.id === id); if (t) t.pinned = !t.pinned; push(); },
    muteTab: (id: number) => { const t = win.tabs.find((x) => x.id === id); if (t) t.muted = !t.muted; push(); },
    sleepTab: (id: number) => { const t = win.tabs.find((x) => x.id === id); if (t) t.sleeping = true; push(); },
    duplicateTab: (id: number) => { const t = win.tabs.find((x) => x.id === id); if (t) impl.newTab(t.url); },
    setSplit: (id: number | null) => { win.splitTabId = id; push(); },
    // tab groups (same rules as window.ts, minus edge cases)
    groupTabs: (ids: number[], groupId?: string, opts: any = {}) => {
      let g = win.groups.find((x) => x.id === groupId);
      if (!g) { const used = new Set(win.groups.map((x) => x.color)); g = { id: 'g' + nextId++, title: opts.title ?? '', color: opts.color || (['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'] as const).find((c) => !used.has(c)) || 'grey', collapsed: false }; win.groups.push(g); }
      const members = win.tabs.filter((t) => t.groupId === g!.id);
      const moving = win.tabs.filter((t) => ids.includes(t.id) && !t.pinned);
      const anchor = members[members.length - 1] ?? moving[0];
      for (const t of moving) if (t !== anchor) win.tabs.splice(win.tabs.indexOf(t), 1);
      let at = win.tabs.indexOf(anchor) + 1;
      for (const t of moving) { if (t !== anchor) win.tabs.splice(at++, 0, t); t.groupId = g.id; }
      g.collapsed = false; push(); return g.id;
    },
    ungroupTabs: (ids: number[]) => { for (const t of win.tabs) if (ids.includes(t.id)) t.groupId = undefined; win.groups = win.groups.filter((g) => win.tabs.some((t) => t.groupId === g.id)); push(); },
    updateGroup: (id: string, patch: any) => { const g = win.groups.find((x) => x.id === id); if (g) Object.assign(g, patch); push(); },
    closeGroup: (id: string) => { for (const t of win.tabs.filter((x) => x.groupId === id)) impl.closeTab(t.id); win.groups = win.groups.filter((g) => g.id !== id); push(); },
    suggest: (text: string) => {
      if (!text) return [];
      return [
        { type: 'search', title: text, url: 'https://www.google.com/search?q=' + encodeURIComponent(text) },
        { type: 'tab', title: 'varsen/owl: An agentic Chromium browser', url: 'https://github.com/varsen/owl' },
        { type: 'history', title: 'Popover – Bits UI', url: 'https://bits-ui.com/docs/components/popover' },
        { type: 'bookmark', title: 'GitHub', url: 'https://github.com' },
        { type: 'history', title: '$state • Svelte Docs', url: 'https://svelte.dev/docs/svelte/$state' },
      ];
    },
    settings: () => clone(settings),
    patchSettings: (p: Partial<Settings>) => { Object.assign(settings, p); emit('settings', clone(settings)); return clone(settings); },
    companions: () => clone(companions),
    runs: () => clone(runs),
    startRun: (companionId: string, task: string, opts: any = {}) => {
      const r: AgentRun = { id: 'r' + nextId++, companionId, task, status: 'running', background: !!opts.background, tokens: 0, tabIds: [win.activeTabId!], startedAt: Date.now(), steps: [{ t: Date.now(), kind: 'thought', text: 'Reading the page to plan the first step.' }] };
      runs.unshift(r); setTimeout(() => emit('run', clone(r)), 10);
      setTimeout(() => { r.steps.push({ t: Date.now(), kind: 'tool', tool: 'read_page', text: 'Read the current page (2,140 words)' }); emit('run', clone(r)); }, 1200);
      return clone(r);
    },
    stopRun: (id: string) => { const r = runs.find((x) => x.id === id); if (r) { r.status = 'stopped'; r.endedAt = Date.now(); emit('run', clone(r)); } },
    approveRun: (id: string, ok: boolean) => { const r = runs.find((x) => x.id === id); if (r) { r.pendingApproval = undefined; r.status = 'running'; r.steps.push({ t: Date.now(), kind: 'user', text: ok ? 'Approved' : 'Denied' }); emit('run', clone(r)); } },
    answerRun: (id: string, text: string) => { const r = runs.find((x) => x.id === id); if (r) { r.pendingQuestion = undefined; r.status = 'running'; r.steps.push({ t: Date.now(), kind: 'user', text }); emit('run', clone(r)); } },
    followUp: (id: string, text: string) => { const r = runs.find((x) => x.id === id); if (r) { r.steps.push({ t: Date.now(), kind: 'user', text }); emit('run', clone(r)); } },
    takeover: (id: string, on: boolean) => { const r = runs.find((x) => x.id === id); if (r) { r.status = on ? 'paused' : 'running'; emit('run', clone(r)); } },
    chat: async (_c: string, _m: any[], o: any) => {
      const text = 'This page is the **OWL** repo. Three things stand out:\n\n1. The shell is Svelte 5 with runes.\n2. Agents drive tabs through `WebContentsView`.\n3. Companions run in parallel, up to 4 at once.\n\n| Area | Status |\n|---|---|\n| Shell | In progress |\n| Agents | Working |';
      for (const tok of text.match(/.{1,6}/gs) || []) { await new Promise((r) => setTimeout(r, 18)); emit('chat-token', { threadId: o?.threadId, token: tok }); }
      return { text };
    },
    onboarding: () => ({ done: q.get('onboarding') !== '1', userName: 'Youssef', companionId: 'hoot' }),
    completeOnboarding: () => true,
    importSources: () => [
      { browser: 'chrome', profileDir: 'Default', profileName: 'Youssef', path: 'C:/Users/y/AppData/Local/Google/Chrome/User Data/Default' },
      { browser: 'edge', profileDir: 'Default', profileName: 'Personal', path: 'C:/Users/y/AppData/Local/Microsoft/Edge/User Data/Default' },
    ],
    importFrom: async () => { await new Promise((r) => setTimeout(r, 900)); return { bookmarks: 214, history: 5120, passwords: 38, extensions: 4, searchEngines: 2, errors: ['2 extensions come from the Chrome Web Store and will install on first launch.'] }; },
    providers: () => clone(providers),
    providerPresets: () => ({
      openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', local: false, models: [], keyUrl: 'https://openrouter.ai/keys' },
      openai: { name: 'OpenAI', baseUrl: '', local: false, models: [] }, anthropic: { name: 'Anthropic', baseUrl: '', local: false, models: [] },
      google: { name: 'Google Gemini', baseUrl: '', local: false, models: [] }, xai: { name: 'xAI Grok', baseUrl: '', local: false, models: [] },
      ollama: { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', local: true, models: [] }, lmstudio: { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', local: true, models: [] },
    }),
    upsertProvider: (p: any) => ({ id: p.kind, ...p, models: [], local: false, enabled: true, hasKey: !!p.apiKey }),
    discoverModels: () => ['anthropic/claude-sonnet-4.5', 'openai/gpt-5-mini', 'google/gemini-2.5-flash'],
    profiles: () => ({ profiles: [{ id: 'default', name: 'Youssef', color: '#4C6FFF', avatar: 'Y', createdAt: 0 }], current: 'default' }),
    bookmarks: () => clone(bookmarks),
    isBookmarked: (url: string) => url.includes('github.com/varsen'),
    toggleBookmark: () => true,
    history: () => clone(history),
    downloads: () => [
      { id: 'd1', url: '', filename: 'owl-brand-kit.zip', path: '', received: 31e6, total: 48e6, state: 'progressing', startedAt: now - 20000 },
      { id: 'd2', url: '', filename: 'Invoice-2026-10.pdf', path: '', received: 220e3, total: 220e3, state: 'completed', startedAt: now - 3600e3 },
    ],
    appInfo: () => ({ version: '0.1.0', electron: '45.0.0', chrome: '142.0', platform: 'win32', userData: '' }),
    memoryStats: () => ({ totalMB: 1840, tabs: [] }),
    skills: () => ({ mine: [], official: [] }),
    routines: () => [], apps: () => [], appCatalog: () => [], artifacts: () => [], memory: () => [], passwords: () => [], extensions: () => [],
  };

  const api = new Proxy(impl, {
    get: (_t, k: string) => {
      if (k === 'platform') return 'win32';
      if (k === 'on') return (cb: any) => { listeners.add(cb); return () => listeners.delete(cb); };
      const f = impl[k];
      return async (...a: any[]) => (f ? f(...a) : null);
    },
  });
  (window as any).owl = api;
  (window as any).__owlMock = { emit, win, runs, settings };
  if (q.get('layout')) localStorage.setItem('owl.layout', q.get('layout')!);
}

export {};
