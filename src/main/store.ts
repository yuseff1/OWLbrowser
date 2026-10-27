import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const live = new Set<JsonStore<any>>();
let quitHooked = false;
/** Writes every store that still has a debounced write pending (also the ones main's quit sequence doesn't list). */
export function flushPendingStores() { for (const s of live) s.flushIfPending(); }
/**
 * Drops every store whose file lives under `dir` (a removed profile's folder): pending writes are
 * cancelled and later writes become no-ops, so nothing recreates the folder after it is deleted.
 */
export function disposeStoresUnder(dir: string): number {
  const norm = (p: string) => (process.platform === 'linux' ? p : p.toLowerCase());
  const prefix = norm(path.resolve(dir) + path.sep);
  let n = 0;
  for (const s of [...live]) if (norm(path.resolve(s.file)).startsWith(prefix)) { s.dispose(); n++; }
  return n;
}

/** Synchronous short pause (used only between retries of a failed rename on Windows). */
function pause(ms: number) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* not available */ } }

/** Tiny debounced JSON store. One file per store, atomic writes. */
export class JsonStore<T> {
  private data: T;
  private timer: NodeJS.Timeout | null = null;
  private disposed = false;
  readonly file: string;

  constructor(name: string, defaults: T, dir?: string) {
    const base = dir ?? app.getPath('userData');
    fs.mkdirSync(base, { recursive: true });
    this.file = path.join(base, `${name}.json`);
    this.data = defaults;
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        const okShape = Array.isArray(defaults) ? Array.isArray(raw) : !!raw && typeof raw === 'object' && !Array.isArray(raw);
        if (!okShape) throw new Error('unexpected JSON shape');
        this.data = Array.isArray(defaults) ? raw : { ...(defaults as any), ...raw };
      }
    } catch (e) {
      console.error('[store] failed to read', this.file, e);
      // Keep the unreadable file instead of silently overwriting it with defaults on the next write.
      try { fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch { /* gone / locked */ }
    }
    live.add(this);
    if (!quitHooked) {
      quitHooked = true;
      try { app.on('will-quit', flushPendingStores); } catch { /* no app (unit use) */ }
    }
  }

  /** stop writing this file for good (its folder is being deleted) */
  dispose() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } this.disposed = true; live.delete(this); }

  /** flush only if a debounced write is waiting */
  flushIfPending() { if (this.timer) this.flush(); }

  get(): T { return this.data; }

  set(next: T) { this.data = next; this.schedule(); }

  update(fn: (d: T) => T | void) {
    const r = fn(this.data);
    if (r !== undefined) this.data = r as T;
    this.schedule();
  }

  private schedule() {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.disposed) return;
    try {
      const tmp = this.file + '.tmp';
      const json = JSON.stringify(this.data);
      fs.writeFileSync(tmp, json);
      // Windows: antivirus / Search indexer briefly holding the target makes rename fail with EPERM/EBUSY/EACCES.
      for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(tmp, this.file); break; } catch (e: any) {
          const busy = e && (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES');
          if (!busy) throw e;
          if (attempt < 5) { pause(20 * (attempt + 1)); continue; }
          fs.writeFileSync(this.file, json); // last resort: non-atomic but not lost
          try { fs.rmSync(tmp, { force: true }); } catch {}
          break;
        }
      }
    } catch (e) {
      console.error('[store] failed to write', this.file, e);
    }
  }
}

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
