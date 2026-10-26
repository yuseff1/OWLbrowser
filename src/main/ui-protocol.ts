/**
 * Serves the Svelte UI (dist/renderer) from a private `owl-ui://app/` origin instead of file://.
 *
 * Why (Electron security checklist #18): file:// pages get extra privileges in Electron and every
 * file:// page (including any .html the user opens in a tab) would share the UI's origin. A custom
 * standard scheme gives the UI its own origin that web pages can never obtain, which is also what the
 * IPC sender check (isTrustedUiFrame) keys on, and lets the `grantFileProtocolExtraPrivileges` fuse be off.
 *
 * Must be imported before app 'ready' (registerSchemesAsPrivileged requirement).
 */
import { app, net, protocol, session } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';

export const UI_SCHEME = 'owl-ui';
export const UI_ORIGIN = `${UI_SCHEME}://app`;

// Every renderer (UI and web tabs) runs in the Chromium OS sandbox; none of them needs Node.
app.enableSandbox();

protocol.registerSchemesAsPrivileged([
  { scheme: UI_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  // artifacts (served by artifact-protocol.ts, framed sandboxed by the Artifact page)
  { scheme: 'owl-artifact', privileges: { standard: true, secure: true } },
]);

const ROOT = path.resolve(__dirname, '..', 'renderer');

function handleUi(req: Request): Promise<Response> | Response {
  let rel: string;
  try {
    const u = new URL(req.url);
    if (u.host !== 'app') return new Response('Not found', { status: 404 });
    rel = decodeURIComponent(u.pathname);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(ROOT, '.' + rel);
  // path traversal guard: never serve anything outside dist/renderer
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
  return net.fetch(pathToFileURL(file).toString());
}

app.whenReady().then(() => {
  // The UI windows use the default session; web tabs use their own persist:owl-* partitions,
  // so web content can never load owl-ui:// resources.
  if (!session.defaultSession.protocol.isProtocolHandled(UI_SCHEME)) session.defaultSession.protocol.handle(UI_SCHEME, handleUi);
});

/** URL the UI window loads. */
export function uiUrl(query: Record<string, string>): string {
  return `${UI_ORIGIN}/index.html?${new URLSearchParams(query).toString()}`;
}

/** True only for the top frame of an OWL UI document (never a web page, iframe or artifact). */
export function isTrustedUiFrame(frame: Electron.WebFrameMain | null | undefined): boolean {
  if (!frame || frame.parent) return false;
  try {
    // (Node's URL reports origin 'null' for custom schemes, so compare scheme + host)
    const u = new URL(frame.url);
    return u.protocol === UI_SCHEME + ':' && u.host === 'app';
  } catch {
    return false;
  }
}
