// Browser tools for the mobile agent. Same names/semantics as desktop browser-tools.ts where they apply,
// implemented over react-native-webview (injectJavaScript + postMessage bridge in state/browser.ts).
import type { LlmTool } from './llm';
import { fetchWithTimeout } from './llm';
import { browser, browserStore, webviews } from '@/state/browser';
import { appStore } from '@/state/app';
import { toUrl } from '@/lib/url';
import {
  SNAPSHOT_SCRIPT, DESCRIBE_SCRIPT, CLICK_SCRIPT, TYPE_SCRIPT, SELECT_OPTION_SCRIPT, SCROLL_SCRIPT, READ_SCRIPT,
} from './page-scripts';

export type ToolCtx = {
  tabId: string;
  signal: AbortSignal;
  /** asks the user before consequential actions; resolves false when denied */
  guard: (action: string, detail: string) => Promise<boolean>;
};

const RISKY = /\b(buy|pay|purchase|place order|order now|checkout|check out|send|post|publish|tweet|reply|submit|delete|remove|confirm|transfer|subscribe|book now|reserve|sign up|apply)\b/i;

const fn = (name: string, description: string, properties: any = {}, required: string[] = []): LlmTool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export const BROWSER_TOOLS: LlmTool[] = [
  fn('navigate', 'Navigate the current tab to a URL or search query.', { url: { type: 'string' } }, ['url']),
  fn('snapshot', 'Get the current page: URL, title, interactive elements with [ref] numbers, and visible text. Call after every navigation or action before choosing the next step.'),
  fn('click', 'Click (tap) an element by its [ref] number from the latest snapshot.', { ref: { type: 'number' } }, ['ref']),
  fn('type', 'Type text into an input/textarea/editable element by ref. Set submit=true to press Enter / submit the form after typing. Set clear=true to replace existing text.', { ref: { type: 'number' }, text: { type: 'string' }, submit: { type: 'boolean' }, clear: { type: 'boolean' } }, ['ref', 'text']),
  fn('select_option', 'Choose an option in a <select> element by ref.', { ref: { type: 'number' }, value: { type: 'string' } }, ['ref', 'value']),
  fn('scroll', 'Scroll the current page. direction: down|up|top|bottom.', { direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] } }, ['direction']),
  fn('read_page', 'Read the main content of the current page as clean text (articles, docs, profiles, tables). Use for extracting information.'),
  fn('back', 'Go back in the current tab history.'),
  fn('wait', 'Wait for the page to update (seconds, max 10).', { seconds: { type: 'number' } }, ['seconds']),
  fn('web_search', 'Fast web search without touching the tab. Returns top results (title, url, snippet).', { query: { type: 'string' } }, ['query']),
  fn('fetch_url', 'Fetch a URL and return its readable text without touching the tab (fast research on public pages).', { url: { type: 'string' } }, ['url']),
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

function currentUrl(tabId: string) {
  return browserStore.get().tabs.find((t) => t.id === tabId)?.url || '';
}

async function settle(tabId: string, before: string) {
  await sleep(600);
  const rt = browserStore.get().runtime[tabId];
  if (rt?.loading || currentUrl(tabId) !== before) await webviews.waitForLoad(tabId, 12000);
  await sleep(250);
}

async function ensurePage(tabId: string) {
  const t = browserStore.get().tabs.find((x) => x.id === tabId);
  if (!t) throw new Error('The tab I was working in was closed.');
  if (!t.url) throw new Error('The tab is on the OWL home screen. Use navigate first.');
  if (!webviews.get(tabId)) { browser.activate(tabId); await webviews.waitForLoad(tabId, 8000); }
}

export async function searchWeb(query: string): Promise<string> {
  // DuckDuckGo HTML endpoint: no key needed, light and fast.
  const r = await fetchWithTimeout('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), { headers: { 'User-Agent': UA }, timeoutMs: 15000 });
  const html = await r.text();
  const results: string[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').trim();
  while ((m = re.exec(html)) && results.length < 8) {
    let url = m[1];
    const u = url.match(/uddg=([^&]+)/);
    if (u) url = decodeURIComponent(u[1]);
    results.push(`${results.length + 1}. ${strip(m[2])}\n   ${url}\n   ${strip(m[3]).slice(0, 220)}`);
  }
  return results.length ? results.join('\n') : 'No results parsed. Try navigate with a search query instead.';
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)>/gi, '\n').replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

export async function runBrowserTool(name: string, args: any, ctx: ToolCtx): Promise<string> {
  const tabId = ctx.tabId;
  switch (name) {
    case 'navigate': {
      const url = toUrl(String(args.url || ''), appStore.get().settings.searchEngine);
      if (!url) return 'Empty URL.';
      browser.activate(tabId);
      const wait = webviews.waitForLoad(tabId, 20000);
      browser.navigate(tabId, url);
      await wait;
      await sleep(400);
      const t = browserStore.get().tabs.find((x) => x.id === tabId);
      return `Now at ${t?.url || url} — ${t?.title || ''}`;
    }
    case 'snapshot': {
      await ensurePage(tabId);
      const s = await webviews.eval<any>(tabId, SNAPSHOT_SCRIPT);
      return `URL: ${s.url}\nTitle: ${s.title}\nScroll: ${s.scroll.y}/${s.scroll.max}\n\nInteractive elements:\n${s.elements || '(none)'}\n\nVisible text:\n${s.text}`;
    }
    case 'click': {
      await ensurePage(tabId);
      const ref = Number(args.ref);
      const d = await webviews.eval<any>(tabId, DESCRIBE_SCRIPT(ref));
      if (!d) return `Element [${ref}] not found — take a new snapshot.`;
      if (appStore.get().settings.approvalMode === 'ask-always' || RISKY.test(d.label) || d.type === 'submit') {
        const ok = await ctx.guard(`Tap "${d.label || d.tag}"`, `on ${currentUrl(tabId)}`);
        if (!ok) return 'The user denied this action. Do not retry it; ask or choose another path.';
      }
      const before = currentUrl(tabId);
      await webviews.eval(tabId, CLICK_SCRIPT(ref));
      await settle(tabId, before);
      const after = currentUrl(tabId);
      return `Clicked [${ref}] <${d.tag}> "${d.label}".${after !== before ? ' Navigated to ' + after : ''}`;
    }
    case 'type': {
      await ensurePage(tabId);
      const ref = Number(args.ref);
      const text = String(args.text ?? '');
      if (args.submit) {
        const d = await webviews.eval<any>(tabId, DESCRIBE_SCRIPT(ref));
        if (d && d.inForm && /mail|message|post|comment|reply|tweet|chat/i.test(currentUrl(tabId) + ' ' + d.label)) {
          const ok = await ctx.guard('Submit text', `"${text.slice(0, 140)}" on ${currentUrl(tabId)}`);
          if (!ok) {
            await webviews.eval(tabId, TYPE_SCRIPT(ref, text, { clear: !!args.clear }));
            return 'Typed, but the user denied submitting it.';
          }
        }
      }
      const before = currentUrl(tabId);
      const r = await webviews.eval<any>(tabId, TYPE_SCRIPT(ref, text, { submit: !!args.submit, clear: !!args.clear }));
      if (!r) return `Element [${ref}] not found — take a new snapshot.`;
      if (r.error) return r.error;
      if (args.submit) await settle(tabId, before);
      return `Typed into [${ref}]${args.submit ? ' and pressed Enter' + (r.submitted ? ' (form submitted)' : '') : ''}.`;
    }
    case 'select_option': {
      await ensurePage(tabId);
      return String(await webviews.eval(tabId, SELECT_OPTION_SCRIPT(Number(args.ref), String(args.value))));
    }
    case 'scroll': {
      await ensurePage(tabId);
      const r = await webviews.eval<any>(tabId, SCROLL_SCRIPT(String(args.direction || 'down')));
      await sleep(350);
      return `Scrolled ${args.direction}. Position ${r?.y}/${r?.max}.`;
    }
    case 'read_page': {
      await ensurePage(tabId);
      const r = await webviews.eval<any>(tabId, READ_SCRIPT, 15000);
      return `# ${r.title}\n${r.url}\n\n${r.text}`.slice(0, 16000);
    }
    case 'back': {
      const before = currentUrl(tabId);
      browser.goBack(tabId);
      await settle(tabId, before);
      return `Now at ${currentUrl(tabId) || 'the OWL home screen'}`;
    }
    case 'wait': {
      await sleep(Math.min(10, Math.max(0.2, Number(args.seconds) || 1)) * 1000);
      return 'Waited.';
    }
    case 'web_search':
      return searchWeb(String(args.query));
    case 'fetch_url': {
      const r = await fetchWithTimeout(toUrl(String(args.url)), { headers: { 'User-Agent': UA }, timeoutMs: 20000 });
      const html = await r.text();
      return htmlToText(html).slice(0, 15000);
    }
  }
  throw new Error('Unknown tool ' + name);
}
