/**
 * Serves saved artifacts from `owl-artifact://a/<artifactId>` so scripted artifacts (charts, small apps) run.
 *
 * Why: the Artifact page used `<iframe srcdoc>`, which inherits the UI's strict CSP (`script-src 'self'`),
 * so inline <script> in an artifact was blocked. A dedicated scheme gives artifacts their own CSP.
 * Safety:
 *   - The scheme is only handled on the UI's default session; web tabs (persist:owl-* partitions) cannot load it.
 *   - The page embeds it in `<iframe sandbox="allow-scripts ...">` without allow-same-origin, so the artifact runs
 *     in an opaque origin: no cookies/storage of OWL, no `window.owl` (preload runs in the top UI frame only, and
 *     every owl:* IPC is rejected unless it comes from that top frame, see isTrustedUiFrame).
 *   - Response CSP allows inline scripts + https CDNs, but no plugins, no form posts off-box, no nested owl-ui.
 * Must be imported before app 'ready' (scheme registration happens in ui-protocol.ts).
 */
import { app, session } from 'electron';
import { dataFor } from './data';
import { profiles } from './profiles';
import type { Artifact } from '../shared/types';

export const ARTIFACT_SCHEME = 'owl-artifact';

export const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https: blob: data:",
  "style-src 'unsafe-inline' https: data:",
  "img-src https: http: data: blob:",
  "font-src https: data:",
  "media-src https: data: blob:",
  "connect-src https:",
  "worker-src blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function findArtifact(id: string): Artifact | null {
  if (!ID_RE.test(id)) return null;
  for (const p of profiles.list()) {
    const a = dataFor(p.id).artifacts.get().find((x) => x.id === id);
    if (a) return a;
  }
  return null;
}

/** URL the Artifact page frames. */
export function artifactUrl(id: string): string {
  return `${ARTIFACT_SCHEME}://a/${encodeURIComponent(id)}`;
}

function handle(req: Request): Response {
  let id = '';
  try {
    const u = new URL(req.url);
    if (u.host !== 'a') return new Response('Not found', { status: 404 });
    id = decodeURIComponent(u.pathname.replace(/^\/+/, '').split('/')[0] || '');
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  const a = findArtifact(id);
  if (!a) return new Response('<!doctype html><meta charset="utf-8"><p style="font:14px system-ui;color:#666;padding:24px">This artifact isn’t here any more.</p>', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': ARTIFACT_CSP } });
  let html = a.html || '';
  if (!/<meta[^>]+charset/i.test(html)) html = '<meta charset="utf-8">' + html;
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': ARTIFACT_CSP,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}

app.whenReady().then(() => {
  const p = session.defaultSession.protocol;
  if (!p.isProtocolHandled(ARTIFACT_SCHEME)) p.handle(ARTIFACT_SCHEME, handle);
});
