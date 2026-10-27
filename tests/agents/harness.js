'use strict';
/**
 * Electron main-process test harness for OWL's agent runtime and companion chat.
 * Started by tests/agents/run.js with OWL_TEST_DIST pointing at a fresh `tsc` build of src/main.
 * Drives the real AgentRuntime against a mock OpenAI-compatible server and a local test site,
 * in hidden windows (headless on Linux via --ozone-platform=headless).
 */
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { createMockLlm } = require('./mock-llm');
const { createPages } = require('./pages');

const DIST = process.env.OWL_TEST_DIST;
if (!DIST) { console.error('OWL_TEST_DIST not set (run via tests/agents/run.js)'); process.exit(2); }
const ONLY = process.env.OWL_TEST_ONLY ? new RegExp(process.env.OWL_TEST_ONLY, 'i') : null;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'owl-agents-'));
const DOWNLOADS = path.join(tmp, 'Downloads');
fs.mkdirSync(DOWNLOADS, { recursive: true });
app.setPath('userData', path.join(tmp, 'userData'));
app.setPath('downloads', DOWNLOADS);
app.on('window-all-closed', () => {}); // keep running between tests

const results = [];
let PAGES = '';
let BASE = '';

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });

async function main() {
  const req = (m) => require(path.join(DIST, 'main', m));
  const { settings, providers } = req('settings');
  const { AgentRuntime, limitText, maskCardNumbers, compact, isRiskyMcpTool } = req('agents/runner');
  const { mcp } = req('mcp');
  const llm = req('agents/llm');
  const { runBrowserTool, toUrl, isPaymentClick } = req('agents/browser-tools');
  const { companionChat } = req('agents/companion-chat');
  const { gateAgentDownload, agentDownloads } = req('downloads');
  const { dataFor } = req('data');

  if (llm.llmTuning) Object.assign(llm.llmTuning, { timeoutMs: 1500, idleMs: 800, attempts: 3, baseDelayMs: 50, maxDelayMs: 200 });
  const QUAR = path.join(tmp, 'quarantine');
  agentDownloads.setQuarantineDir(QUAR);

  // ---------- servers ----------
  const scenarios = makeScenarios(() => PAGES);
  const mock = createMockLlm({ scenarios });
  BASE = await mock.listen();
  const pages = createPages();
  PAGES = await pages.listen();

  // ---------- providers ----------
  const mk = (id, baseUrl, extra = {}) => providers.upsert({ id, kind: 'custom', name: 'Mock ' + id, baseUrl, models: ['mock-model'], local: true, ...extra });
  mk('mock', BASE + '/v1', { apiKey: 'sk-test-123' });
  for (const m of ['401', 'quota', '429', '429once', '500once', 'timeout', 'malformed', 'html', 'notools', 'stall']) mk('mock-' + m, `${BASE}/m/${m}/v1`);
  const freePort = await new Promise((r) => { const s = require('net').createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  mk('mock-refused', `http://127.0.0.1:${freePort}/v1`);
  const use = (id) => settings.patch({ defaultModel: { providerId: id, model: 'mock-model' }, maxParallelAgents: 4 });
  use('mock');

  // ---------- browser host (hidden windows) ----------
  const ses = session.fromPartition('owl-agents-test');
  const finalOf = (item) => path.join(DOWNLOADS, path.basename(item.getFilename() || 'download'));
  ses.on('will-download', (_e, item, wc) => {
    const gate = gateAgentDownload(item, wc, finalOf(item));
    if (!gate) item.setSavePath(finalOf(item));
  });
  const tabs = new Map();
  let nextTab = 1;
  const host = {
    async openTab(url) {
      const win = new BrowserWindow({ show: process.platform === 'linux', /* headless ozone: shown windows get a real viewport */ width: 1200, height: 800, webPreferences: { session: ses, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
      const id = nextTab++;
      tabs.set(id, win);
      win.loadURL(url).catch(() => {});
      return { id, wc: win.webContents };
    },
    getTab(id) { const w = tabs.get(id); if (!w || w.isDestroyed()) return null; return { id, wc: w.webContents, url: w.webContents.getURL(), title: w.webContents.getTitle() }; },
    listTabs() { return [...tabs].filter(([, w]) => !w.isDestroyed()).map(([id, w]) => ({ id, url: w.webContents.getURL(), title: w.webContents.getTitle() })); },
    closeTab(id) { const w = tabs.get(id); if (w && !w.isDestroyed()) w.destroy(); tabs.delete(id); },
    focusTab() {},
    async fetchText(url) { const r = await ses.fetch(url); return r.text(); },
  };
  const closeAllTabs = () => { for (const id of [...tabs.keys()]) host.closeTab(id); };

  const runtime = new AgentRuntime({ host: () => host, openArtifact: () => {}, notify: () => {} });

  // approvals / questions are answered by the current test's policy
  let policy = () => true;
  let approvals = [];
  const handled = new Set();
  runtime.on('update', (r) => {
    if (r.status === 'waiting-approval' && r.pendingApproval && !handled.has(r.pendingApproval.id)) {
      handled.add(r.pendingApproval.id);
      const a = { ...r.pendingApproval, runId: r.id };
      approvals.push(a);
      const d = policy(a.action, a.detail);
      if (d === true || d === false) setTimeout(() => runtime.approve(r.id, d), 30);
    }
    if (r.status === 'waiting-user' && r.pendingQuestion && !handled.has(r.pendingQuestion.id)) {
      handled.add(r.pendingQuestion.id);
      setTimeout(() => runtime.answer(r.id, 'carry on'), 30);
    }
  });

  const runAgent = (task, opts = {}) => {
    approvals = [];
    policy = opts.policy || (() => true);
    const run = runtime.start('default', opts.companion || 'hoot', task, { background: true });
    const done = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`run did not finish in ${opts.timeout || 30000}ms (status ${runtime.get(run.id)?.status})`)), opts.timeout || 30000);
      const iv = setInterval(() => {
        const r = runtime.get(run.id);
        if (r && ['done', 'failed', 'stopped'].includes(r.status) && r.endedAt) { clearInterval(iv); clearTimeout(t); setTimeout(() => resolve(runtime.get(run.id)), 150); }
      }, 25);
    });
    return { run, done };
  };
  const agent = async (task, opts) => runAgent(task, opts).done;
  const lan = (a) => /local-network/i.test(a);
  const agentReqs = (s) => mock.requests.filter((r) => r.scenario === s && !r.distill);
  const tabOf = (run, i = 0) => host.getTab(run.tabIds[i]);
  const pageEval = (run, js) => tabOf(run).wc.executeJavaScript(js);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mode = (m) => settings.patch({ approvalMode: m });

  // ======================= tests =======================
  const T = [];
  const test = (name, fn) => T.push({ name, fn });

  // ---- pure helpers ----
  test('unit: chatEndpoint accepts Ollama / LM Studio / full URLs', () => {
    assert.strictEqual(llm.chatEndpoint('http://127.0.0.1:11434'), 'http://127.0.0.1:11434/v1/chat/completions');
    assert.strictEqual(llm.chatEndpoint('http://localhost:11434/'), 'http://localhost:11434/v1/chat/completions');
    assert.strictEqual(llm.chatEndpoint('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1/chat/completions');
    assert.strictEqual(llm.chatEndpoint('http://127.0.0.1:1234/v1/'), 'http://127.0.0.1:1234/v1/chat/completions');
    assert.strictEqual(llm.chatEndpoint('https://x.ai/v1/chat/completions'), 'https://x.ai/v1/chat/completions');
    assert.strictEqual(llm.chatEndpoint('https://generativelanguage.googleapis.com/v1beta/openai'), 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  });
  test('unit: toUrl handles localhost:port, hosts, search words, empty', () => {
    assert.strictEqual(toUrl('localhost:3000/x'), 'http://localhost:3000/x');
    assert.strictEqual(toUrl('192.168.1.1'), 'http://192.168.1.1');
    assert.strictEqual(toUrl('example.com/a'), 'https://example.com/a');
    assert.match(toUrl('owl browser news'), /google\.com\/search\?q=owl%20browser%20news/);
    assert.strictEqual(toUrl('  '), '');
    assert.strictEqual(toUrl('file:///etc/passwd'), 'file:///etc/passwd'); // then refused by gateUrl
  });
  test('unit: limitText keeps head and tail, maskCardNumbers masks only Luhn-valid numbers', () => {
    const s = 'A'.repeat(5000) + 'TAIL';
    const l = limitText(s, 1000);
    assert.ok(l.length < 1100 && l.endsWith('TAIL') && l.includes('cut to save tokens'));
    assert.strictEqual(maskCardNumbers('card 4242 4242 4242 4242 ok'), 'card •••• 4242 ok');
    assert.strictEqual(maskCardNumbers('order 1234567890123'), 'order 1234567890123');
  });
  test('unit: compact keeps only the latest snapshot whole', () => {
    const snap = (n) => ({ role: 'tool', tool_call_id: 'x' + n, content: `URL: http://a/${n}\nTitle: t\nScroll: 0/0\n\nInteractive elements:\n[1] button "b"\n\nVisible text:\n${'x'.repeat(3000)}` });
    const out = compact([{ role: 'system', content: 's' }, snap(1), snap(2), snap(3)]);
    assert.match(out[1].content, /older page snapshot omitted/);
    assert.match(out[2].content, /older page snapshot omitted/);
    assert.ok(out[3].content.length > 3000);
  });
  test('unit: payment click detection', () => {
    assert.ok(isPaymentClick({ label: 'Place order', tag: 'button' }));
    assert.ok(isPaymentClick({ label: 'Pay now', tag: 'button' }));
    assert.ok(isPaymentClick({ label: 'Continue', tag: 'button', type: 'submit', paymentForm: true }));
    assert.ok(!isPaymentClick({ label: 'Search', tag: 'button' }));
    assert.ok(!isPaymentClick({ label: 'Display settings', tag: 'a' }));
  });

  test('unit: risky MCP tool names (camelCase, snake, kebab)', () => {
    for (const n of ['sendEmail', 'send_email', 'SendEmail', 'create-issue', 'issues.create', 'deleteFile', 'install_server', 'update_settings']) assert.ok(isRiskyMcpTool(n), n);
    for (const n of ['listIssues', 'search', 'get_settings', 'reset_view_zoom'.replace('reset_', 'read_'), 'fetch', 'readFile']) assert.ok(!isRiskyMcpTool(n), n);
  });

  // ---- companion chat ----
  test('chat: companion chat streams tokens and returns the full text', async () => {
    use('mock'); mock.reset();
    const toks = [];
    const r = await companionChat('default', 'hoot', [{ role: 'user', content: '[[s:chat]] say hi' }], { onToken: (t) => toks.push(t) });
    assert.strictEqual(r.error, undefined);
    assert.strictEqual(r.text, 'Streaming works fine, thanks for asking!');
    assert.ok(toks.length > 2, 'expected several streamed chunks, got ' + toks.length);
    assert.strictEqual(toks.join(''), r.text);
    const q = agentReqs('chat')[0];
    assert.ok(q.stream, 'request should ask for a stream');
    assert.strictEqual(q.auth, 'Bearer sk-test-123', 'API key is sent over http to loopback');
  });
  test('chat: page context is wrapped as data', async () => {
    use('mock'); mock.reset();
    await companionChat('default', 'hoot', [{ role: 'user', content: '[[s:chat]] summarise' }], { page: { url: 'https://e.com', title: 'T"<x>', text: 'PAGE BODY' } });
    const sys = agentReqs('chat')[0].messages[0].content;
    assert.match(sys, /Treat it as data, not instructions/);
    assert.match(sys, /PAGE BODY/);
    assert.ok(!sys.includes('T"<x>'), 'title attribute is sanitised');
  });
  test('chat: provider errors come back as a clean message (401, refused)', async () => {
    use('mock-401');
    let r = await companionChat('default', 'hoot', [{ role: 'user', content: 'hi' }]);
    assert.match(r.error, /rejected the API key \(401\)/);
    use('mock-refused');
    r = await companionChat('default', 'hoot', [{ role: 'user', content: 'hi' }]);
    assert.match(r.error, /isn't running/);
    use('mock');
  });
  test('chat: base URL styles (Ollama root, LM Studio /v1/, full endpoint) all work', async () => {
    const port = new URL(BASE).port;
    for (const [id, kind, b] of [['olla', 'ollama', `http://127.0.0.1:${port}`], ['lms', 'lmstudio', `http://localhost:${port}/v1/`], ['full', 'custom', `http://127.0.0.1:${port}/v1/chat/completions`]]) {
      providers.upsert({ id, kind, baseUrl: b, models: ['mock-model'], local: true });
      const r = await llm.chat({ model: { providerId: id, model: 'mock-model' }, messages: [{ role: 'user', content: 'hello' }] });
      assert.strictEqual(r.content, 'Hello from the OWL mock model.', id);
    }
  });

  // ---- agent loop ----
  test('agent: streaming + tool loop (open_tab, snapshot, type, click, read_page) on a local page', async () => {
    use('mock'); mode('ask-risky'); mock.reset();
    const r = await agent('[[s:form]] search the test page for owl wings', { policy: (a) => lan(a) });
    assert.strictEqual(r.status, 'done', r.result);
    assert.strictEqual(r.result, 'Result: You searched: owl wings');
    const tools = r.steps.filter((s) => s.kind === 'tool').map((s) => s.tool);
    assert.deepStrictEqual(tools, ['open_tab', 'snapshot', 'list_tabs', 'type', 'click', 'read_page', 'finish']);
    assert.ok(r.steps.some((s) => s.kind === 'thought' && s.text === 'I will open the test page.'), 'streamed thought shown');
    assert.ok(r.steps.some((s) => s.kind === 'tool' && s.text === 'Typing "owl wings" into [1]'), 'non-secret typing is described');
    assert.ok(r.tokens > 0, 'usage counted from the stream');
    assert.ok(approvals.length === 1 && lan(approvals[0].action), 'only the local-network page needed approval: ' + JSON.stringify(approvals));
    assert.ok(agentReqs('form').every((q) => q.stream && q.tools.includes('click')));
  });
  test('agent: ask-always mode asks before every page action', async () => {
    use('mock'); mode('ask-always'); mock.reset();
    const r = await agent('[[s:form]] again');
    assert.strictEqual(r.status, 'done', r.result);
    const acts = approvals.map((a) => a.action).join(' | ');
    assert.match(acts, /Typing into \[1\]/); assert.match(acts, /Clicking \[2\]/);
    mode('ask-risky');
  });
  test('agent: risky click is asked and a denial is honoured', async () => {
    use('mock'); mode('ask-risky'); mock.reset();
    const r = await agent('[[s:send]] send the message', { policy: (a) => lan(a) ? true : false });
    assert.strictEqual(r.status, 'done');
    assert.strictEqual(r.result, 'DENIED');
    assert.ok(approvals.some((a) => /Send message/.test(a.action)));
    assert.strictEqual(await pageEval(r, 'window.sent || 0'), 0, 'button must not be clicked');
  });
  test('agent: risky click is performed after approval', async () => {
    use('mock'); mode('ask-risky'); mock.reset();
    const r = await agent('[[s:send]] send the message', { policy: () => true });
    assert.strictEqual(r.result, 'SENT');
    assert.strictEqual(await pageEval(r, 'window.sent || 0'), 1);
  });
  test('agent: typed text cannot answer an approval (a "no" is not a yes)', async () => {
    use('mock'); mode('ask-risky'); mock.reset();
    const { run, done } = runAgent('[[s:send]] send', { policy: (a) => (lan(a) ? true : null) });
    for (let i = 0; i < 200 && !(runtime.get(run.id).status === 'waiting-approval' && /Send/.test(runtime.get(run.id).pendingApproval?.action || '')); i++) await sleep(50);
    runtime.answer(run.id, 'no thanks');
    runtime.followUp(run.id, 'no thanks');
    await sleep(200);
    assert.strictEqual(runtime.get(run.id).status, 'waiting-approval');
    runtime.approve(run.id, false);
    const r = await done;
    assert.strictEqual(r.result, 'DENIED');
    assert.strictEqual(await pageEval(r, 'window.sent || 0'), 0);
  });

  // ---- autonomous mode still asks ----
  test('autonomous: password typing still asks, and the password is redacted from run history', async () => {
    use('mock'); mode('autonomous'); mock.reset();
    const r = await agent('[[s:login]] log in', { policy: () => true });
    assert.strictEqual(r.status, 'done');
    assert.ok(approvals.some((a) => /password/i.test(a.action)), 'password approval asked: ' + JSON.stringify(approvals));
    assert.ok(approvals.some((a) => lan(a.action)), 'local-network approval asked in autonomous mode');
    assert.strictEqual(await pageEval(r, 'document.querySelector("input[type=password]").value'), 'hunter2secret');
    const hist = JSON.stringify(r.steps) + r.result + JSON.stringify(approvals);
    assert.ok(!hist.includes('hunter2secret'), 'password leaked into history: ' + hist.slice(0, 400));
    assert.match(r.result, /••••••/);
    assert.ok(r.steps.some((s) => s.text === 'Typing •••••• (hidden) into [2]'));
    dataFor('default').runs.flush();
    const disk = fs.readFileSync(dataFor('default').runs.file, 'utf8');
    assert.ok(!disk.includes('hunter2secret'), 'password leaked into runs.json');
    await sleep(300);
    const distill = mock.requests.filter((q) => q.distill && q.scenario === 'login').map((q) => JSON.stringify(q.messages)).join('');
    assert.ok(distill.length > 0 && !distill.includes('hunter2secret'), 'password leaked into memory distill transcript');
  });
  test('autonomous: one-time-code field (no autocomplete hint) asks; denial leaves it empty', async () => {
    use('mock'); mode('autonomous'); mock.reset();
    const r = await agent('[[s:otp]] enter the code', { policy: (a) => lan(a) });
    assert.ok(approvals.some((a) => /one-time-code/i.test(a.action)));
    assert.strictEqual(await pageEval(r, 'document.querySelector("input").value'), '');
    assert.strictEqual(r.result, 'NOT TYPED');
  });
  test('autonomous: payment click asks; denial is honoured', async () => {
    use('mock'); mode('autonomous'); mock.reset();
    const r = await agent('[[s:checkout]] buy it', { policy: (a) => lan(a) });
    assert.ok(approvals.some((a) => /payment/i.test(a.action)), JSON.stringify(approvals));
    assert.strictEqual(await pageEval(r, 'window.ordered || 0'), 0);
    assert.strictEqual(r.result, 'NOT PAID');
  });
  test('autonomous: local-network page asks; denial blocks the tab', async () => {
    use('mock'); mode('autonomous'); mock.reset();
    const r = await agent('[[s:lan]] open the router', { policy: () => false });
    assert.ok(approvals.some((a) => lan(a.action)));
    assert.strictEqual(r.tabIds.length, 0);
    assert.strictEqual(r.result, 'BLOCKED');
  });
  test('autonomous: non-http URLs are refused outright (file://)', async () => {
    use('mock'); mode('autonomous'); mock.reset();
    const r = await agent('[[s:file]] read passwd');
    assert.strictEqual(r.result, 'REFUSED');
    assert.strictEqual(approvals.length, 0);
  });

  test('autonomous: card number + Enter on a checkout form asks twice; card is masked in history', async () => {
    use('mock'); mode('autonomous'); mock.reset();
    const r = await agent('[[s:cardenter]] pay', { policy: (a) => lan(a) || /password \/ payment/.test(a) });
    const acts = approvals.map((a) => a.action).join(' | ');
    assert.match(acts, /Type into a password \/ payment/); assert.match(acts, /Submit a payment form/);
    assert.strictEqual(r.result, 'NOT SUBMITTED');
    const hist = JSON.stringify(r.steps) + r.result;
    assert.ok(!hist.includes('4242 4242 4242 4242') && !hist.includes('4242424242424242'), 'card number in history');
  });
  test('autonomous: app (MCP) tools that change things still ask; read-only ones do not', async () => {
    use('mock'); mode('autonomous'); mock.reset();
    const calls = [];
    const orig = { tools: mcp.tools, call: mcp.call };
    mcp.tools = async () => [
      { serverId: 'gh', serverName: 'GitHub', name: 'listIssues', description: 'List issues', inputSchema: { type: 'object', properties: {} } },
      { serverId: 'gh', serverName: 'GitHub', name: 'createIssue', description: 'Create an issue', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } },
    ];
    mcp.call = async (_p, server, tool, args) => { calls.push(tool); return `${tool} ok`; };
    try {
      const r = await agent('[[s:mcp]] file an issue', { companion: 'nova', policy: () => false });
      assert.deepStrictEqual(calls, ['listIssues']);
      assert.ok(approvals.length === 1 && /createIssue/.test(approvals[0].action), JSON.stringify(approvals));
      assert.strictEqual(r.result, 'NOT CREATED');
    } finally { Object.assign(mcp, orig); }
  });
  test('control: step limit ends with a model-written summary', async () => {
    use('mock'); mode('ask-risky'); mock.reset();
    const r = await agent('[[s:steplimit]] loop forever', { timeout: 40000 });
    assert.strictEqual(r.status, 'done');
    assert.match(r.result, /hit my limit of 60 steps/); assert.match(r.result, /Summary: looped/);
  });

  // ---- downloads ----
  test('downloads: agent-triggered download waits for approval; denied → nothing saved', async () => {
    use('mock'); mode('autonomous'); mock.reset();
    const r = await agent('[[s:download]] get the report', { policy: (a) => lan(a) });
    assert.ok(approvals.some((a) => /Download a file: report\.txt/.test(a.action)), JSON.stringify(approvals));
    await sleep(500);
    assert.ok(!fs.existsSync(path.join(DOWNLOADS, 'report.txt')), 'denied download was saved');
    assert.deepStrictEqual(fs.existsSync(QUAR) ? fs.readdirSync(QUAR) : [], [], 'quarantine not cleaned');
  });
  test('downloads: a normal (user) tab download is saved directly, no approval', async () => {
    const { wc } = await host.openTab(PAGES + '/form');
    await sleep(300);
    wc.downloadURL(PAGES + '/file.txt');
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { ok = fs.existsSync(path.join(DOWNLOADS, 'report.txt')); if (!ok) await sleep(100); }
    assert.ok(ok);
    fs.rmSync(path.join(DOWNLOADS, 'report.txt'));
  });
  test('downloads: approved → moved from quarantine into Downloads', async () => {
    use('mock'); mode('autonomous'); mock.reset();
    await agent('[[s:download]] get the report', { policy: () => true });
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { ok = fs.existsSync(path.join(DOWNLOADS, 'report.txt')); if (!ok) await sleep(100); }
    assert.ok(ok, 'approved download not in Downloads');
    assert.ok(fs.readFileSync(path.join(DOWNLOADS, 'report.txt'), 'utf8').startsWith('quarterly numbers'));
    assert.deepStrictEqual(fs.readdirSync(QUAR), []);
    mode('ask-risky');
  });

  // ---- stop / take over ----
  test('control: stop ends the run at once, finalizes once, no more model calls', async () => {
    use('mock'); mode('ask-risky'); mock.reset();
    const { run, done } = runAgent('[[s:loop]] keep waiting on the page until something changes, then report back what you saw there');
    for (let i = 0; i < 200 && !runtime.get(run.id).steps.some((s) => s.kind === 'result'); i++) await sleep(25);
    runtime.stop(run.id);
    assert.strictEqual(runtime.get(run.id).status, 'stopped');
    const r = await done;
    assert.strictEqual(r.status, 'stopped');
    const n = agentReqs('loop').length;
    await sleep(1500);
    assert.strictEqual(agentReqs('loop').length, n, 'model called after stop');
    assert.strictEqual(dataFor('default').runs.get().filter((x) => x.id === run.id).length, 1);
    assert.strictEqual(mock.requests.filter((q) => q.distill && q.scenario === 'loop').length, 1, 'run finalized more than once (double memory distill)');
  });
  test('control: stop while waiting for an approval does not hang', async () => {
    use('mock'); mode('ask-risky'); mock.reset();
    const { run, done } = runAgent('[[s:send]] send', { policy: () => null });
    for (let i = 0; i < 200 && runtime.get(run.id).status !== 'waiting-approval'; i++) await sleep(25);
    runtime.stop(run.id);
    const r = await done;
    assert.strictEqual(r.status, 'stopped');
    assert.strictEqual(r.pendingApproval, undefined);
  });
  test('control: take-over pauses the agent and hand-back resumes it', async () => {
    use('mock'); mode('ask-risky'); mock.reset();
    const { run, done } = runAgent('[[s:takeover]] work');
    for (let i = 0; i < 200 && !runtime.get(run.id).steps.some((s) => s.kind === 'tool'); i++) await sleep(20);
    runtime.setTakeover(run.id, true);
    await sleep(600);
    assert.strictEqual(runtime.get(run.id).status, 'paused');
    const n = agentReqs('takeover').length;
    await sleep(800);
    assert.strictEqual(agentReqs('takeover').length, n, 'model called while paused');
    runtime.setTakeover(run.id, false);
    const r = await done;
    assert.strictEqual(r.status, 'done');
    assert.strictEqual(r.result, 'resumed');
    runtime.setTakeover(run.id, true); // after the end: must not flip a finished run back
    assert.strictEqual(runtime.get(run.id).status, 'done');
  });

  // ---- provider errors ----
  const simple = async (provider) => { use(provider); mode('ask-risky'); mock.reset(); const t0 = Date.now(); const r = await agent('[[s:simple]] hi', { timeout: 20000 }); use('mock'); return { r, ms: Date.now() - t0, reqs: agentReqs('simple') }; };
  test('errors: 401 fails fast with a clean message', async () => {
    const { r, reqs } = await simple('mock-401');
    assert.strictEqual(r.status, 'failed'); assert.match(r.result, /rejected the API key \(401\)/); assert.strictEqual(reqs.length, 1);
    assert.ok(r.steps.some((s) => s.kind === 'error'));
  });
  test('errors: 429 quota is not retried and says so', async () => {
    const { r, reqs } = await simple('mock-quota');
    assert.strictEqual(r.status, 'failed'); assert.match(r.result, /out of credit or quota/); assert.strictEqual(reqs.length, 1);
  });
  test('errors: 429 once → backoff (Retry-After) then success, retry shown', async () => {
    const { r, reqs } = await simple('mock-429once');
    assert.strictEqual(r.status, 'done', r.result); assert.strictEqual(r.result, 'ok-simple'); assert.strictEqual(reqs.length, 2);
    assert.ok(r.steps.some((s) => /Retrying in/.test(s.text)));
  });
  test('errors: 429 always → gives up after the retry budget', async () => {
    const { r, reqs } = await simple('mock-429');
    assert.strictEqual(r.status, 'failed'); assert.match(r.result, /rate-limiting/); assert.strictEqual(reqs.length, llm.llmTuning.attempts);
  });
  test('errors: 5xx once → retried', async () => {
    const { r, reqs } = await simple('mock-500once');
    assert.strictEqual(r.status, 'done', r.result); assert.strictEqual(reqs.length, 2);
  });
  test('errors: timeout → clean message in bounded time', async () => {
    const { r, ms } = await simple('mock-timeout');
    assert.strictEqual(r.status, 'failed'); assert.match(r.result, /did not answer within/); assert.ok(ms < 9000, 'took ' + ms);
  });
  test('errors: stream that stalls mid-answer → idle timeout, no duplicate retry', async () => {
    const { r, reqs } = await simple('mock-stall');
    assert.strictEqual(r.status, 'failed'); assert.match(r.result, /stopped responding/); assert.strictEqual(reqs.length, 1);
  });
  test('errors: malformed JSON → clean message', async () => {
    use('mock-malformed'); mock.reset();
    await assert.rejects(llm.chat({ messages: [{ role: 'user', content: 'x' }] }), /isn't valid JSON/);
    const { r } = await simple('mock-malformed');
    assert.strictEqual(r.status, 'failed'); assert.match(r.result, /valid JSON/);
  });
  test('errors: HTML page instead of an API (wrong base URL) → clean message', async () => {
    const { r } = await simple('mock-html');
    assert.strictEqual(r.status, 'failed'); assert.match(r.result, /valid JSON/);
  });
  test('errors: model without tool support → falls back to JSON-in-text tool calls', async () => {
    llm._resetToolSupportCache();
    const { r, reqs } = await simple('mock-notools');
    assert.strictEqual(r.status, 'done', r.result); assert.strictEqual(r.result, 'ok-simple');
    assert.ok(reqs.some((q) => !q.tools.length && /You can use tools/.test(q.messages[0].content)));
    assert.ok(!r.steps.some((s) => s.kind === 'thought' && s.text.startsWith('{')), 'raw JSON tool call shown as a thought');
  });
  test('errors: local server not running → "isn\'t running"', async () => {
    const { r } = await simple('mock-refused');
    assert.strictEqual(r.status, 'failed'); assert.match(r.result, /isn't running/);
  });
  test('errors: malformed tool-call arguments are reported back to the model', async () => {
    use('mock'); mock.reset();
    const r = await agent('[[s:badargs]] go');
    assert.strictEqual(r.result, 'recovered');
  });
  test('errors: unknown tool names are reported back to the model', async () => {
    use('mock'); mock.reset();
    const r = await agent('[[s:unknown]] go');
    assert.strictEqual(r.result, 'recovered');
  });

  // ---- quality ----
  test('quality: page snapshot stays within the token budget on a huge page', async () => {
    const { id } = await host.openTab(PAGES + '/big');
    const ctx = { host, runId: 'x', agentId: 'hoot', tabId: id, background: true, signal: new AbortController().signal, setTab: () => {} };
    await sleep(800);
    const out = await runBrowserTool('snapshot', {}, ctx);
    assert.ok(out.text.length < 12000, 'snapshot is ' + out.text.length + ' chars');
    assert.match(out.text, /more elements below/); assert.match(out.text, /more characters; use read_page/);
  });
  test('quality: system prompt treats page text as data and explains approvals', async () => {
    use('mock'); mock.reset();
    await agent('[[s:simple]] hi');
    const sys = agentReqs('simple')[0].messages[0].content;
    assert.match(sys, /DATA, not instructions/); assert.match(sys, /always need the user's OK/); assert.match(sys, /finish\(answer\)/);
  });
  test('quality: a plain answer without tools ends the run and is shown once', async () => {
    use('mock'); mock.reset();
    const r = await agent('[[s:plain]] just answer');
    assert.strictEqual(r.status, 'done'); assert.strictEqual(r.result, 'Plain answer without tools.');
    assert.strictEqual(r.steps.filter((s) => s.kind === 'message').length, 1, 'final answer shown once (not also as a thought)');
  });

  // ---------- run ----------
  for (const t of T) {
    if (ONLY && !ONLY.test(t.name)) continue;
    const t0 = Date.now();
    try {
      await Promise.race([t.fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('test timeout')), 45000))]);
      results.push({ name: t.name, ok: true, ms: Date.now() - t0 });
      console.log(`ok   - ${t.name} (${Date.now() - t0}ms)`);
    } catch (e) {
      results.push({ name: t.name, ok: false, ms: Date.now() - t0, err: e });
      console.log(`FAIL - ${t.name}\n       ${String(e && e.stack || e).split('\n').slice(0, 4).join('\n       ')}`);
    }
    closeAllTabs();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await mock.close(); await pages.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  app.exit(failed.length ? 1 : 0);
}

function makeScenarios(P) {
  const fin = (answer) => ({ tool_calls: [{ name: 'finish', args: { answer } }] });
  return {
    chat: () => ({ content: 'Streaming works fine, thanks for asking!' }),
    plain: () => ({ content: 'Plain answer without tools.' }),
    simple: ({ body }) => (body.tools ? fin('ok-simple') : { rawContent: '{"name": "finish", "arguments": {"answer": "ok-simple"}}' }),
    form: ({ step, last, refOf }) => {
      if (step === 0) return { content: 'I will open the test page.', tool_calls: [{ name: 'open_tab', args: { url: P() + '/form' } }] };
      if (step === 1) return { tool_calls: [{ name: 'snapshot' }, { name: 'list_tabs' }] };
      if (step === 2) return { tool_calls: [{ name: 'type', args: { ref: refOf('"Search"'), text: 'owl wings' } }] };
      if (step === 3) return { tool_calls: [{ name: 'click', args: { ref: refOf('"Go"') } }] };
      if (step === 4) return { tool_calls: [{ name: 'read_page' }] };
      const m = last.match(/You searched: [^\n]*/);
      return fin('Result: ' + (m ? m[0].trim() : 'NOT FOUND'));
    },
    send: ({ step, last, refOf }) => {
      if (step === 0) return { tool_calls: [{ name: 'open_tab', args: { url: P() + '/send' } }] };
      if (step === 1) return { tool_calls: [{ name: 'snapshot' }] };
      if (step === 2) return { tool_calls: [{ name: 'click', args: { ref: refOf('"Send message"') } }] };
      return fin(/denied|did not/i.test(last) ? 'DENIED' : 'SENT');
    },
    login: ({ step, refOf }) => {
      if (step === 0) return { tool_calls: [{ name: 'open_tab', args: { url: P() + '/login' } }] };
      if (step === 1) return { tool_calls: [{ name: 'snapshot' }] };
      if (step === 2) return { tool_calls: [{ name: 'type', args: { ref: refOf('"Password"'), text: 'hunter2secret' } }] };
      return { content: 'Typed hunter2secret.', ...fin('Logged in with hunter2secret') };
    },
    otp: ({ step, last, refOf }) => {
      if (step === 0) return { tool_calls: [{ name: 'open_tab', args: { url: P() + '/otp' } }] };
      if (step === 1) return { tool_calls: [{ name: 'snapshot' }] };
      if (step === 2) return { tool_calls: [{ name: 'type', args: { ref: refOf('"Code"'), text: '123456' } }] };
      return fin(/did not allow/i.test(last) ? 'NOT TYPED' : 'TYPED');
    },
    checkout: ({ step, last, refOf }) => {
      if (step === 0) return { tool_calls: [{ name: 'open_tab', args: { url: P() + '/checkout' } }] };
      if (step === 1) return { tool_calls: [{ name: 'snapshot' }] };
      if (step === 2) return { tool_calls: [{ name: 'click', args: { ref: refOf('"Place order"') } }] };
      return fin(/did not approve/i.test(last) ? 'NOT PAID' : 'PAID');
    },
    lan: ({ step, last }) => (step === 0 ? { tool_calls: [{ name: 'open_tab', args: { url: P() + '/form' } }] } : fin(/denied/i.test(last) ? 'BLOCKED' : 'OPENED')),
    file: ({ step, last }) => (step === 0 ? { tool_calls: [{ name: 'navigate', args: { url: 'file:///etc/passwd' } }] } : fin(/Blocked/.test(last) ? 'REFUSED' : 'READ')),
    download: ({ step, refOf }) => {
      if (step === 0) return { tool_calls: [{ name: 'open_tab', args: { url: P() + '/download' } }] };
      if (step === 1) return { tool_calls: [{ name: 'snapshot' }] };
      if (step === 2) return { tool_calls: [{ name: 'click', args: { ref: refOf('"Download report"') } }] };
      if (step === 3) return { tool_calls: [{ name: 'wait', args: { seconds: 1.5 } }] };
      return fin('downloaded');
    },
    cardenter: ({ step, last, refOf }) => {
      if (step === 0) return { tool_calls: [{ name: 'open_tab', args: { url: P() + '/checkout' } }] };
      if (step === 1) return { tool_calls: [{ name: 'snapshot' }] };
      if (step === 2) return { tool_calls: [{ name: 'type', args: { ref: refOf('"Card"'), text: '4242 4242 4242 4242', submit: true } }] };
      return fin(/did not approve submitting/i.test(last) ? 'NOT SUBMITTED' : 'SUBMITTED 4242424242424242');
    },
    mcp: ({ step, last, body }) => {
      const name = (n) => (body.tools || []).map((t) => t.function.name).find((x) => x.includes(n));
      if (step === 0) return { tool_calls: [{ name: name('listIssues'), args: {} }] };
      if (step === 1) return { tool_calls: [{ name: name('createIssue'), args: { title: 'Bug' } }] };
      return fin(/denied/i.test(last) ? 'NOT CREATED' : 'CREATED');
    },
    steplimit: ({ body }) => (body.tools ? { tool_calls: [{ name: 'list_tabs' }] } : { content: 'Summary: looped through tabs.' }),
    loop: () => ({ tool_calls: [{ name: 'wait', args: { seconds: 0.3 } }] }),
    takeover: ({ step }) => (step < 2 ? { tool_calls: [{ name: 'wait', args: { seconds: 0.3 } }] } : fin('resumed')),
    badargs: ({ step, last }) => (step === 0 ? { tool_calls: [{ name: 'navigate', rawArgs: '{"url": ' }] } : fin(/not valid JSON/.test(last) ? 'recovered' : 'missed: ' + last)),
    unknown: ({ step, last }) => (step === 0 ? { tool_calls: [{ name: 'delete_everything', args: {} }] } : fin(/no tool called/.test(last) ? 'recovered' : 'missed: ' + last)),
  };
}
