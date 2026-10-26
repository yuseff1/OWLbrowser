import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/** Tiny debounced JSON store. One file per store, atomic writes. */
export class JsonStore<T> {
  private data: T;
  private timer: NodeJS.Timeout | null = null;
  readonly file: string;

  constructor(name: string, defaults: T, dir?: string) {
    const base = dir ?? app.getPath('userData');
    fs.mkdirSync(base, { recursive: true });
    this.file = path.join(base, `${name}.json`);
    this.data = defaults;
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = Array.isArray(defaults) ? raw : { ...(defaults as any), ...raw };
      }
    } catch (e) {
      console.error('[store] failed to read', this.file, e);
    }
  }

  get(): T { return this.data; }

  set(next: T) { this.data = next; this.schedule(); }

  update(fn: (d: T) => T | void) {
    const r = fn(this.data);
    if (r !== undefined) this.data = r as T;
    this.schedule();
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] failed to write', this.file, e);
    }
  }
}

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
