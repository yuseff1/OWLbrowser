import type { WebContents } from 'electron';
import type { LlmTool } from './llm';
import { SNAPSHOT_SCRIPT, LOCATE_SCRIPT, SELECT_OPTION_SCRIPT, CLEAR_SCRIPT, READ_SCRIPT, CURSOR_SCRIPT } from './page-scripts';

/** What the agent runtime needs from the browser to drive tabs. Implemented by the window/tab manager. */
export interface BrowserHost {
  openTab(url: string, opts: { background: boolean; agentId: string; runId: string }): Promise<{ id: number; wc: WebContents }>;
  getTab(id: number): { id: number; wc: WebContents; url: string; title: string } | null;
  listTabs(): Array<{ id: number; url: string; title: string; agentId?: string }>;
  closeTab(id: number): void;
  focusTab(id: number): void;
  fetchText(url: string): Promise<string>;
}

export type ToolCtx = {
  host: BrowserHost;
  runId: string;
  agentId: string;
  /** current tab the agent is working in */
  tabId: number | null;
  setTab(id: number): void;
  background: boolean;
  signal: AbortSignal;
  /** asks the user before consequential actions; resolves false when denied */
  guard?: (action: string, detail: string) => Promise<boolean>;
};

const RISKY = /\b(buy|pay|purchase|place order|order now|checkout|check out|send|post|publish|tweet|reply|submit|delete|remove|confirm|transfer|subscribe|book now|reserve|sign up|apply)\b/i;

const fn = (name: string, description: string, properties: any = {}, required: string[] = []): LlmTool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export const BROWSER_TOOLS: LlmTool[] = [
  fn('open_tab', 'Open a new tab at a URL (or a search query). Use to work in parallel on several sites. Becomes the current tab.', { url: { type: 'string' } }, ['url']),
  fn('navigate', 'Navigate the current tab to a URL or search query.', { url: { type: 'string' } }, ['url']),
  fn('snapshot', 'Get the current page: URL, title, interactive elements with [ref] numbers, and visible text. Call after every navigation or action before choosing the next step.'),
  fn('click', 'Click an element by its [ref] number from the latest snapshot.', { ref: { type: 'number' } }, ['ref']),
  fn('type', 'Type text into an input/textarea/editable element by ref. Set submit=true to press Enter after typing. Set clear=true to replace existing text.', { ref: { type: 'number' }, text: { type: 'string' }, submit: { type: 'boolean' }, clear: { type: 'boolean' } }, ['ref', 'text']),
  fn('select_option', 'Choose an option in a <select> element by ref.', { ref: { type: 'number' }, value: { type: 'string' } }, ['ref', 'value']),
  fn('press_key', 'Press a key or combo in the current tab, e.g. Enter, Escape, Tab, ArrowDown, Control+A.', { key: { type: 'string' } }, ['key']),
  fn('scroll', 'Scroll the current page. direction: down|up|top|bottom.', { direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] } }, ['direction']),
  fn('read_page', 'Read the main content of the current page as clean text (articles, docs, profiles, tables). Use for extracting information.'),
  fn('screenshot', 'Take a screenshot of the current tab to look at it (for visual layouts, charts, captchas you must describe).'),
  fn('back', 'Go back in the current tab history.'),
  fn('wait', 'Wait for the page to update (seconds, max 10).', { seconds: { type: 'number' } }, ['seconds']),
  fn('list_tabs', 'List open tabs (id, title, url).'),
  fn('switch_tab', 'Make another tab (by id) the current tab.', { id: { type: 'number' } }, ['id']),
  fn('close_tab', 'Close a tab you opened (by id).', { id: { type: 'number' } }, ['id']),
  fn('web_search', 'Fast web search without opening a tab. Returns top results (title, url, snippet).', { query: { type: 'string' } }, ['query']),
  fn('fetch_url', 'Fetch a URL and return its readable text without opening a tab (fast research on public pages).', { url: { type: 'string' } }, ['url']),
];

function toUrl(input: string): string {
  const s = input.trim();
  if (/^(https?|file|about|chrome|owl):/i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) && !s.includes(' ')) return 'https://' + s;
  return 'https://www.google.com/search?q=' + encodeURIComponent(s);
}

async function waitForLoad(wc: WebContents, timeout = 15000) {
  if (!wc.isLoading()) { await sleep(250); return; }
  await new Promise<void>((resolve) => {
    const t = setTimeout(done, timeout);
    function done() { clearTimeout(t); wc.removeListener('did-stop-loading', done); resolve(); }
    wc.once('did-stop-loading', done);
  });
  await sleep(350);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function currentWc(ctx: ToolCtx, openIfMissing = true): Promise<WebContents> {
  if (ctx.tabId != null) {
    const t = ctx.host.getTab(ctx.tabId);
    if (t && !t.wc.isDestroyed()) return t.wc;
  }
  if (!openIfMissing) throw new Error('No current tab. Use open_tab first.');
  const t = await ctx.host.openTab('about:blank', { background: ctx.background, agentId: ctx.agentId, runId: ctx.runId });
  ctx.setTab(t.id);
  return t.wc;
}

async function trustedClick(wc: WebContents, x: number, y: number, clickCount = 1) {
  wc.executeJavaScript(CURSOR_SCRIPT(x, y)).catch(() => {});
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  await sleep(60);
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount });
  await sleep(40);
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount });
}

const KEY_ALIASES: Record<string, string> = { enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', tab: 'Tab', space: 'Space', backspace: 'Backspace', delete: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right', pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End' };

async function pressKey(wc: WebContents, combo: string) {
  const parts = combo.split('+').map((p) => p.trim());
  const key = parts.pop()!;
  const modifiers = parts.map((m) => m.toLowerCase()).map((m) => (m === 'ctrl' || m === 'control' ? 'control' : m === 'cmd' || m === 'meta' ? 'meta' : m)) as any[];
  const keyCode = KEY_ALIASES[key.toLowerCase()] || key;
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (keyCode.length === 1 && !modifiers.length) wc.sendInputEvent({ type: 'char', keyCode, modifiers });
  if (keyCode === 'Return' && !modifiers.length) wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await sleep(120);
}

export async function searchWeb(host: BrowserHost, query: string): Promise<string> {
  // DuckDuckGo HTML endpoint: no key needed, light and fast.
  const html = await host.fetchText('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query));
  const results: string[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && results.length < 8) {
    let url = m[1];
    const u = url.match(/uddg=([^&]+)/); if (u) url = decodeURIComponent(u[1]);
    const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').trim();
    results.push(`${results.length + 1}. ${strip(m[2])}\n   ${url}\n   ${strip(m[3]).slice(0, 220)}`);
  }
  return results.length ? results.join('\n') : 'No results parsed. Try open_tab with a Google search instead.';
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)>/gi, '\n').replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

/** Execute one browser tool. Returns text for the model and optionally an image (data URL). */
export async function runBrowserTool(name: string, args: any, ctx: ToolCtx): Promise<{ text: string; image?: string }> {
  switch (name) {
    case 'open_tab': {
      const t = await ctx.host.openTab(toUrl(args.url), { background: ctx.background, agentId: ctx.agentId, runId: ctx.runId });
      ctx.setTab(t.id);
      await waitForLoad(t.wc);
      return { text: `Opened tab ${t.id}: ${t.wc.getTitle()} (${t.wc.getURL()})` };
    }
    case 'navigate': {
      const wc = await currentWc(ctx);
      await wc.loadURL(toUrl(args.url)).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
      await waitForLoad(wc);
      return { text: `Now at ${wc.getURL()} — ${wc.getTitle()}` };
    }
    case 'snapshot': {
      const wc = await currentWc(ctx);
      const s = await wc.executeJavaScript(SNAPSHOT_SCRIPT, true);
      return { text: `URL: ${s.url}\nTitle: ${s.title}\nScroll: ${s.scroll.y}/${s.scroll.max}\n\nInteractive elements:\n${s.elements || '(none)'}\n\nVisible text:\n${s.text}` };
    }
    case 'click': {
      const wc = await currentWc(ctx);
      const loc = await wc.executeJavaScript(LOCATE_SCRIPT(Number(args.ref)), true);
      if (!loc) return { text: `Element [${args.ref}] not found — take a new snapshot.` };
      if (ctx.guard && (RISKY.test(loc.label) || loc.type === 'submit')) {
        const ok = await ctx.guard(`Click "${loc.label || loc.tag}"`, `on ${wc.getURL()}`);
        if (!ok) return { text: 'The user denied this action. Do not retry it; ask or choose another path.' };
      }
      await sleep(120);
      const before = wc.getURL();
      await trustedClick(wc, loc.x, loc.y);
      await sleep(500);
      if (wc.isLoading()) await waitForLoad(wc);
      return { text: `Clicked [${args.ref}] <${loc.tag}>.${wc.getURL() !== before ? ' Navigated to ' + wc.getURL() : ''}` };
    }
    case 'type': {
      const wc = await currentWc(ctx);
      const loc = await wc.executeJavaScript(LOCATE_SCRIPT(Number(args.ref)), true);
      if (!loc) return { text: `Element [${args.ref}] not found — take a new snapshot.` };
      await trustedClick(wc, loc.x, loc.y);
      await sleep(120);
      if (args.clear) {
        await wc.executeJavaScript(CLEAR_SCRIPT(Number(args.ref)), true);
        await pressKey(wc, 'Control+A');
        await pressKey(wc, 'Backspace');
      }
      await wc.insertText(String(args.text));
      if (args.submit && ctx.guard && loc.inForm && /mail|message|post|comment|reply|tweet/i.test(wc.getURL() + loc.label)) {
        const ok = await ctx.guard('Submit text', `"${String(args.text).slice(0, 140)}" on ${wc.getURL()}`);
        if (!ok) return { text: 'Typed, but the user denied submitting it.' };
      }
      if (args.submit) { await sleep(100); await pressKey(wc, 'Enter'); await sleep(600); if (wc.isLoading()) await waitForLoad(wc); }
      return { text: `Typed into [${args.ref}]${args.submit ? ' and pressed Enter' : ''}.` };
    }
    case 'select_option': {
      const wc = await currentWc(ctx);
      return { text: String(await wc.executeJavaScript(SELECT_OPTION_SCRIPT(Number(args.ref), String(args.value)), true)) };
    }
    case 'press_key': {
      const wc = await currentWc(ctx);
      await pressKey(wc, String(args.key));
      if (wc.isLoading()) await waitForLoad(wc);
      return { text: `Pressed ${args.key}.` };
    }
    case 'scroll': {
      const wc = await currentWc(ctx);
      const d = args.direction;
      const js = d === 'top' ? 'scrollTo(0,0)' : d === 'bottom' ? 'scrollTo(0, document.documentElement.scrollHeight)' : `scrollBy(0, ${d === 'up' ? '-' : ''}innerHeight * 0.8)`;
      await wc.executeJavaScript(js);
      await sleep(400);
      return { text: `Scrolled ${d}.` };
    }
    case 'read_page': {
      const wc = await currentWc(ctx);
      const r = await wc.executeJavaScript(READ_SCRIPT, true);
      return { text: `# ${r.title}\n${r.url}\n\n${r.text}` };
    }
    case 'screenshot': {
      const wc = await currentWc(ctx);
      const img = await wc.capturePage();
      const small = img.resize({ width: Math.min(1280, img.getSize().width) });
      return { text: 'Screenshot of the current tab attached.', image: 'data:image/jpeg;base64,' + small.toJPEG(70).toString('base64') };
    }
    case 'back': {
      const wc = await currentWc(ctx);
      if (wc.navigationHistory.canGoBack()) { wc.navigationHistory.goBack(); await waitForLoad(wc); }
      return { text: `Now at ${wc.getURL()}` };
    }
    case 'wait': {
      await sleep(Math.min(10, Math.max(0.2, Number(args.seconds) || 1)) * 1000);
      return { text: 'Waited.' };
    }
    case 'list_tabs':
      return { text: ctx.host.listTabs().map((t) => `${t.id}${t.id === ctx.tabId ? ' (current)' : ''}: ${t.title} — ${t.url}`).join('\n') || 'No tabs.' };
    case 'switch_tab': {
      const t = ctx.host.getTab(Number(args.id));
      if (!t) return { text: 'No such tab.' };
      ctx.setTab(t.id);
      return { text: `Switched to tab ${t.id}: ${t.title}` };
    }
    case 'close_tab':
      ctx.host.closeTab(Number(args.id));
      if (ctx.tabId === Number(args.id)) ctx.tabId = null;
      return { text: 'Closed.' };
    case 'web_search':
      return { text: await searchWeb(ctx.host, String(args.query)) };
    case 'fetch_url': {
      const html = await ctx.host.fetchText(toUrl(String(args.url)));
      return { text: htmlToText(html).slice(0, 15000) };
    }
  }
  throw new Error('Unknown browser tool ' + name);
}
