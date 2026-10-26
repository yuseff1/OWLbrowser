// Ad + tracker blocking via Ghostery's engine (uBlock-compatible filter lists).
// One engine is shared across all sessions; the serialized engine is cached on disk
// so startup after the first run needs no network.
import { app, net, Session } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { ElectronBlocker } from '@ghostery/adblocker-electron';

let enginePromise: Promise<ElectronBlocker> | null = null;
const enabled = new WeakSet<Session>();
let blockedCount = 0;

function cachePath() {
  return path.join(app.getPath('userData'), 'adblock-engine.bin');
}

const fetchImpl = ((url: string, init?: any) => net.fetch(url, init)) as any;

function engine(): Promise<ElectronBlocker> {
  if (!enginePromise) {
    enginePromise = ElectronBlocker.fromPrebuiltAdsAndTracking(fetchImpl, {
      path: cachePath(),
      read: (p: string) => fs.promises.readFile(p),
      write: (p: string, buf: Uint8Array) => fs.promises.writeFile(p, buf),
    }).then((b) => {
      b.on('request-blocked', () => { blockedCount++; });
      return b;
    }).catch((e) => { enginePromise = null; throw e; });
  }
  return enginePromise;
}

export async function enableAdblock(ses: Session): Promise<void> {
  if (enabled.has(ses)) return;
  const b = await engine();
  b.enableBlockingInSession(ses);
  enabled.add(ses);
}

export async function disableAdblock(ses: Session): Promise<void> {
  if (!enabled.has(ses)) return;
  const b = await engine();
  try { b.disableBlockingInSession(ses); } catch { /* already off */ }
  enabled.delete(ses);
}

export function adblockStats() {
  return { blocked: blockedCount };
}
