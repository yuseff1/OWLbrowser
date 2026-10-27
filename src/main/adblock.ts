// Ad + tracker blocking via Ghostery's engine (uBlock-compatible filter lists).
// One engine is shared across all sessions; the serialized engine is cached on disk
// so startup after the first run needs no network.
import { app, ipcMain, net, Session } from 'electron';
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

// Ghostery registers these two ipcMain.handle() channels once PER SESSION it enables and removes them on
// disable. ipcMain.handle throws on a second registration, so enabling a second session (an incognito
// window, another profile) threw half-way: cosmetic preload added, network blocking never installed.
// Disabling one session also removed the channels every other session still needs.
const COSMETIC_CHANNELS = ['@ghostery/adblocker/inject-cosmetic-filters', '@ghostery/adblocker/is-mutation-observer-enabled'];
let enabledCount = 0;
const clearCosmeticHandlers = () => { for (const c of COSMETIC_CHANNELS) ipcMain.removeHandler(c); };
const pending = new WeakMap<Session, Promise<void>>();

export async function enableAdblock(ses: Session): Promise<void> {
  if (enabled.has(ses)) return;
  const inFlight = pending.get(ses);
  if (inFlight) return inFlight;
  const p = (async () => {
    const b = await engine();
    if (enabled.has(ses)) return;
    clearCosmeticHandlers(); // re-registered by enableBlockingInSession (the handlers are engine-wide, not per session)
    b.enableBlockingInSession(ses);
    enabled.add(ses);
    enabledCount++;
  })().finally(() => pending.delete(ses));
  pending.set(ses, p);
  return p;
}

export async function disableAdblock(ses: Session): Promise<void> {
  await pending.get(ses)?.catch(() => {});
  if (!enabled.has(ses)) return;
  const b = await engine();
  try { b.disableBlockingInSession(ses); } catch { /* already off */ }
  enabled.delete(ses);
  enabledCount = Math.max(0, enabledCount - 1);
  // other sessions still block: give them back the cosmetic-filter channels disable just removed
  if (enabledCount > 0) {
    clearCosmeticHandlers();
    ipcMain.handle(COSMETIC_CHANNELS[0], (b as any).onInjectCosmeticFilters);
    ipcMain.handle(COSMETIC_CHANNELS[1], (b as any).onIsMutationObserverEnabled);
  }
}

export function adblockStats() {
  return { blocked: blockedCount };
}
