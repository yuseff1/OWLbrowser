import type { WebContents } from 'electron';
import type { LlmTool } from './llm';
import { SNAPSHOT_SCRIPT, LOCATE_SCRIPT, FOCUS_SCRIPT, SELECT_OPTION_SCRIPT, CLEAR_SCRIPT, READ_SCRIPT, CURSOR_SCRIPT } from './page-scripts';
import { isWebUrl, resolvesToPrivate } from '../net-guard';

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
  /**
   * Asks the user before consequential actions; resolves false when denied.
   * `always: true` marks actions that need a human even in autonomous mode (secrets, payments, LAN).
   */
  guard?: (action: string, detail: string, opts?: GuardOpts) => Promise<boolean>;
};

export type GuardOpts = { always?: boolean };

/** What a browser tool hands back to the runner. `sensitive` = the typed text must not be shown or stored. */
export type ToolResult = { text: string; image?: string; sensitive?: boolean };

const RISKY = /\b(buy|pay|purchase|place order|order now|checkout|check out|send|post|publish|tweet|reply|submit|delete|remove|confirm|transfer|subscribe|book now|reserve|sign up|apply)\b/i;
/** Clicks that spend money. These always need the user's OK, also in autonomous mode. */
const PAY_CLICK = /\b(pay( now)?|place (your |my )?order|complete (your )?(purchase|order|payment|checkout)|confirm (and pay|purchase|order|payment)|buy( it)? now|purchase|submit (order|payment)|proceed to payment|order now|start (free )?trial|subscribe)\b/i;

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

export function toUrl(input: string): string {
  const s = input.trim();
  if (!s) return '';
  // localhost:3000, 192.168.1.1:8080/x, [::1]:5000 — not a scheme
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?(\/.*)?$/i.test(s)) return 'http://' + s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[\w-]+(\.[\w-]+)+:\d+/.test(s)) return s; // explicit scheme (checked by gateUrl)
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) && !s.includes(' ')) return 'https://' + s;
  return 'https://www.google.com/search?q=' + encodeURIComponent(s);
}

/**
 * Security gate for every URL an agent loads or fetches (prompt-injection defence):
 * only http(s) (plus about:blank); local files, chrome://, owl://, devtools://, data:, javascript: are refused;
 * hosts on this machine / the LAN (router admin pages, local services) need the user's approval.
 */
async function gateUrl(url: string, ctx: ToolCtx): Promise<string | null> {
  if (!url) return 'Error: no URL given. Pass a full URL like https://example.com or search words.';
  if (url === 'about:blank') return null;
  if (!isWebUrl(url)) return `Blocked: agents may only open http(s) web pages, not "${url.split(':')[0]}:" URLs. Ask the user to open it themselves if it is really needed.`;
  const host = new URL(url).hostname;
  if (await resolvesToPrivate(host)) {
    if (!ctx.guard) return 'Blocked: this address is on your computer or local network.';
    const ok = await ctx.guard(`Open a local-network address (${host})`, url, { always: true });
    if (!ok) return 'The user denied access to this local-network address. Do not retry it.';
  }
  return null;
}

/** Fields an agent must not type into without the user's OK (passwords, card numbers, one-time codes). */
const SENSITIVE_FIELD = /^(cc-|one-time-code|current-password|new-password)/i;
const submitLike = (loc: any) => loc.type === 'submit' || loc.tag === 'button' || /^(submit|button|image)$/.test(loc.type || '');
/** True when this click would most likely pay for something. */
export function isPaymentClick(loc: { label?: string; type?: string; tag?: string; paymentForm?: boolean; paymentPage?: boolean }): boolean {
  return PAY_CLICK.test(loc.label || '') || (!!(loc.paymentForm || loc.paymentPage) && submitLike(loc));
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
export async function runBrowserTool(name: string, args: any, ctx: ToolCtx): Promise<ToolResult> {
  switch (name) {
    case 'open_tab': {
      const target = toUrl(String(args.url ?? ''));
      const blocked = await gateUrl(target, ctx);
      if (blocked) return { text: blocked };
      const t = await ctx.host.openTab(target, { background: ctx.background, agentId: ctx.agentId, runId: ctx.runId });
      ctx.setTab(t.id);
      await waitForLoad(t.wc);
      return { text: `Opened tab ${t.id}: ${t.wc.getTitle()} (${t.wc.getURL()})` };
    }
    case 'navigate': {
      const target = toUrl(String(args.url ?? ''));
      const blocked = await gateUrl(target, ctx);
      if (blocked) return { text: blocked };
      const wc = await currentWc(ctx);
      await wc.loadURL(target).catch((e) => { if (!/ERR_ABORTED/.test(String(e))) throw e; });
      await waitForLoad(wc);
      return { text: `Now at ${wc.getURL()} — ${wc.getTitle()}` };
    }
    case 'snapshot': {
      const wc = await currentWc(ctx);
      const s = await wc.executeJavaScript(SNAPSHOT_SCRIPT, true);
      if (!s) return { text: `URL: ${wc.getURL()}\n(The page could not be read yet; wait and snapshot again.)` };
      return { text: `URL: ${s.url}\nTitle: ${s.title}\nScroll: ${s.scroll.y}/${s.scroll.max}\n\nInteractive elements:\n${s.elements || '(none)'}\n\nVisible text:\n${s.text}` };
    }
    case 'click': {
      const wc = await currentWc(ctx);
      const loc = await wc.executeJavaScript(LOCATE_SCRIPT(Number(args.ref)), true);
      if (!loc) return { text: `Element [${args.ref}] not found — take a new snapshot.` };
      // payments always need a human (also in autonomous mode)
      if (isPaymentClick(loc)) {
        const ok = ctx.guard ? await ctx.guard(`Submit a payment / purchase: click "${loc.label || loc.tag}"`, `on ${wc.getURL()}`, { always: true }) : false;
        if (!ok) return { text: 'The user did not approve this payment step. Do not retry it; tell the user what is ready so they can finish it themselves.' };
      // labels are page-controlled, so also gate any click inside a form holding a password / card field
      } else if (ctx.guard && (RISKY.test(loc.label) || loc.type === 'submit' || (loc.sensitiveForm && submitLike(loc)))) {
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
      const sensitive = !!(loc.sensitive || loc.type === 'password' || SENSITIVE_FIELD.test(loc.autocomplete || ''));
      if (sensitive) {
        // never skipped, also in autonomous mode; the value itself is never shown in the approval
        const ok = ctx.guard ? await ctx.guard('Type into a password / payment / one-time-code field', `field "${loc.label || loc.tag}" on ${wc.getURL()}`, { always: true }) : false;
        if (!ok) return { text: 'The user did not allow typing into this sensitive field. Ask the user to fill it in themselves (they can take over the tab).', sensitive };
      }
      await trustedClick(wc, loc.x, loc.y);
      await sleep(120);
      if (args.clear) {
        await wc.executeJavaScript(CLEAR_SCRIPT(Number(args.ref)), true);
        await pressKey(wc, 'Control+A');
        await pressKey(wc, 'Backspace');
      }
      await wc.insertText(String(args.text));
      if (args.submit && (loc.paymentForm || loc.paymentPage)) {
        const ok = ctx.guard ? await ctx.guard('Submit a payment form (press Enter)', `on ${wc.getURL()}`, { always: true }) : false;
        if (!ok) return { text: 'Typed, but the user did not approve submitting this payment form.', sensitive };
      } else if (args.submit && ctx.guard && loc.inForm && /mail|message|post|comment|reply|tweet/i.test(wc.getURL() + loc.label)) {
        const ok = await ctx.guard('Submit text', sensitive ? `(hidden text) on ${wc.getURL()}` : `"${String(args.text).slice(0, 140)}" on ${wc.getURL()}`);
        if (!ok) return { text: 'Typed, but the user denied submitting it.', sensitive };
      }
      if (args.submit) { await sleep(100); await pressKey(wc, 'Enter'); await sleep(600); if (wc.isLoading()) await waitForLoad(wc); }
      return { text: `Typed into [${args.ref}]${args.submit ? ' and pressed Enter' : ''}.`, sensitive };
    }
    case 'select_option': {
      const wc = await currentWc(ctx);
      return { text: String(await wc.executeJavaScript(SELECT_OPTION_SCRIPT(Number(args.ref), String(args.value)), true)) };
    }
    case 'press_key': {
      const wc = await currentWc(ctx);
      if (/(^|\+)\s*(enter|return)\s*$/i.test(String(args.key))) {
        const f = await wc.executeJavaScript(FOCUS_SCRIPT, true).catch(() => null);
        if (f && (f.paymentPage || (f.inForm && f.sensitiveForm && f.paymentForm))) {
          const ok = ctx.guard ? await ctx.guard('Submit a payment form (press Enter)', `on ${wc.getURL()}`, { always: true }) : false;
          if (!ok) return { text: 'The user did not approve submitting this payment form.' };
        }
      }
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
      const target = toUrl(String(args.url ?? ''));
      const blocked = await gateUrl(target, ctx);
      if (blocked) return { text: blocked };
      const html = await ctx.host.fetchText(target);
      const text = htmlToText(html);
      return { text: text.length > 12000 ? text.slice(0, 12000) + `\n…(${text.length - 12000} more characters not shown)` : text || '(The page had no readable text.)' };
    }
  }
  throw new Error('Unknown browser tool ' + name);
}
