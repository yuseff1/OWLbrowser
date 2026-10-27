/**
 * Auto-update from GitHub releases (electron-updater, github provider).
 *
 * Release layout (see .github/workflows/desktop-windows.yml):
 *   - every main build publishes a real release `v<major>.<minor>.<run_number>` (prerelease=false, marked latest)
 *     with OWL-Setup-<version>.exe, its .blockmap and latest.yml. electron-updater resolves
 *     github.com/<owner>/<repo>/releases/latest → that tag → latest.yml.
 *   - the `nightly` prerelease keeps stable asset names for the README download link; the updater never reads it.
 *
 * The app is unsigned: app-update.yml has no publisherName, so NsisUpdater skips Authenticode checks.
 * We also install a no-op verifier so a future partially-configured signing setup can't brick updates.
 *
 * Only the NSIS-installed Windows build installs updates. The portable ZIP (no uninstaller next to OWL.exe)
 * and unpackaged/dev runs only report status; the portable build gets a download link instead.
 */
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';
import { logLine } from './crash';

export type UpdateState = 'disabled' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  /** version offered by the latest release, once known */
  version?: string;
  releaseName?: string;
  releaseDate?: string;
  /** 0–100 while downloading */
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  error?: string;
  /** epoch ms of the last finished check */
  checkedAt?: number;
  /** true when installUpdate() would restart into the new version right now */
  canInstall: boolean;
  /** this build can download+install by itself (NSIS install on Windows) */
  autoInstallSupported: boolean;
  /** why the updater is off or install-less ('dev', 'portable', 'platform') */
  reason?: 'dev' | 'portable' | 'platform';
  /** where to get the new version manually (portable builds) */
  downloadUrl: string;
}

export interface UpdaterHooks {
  /** every status change (broadcast to UIs as event 'update') */
  onStatus(s: UpdateStatus): void;
  /** an update finished downloading and can be installed with a restart */
  onReady(s: UpdateStatus): void;
}

const RELEASES_URL = 'https://github.com/yuseff1/OWLbrowser/releases/latest';
const CHECK_EVERY_MS = 4 * 3600_000;
const FIRST_CHECK_DELAY_MS = 20_000; // let startup (session restore, adblock lists) settle first

type Mode = { enabled: true; autoInstall: boolean; reason?: 'portable' } | { enabled: false; reason: 'dev' | 'platform' };

function detectMode(): Mode {
  if (!app.isPackaged) return { enabled: false, reason: 'dev' };
  if (process.platform === 'win32') {
    // electron-builder's NSIS installer puts "Uninstall <productName>.exe" next to the exe; the ZIP build has none.
    const dir = path.dirname(process.execPath);
    let installed = false;
    try { installed = fs.readdirSync(dir).some((f) => /^Uninstall .+\.exe$/i.test(f)); } catch { /* unreadable: treat as portable */ }
    return installed ? { enabled: true, autoInstall: true } : { enabled: true, autoInstall: false, reason: 'portable' };
  }
  if (process.platform === 'linux' && process.env.APPIMAGE) return { enabled: true, autoInstall: true };
  return { enabled: false, reason: 'platform' };
}

class Updater {
  private mode: Mode = { enabled: false, reason: 'dev' };
  private hooks: UpdaterHooks | null = null;
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<UpdateStatus> | null = null;
  private status: UpdateStatus = this.base('disabled');

  private base(state: UpdateState): UpdateStatus {
    return { state, currentVersion: app.getVersion(), canInstall: false, autoInstallSupported: false, downloadUrl: RELEASES_URL };
  }

  private set(patch: Partial<UpdateStatus>) {
    this.status = { ...this.status, ...patch, currentVersion: app.getVersion() };
    this.status.canInstall = this.status.state === 'downloaded' && this.mode.enabled && this.mode.autoInstall;
    try { this.hooks?.onStatus(this.get()); } catch (e) { logLine('warn', 'updater onStatus', e); }
  }

  get(): UpdateStatus { return { ...this.status }; }

  /** Wire events and schedule checks. Safe to call once after app 'ready'. */
  start(hooks: UpdaterHooks) {
    if (this.hooks) return;
    this.hooks = hooks;
    this.mode = detectMode();
    const autoInstallSupported = this.mode.enabled && this.mode.autoInstall;
    this.status = { ...this.base(this.mode.enabled ? 'idle' : 'disabled'), autoInstallSupported, reason: this.mode.reason };
    if (!this.mode.enabled) { logLine('info', `updater off (${this.mode.reason})`); return; }

    autoUpdater.logger = {
      info: (m: unknown) => logLine('info', `[updater] ${String(m)}`),
      warn: (m: unknown) => logLine('warn', `[updater] ${String(m)}`),
      error: (m: unknown) => logLine('error', `[updater] ${String(m)}`),
      debug: () => {},
    };
    autoUpdater.autoDownload = autoInstallSupported; // background download only where we can install it
    autoUpdater.autoInstallOnAppQuit = autoInstallSupported; // a downloaded update also lands on a normal quit
    autoUpdater.allowPrerelease = false; // `nightly` is a prerelease; only v* releases are update sources
    autoUpdater.allowDowngrade = false;
    autoUpdater.fullChangelog = false;
    // Unsigned builds: never let a signature check block an update (NSIS only; other updaters lack the setter).
    const nsis = autoUpdater as unknown as { verifyUpdateCodeSignature?: unknown };
    if (process.platform === 'win32' && 'verifyUpdateCodeSignature' in nsis) nsis.verifyUpdateCodeSignature = async () => null;

    const info = (i: UpdateInfo) => ({ version: i.version, releaseName: i.releaseName ?? undefined, releaseDate: i.releaseDate });
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', error: undefined }));
    autoUpdater.on('update-available', (i: UpdateInfo) => this.set({ state: autoInstallSupported ? 'downloading' : 'available', ...info(i), percent: 0, checkedAt: Date.now() }));
    autoUpdater.on('update-not-available', (i: UpdateInfo) => {
      // keep an already-downloaded update installable if a later check finds nothing newer
      if (this.status.state === 'downloaded') return this.set({ checkedAt: Date.now() });
      this.set({ state: 'not-available', ...info(i), percent: undefined, checkedAt: Date.now() });
    });
    autoUpdater.on('download-progress', (p: ProgressInfo) => this.set({ state: 'downloading', percent: Math.round(p.percent), bytesPerSecond: p.bytesPerSecond, transferred: p.transferred, total: p.total }));
    autoUpdater.on('update-downloaded', (i: UpdateInfo) => {
      this.set({ state: 'downloaded', ...info(i), percent: 100 });
      try { this.hooks?.onReady(this.get()); } catch (e) { logLine('warn', 'updater onReady', e); }
    });
    autoUpdater.on('error', (e: Error) => {
      const msg = (e?.message || String(e)).split('\n')[0].slice(0, 300);
      logLine('warn', 'updater error', e);
      // a failed re-check must not hide an update that is already on disk
      if (this.status.state === 'downloaded') return this.set({ error: msg });
      this.set({ state: 'error', error: msg, checkedAt: Date.now() });
    });

    setTimeout(() => { this.check().catch(() => {}); }, FIRST_CHECK_DELAY_MS).unref();
    this.timer = setInterval(() => { this.check().catch(() => {}); }, CHECK_EVERY_MS);
    this.timer.unref();
  }

  /** Check now (and download in the background when supported). Never throws; errors land in status.error. */
  check(): Promise<UpdateStatus> {
    if (!this.mode.enabled) return Promise.resolve(this.get());
    if (this.inflight) return this.inflight;
    if (this.status.state === 'downloading') return Promise.resolve(this.get());
    this.inflight = (async () => {
      try {
        const r = await autoUpdater.checkForUpdates();
        // with autoDownload the result resolves before the download ends; wait for the download only if asked by events
        if (r?.downloadPromise) r.downloadPromise.catch(() => { /* reported via 'error' */ });
      } catch (e: any) {
        if (this.status.state !== 'error' && this.status.state !== 'downloaded') this.set({ state: 'error', error: String(e?.message || e).split('\n')[0].slice(0, 300), checkedAt: Date.now() });
      } finally {
        this.inflight = null;
      }
      return this.get();
    })();
    return this.inflight;
  }

  /** Restart into the downloaded update. Returns false when nothing is ready to install. */
  install(): boolean {
    if (!this.status.canInstall) return false;
    logLine('info', `installing update ${this.status.version}`);
    // silent install into the same directory, then relaunch OWL. app.quit() runs our before-quit (session save).
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

export const updater = new Updater();
