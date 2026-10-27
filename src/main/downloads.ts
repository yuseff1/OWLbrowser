/**
 * Downloads started from a tab an agent is driving are not saved silently (SEC-R4).
 * They go to a quarantine folder, paused, and the run asks the user (also in autonomous mode).
 * Approved: the file finishes and is moved into Downloads. Denied / run gone: cancelled and deleted.
 *
 * main.ts calls `gateAgentDownload()` from its `will-download` handler; the agent runtime registers
 * the webContents of the tabs it drives with `agentDownloads.register()`.
 */
import { app } from 'electron';
import type { DownloadItem as ElectronDownloadItem, WebContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type DownloadAsk = (action: string, detail: string) => Promise<boolean>;

type Reg = { runId: string; ask: DownloadAsk };
const byWc = new Map<number, Reg>();
let quarantineOverride: string | null = null;
let purged = false;

export const agentDownloads = {
  /** a run starts driving this tab */
  register(wcId: number, runId: string, ask: DownloadAsk) { byWc.set(wcId, { runId, ask }); },
  /** the run ended: its tabs go back to normal download behaviour */
  unregisterRun(runId: string) { for (const [k, v] of byWc) if (v.runId === runId) byWc.delete(k); },
  isAgentTab(wcId: number) { return byWc.has(wcId); },
  /** tests point this at a temp dir */
  setQuarantineDir(dir: string | null) { quarantineOverride = dir; },
  quarantineDir(): string {
    const dir = quarantineOverride ?? path.join(app.getPath('userData'), 'agent-downloads');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  },
};

export type DownloadGate = {
  /** where the file is right now (quarantine until approved and finished, then the final path) */
  currentPath(): string;
  /** 'pending' until the user decides */
  decision(): 'pending' | 'approved' | 'denied';
  /** resolves once the file is in its final place (true) or removed (false) */
  settled: Promise<boolean>;
};

function fmtSize(n: number): string {
  if (!n || n < 0) return 'unknown size';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function rmQuiet(p: string) { try { fs.rmSync(p, { force: true }); } catch {} }

function moveFile(from: string, to: string) {
  try { fs.renameSync(from, to); } catch { fs.copyFileSync(from, to); rmQuiet(from); } // rename fails across drives
}

/** Removes quarantine leftovers older than a day (crash mid-approval). */
function purgeOld(dir: string) {
  if (purged) return; purged = true;
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try { if (Date.now() - fs.statSync(p).mtimeMs > 86_400_000) rmQuiet(p); } catch {}
    }
  } catch {}
}

/**
 * If `wc` is a tab an agent is driving, takes over the download: sets a quarantine save path, pauses
 * it, and asks the user. Returns null for normal (user) downloads; the caller then sets the save path.
 * Must be called synchronously inside `will-download`.
 */
export function gateAgentDownload(item: ElectronDownloadItem, wc: WebContents | null | undefined, finalPath: string, uniquePath: (p: string) => string = (p) => p): DownloadGate | null {
  const reg = wc && !wc.isDestroyed() ? byWc.get(wc.id) : undefined;
  if (!reg) return null;
  const dir = agentDownloads.quarantineDir();
  purgeOld(dir);
  const name = path.basename(finalPath);
  const qPath = path.join(dir, `${crypto.randomBytes(6).toString('hex')}-${name}`);
  item.setSavePath(qPath);
  item.pause();

  let state: 'pending' | 'approved' | 'denied' = 'pending';
  let where = qPath;
  let finished: 'completed' | 'cancelled' | 'interrupted' | null = null;
  let settle!: (v: boolean) => void;
  const settled = new Promise<boolean>((r) => { settle = r; });

  const finalize = () => {
    if (state === 'pending' || !finished) return;
    if (finished === 'completed' && state === 'approved') {
      const dest = uniquePath(finalPath);
      try { moveFile(qPath, dest); where = dest; settle(true); } catch { settle(false); }
    } else {
      rmQuiet(qPath);
      settle(false);
    }
  };

  item.once('done', (_e, st) => { finished = st; finalize(); });

  const url = item.getURL();
  reg.ask(`Download a file: ${name}`, `${fmtSize(item.getTotalBytes())} from ${url.length > 160 ? url.slice(0, 160) + '…' : url}. It stays in quarantine until you approve.`)
    .catch(() => false)
    .then((ok) => {
      state = ok ? 'approved' : 'denied';
      if (finished) { finalize(); return; }
      if (ok) item.resume();
      else { try { item.cancel(); } catch {} }
    });

  return { currentPath: () => where, decision: () => state, settled };
}
