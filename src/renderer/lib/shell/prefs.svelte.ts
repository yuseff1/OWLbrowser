/** UI-only preferences kept in localStorage (profile colour). */
class Prefs {
  hue = $state<number>(Number(localStorage.getItem('owl.hue') ?? 248));
  setHue(h: number) { this.hue = Math.round(h); localStorage.setItem('owl.hue', String(this.hue)); }
  /** accent for the current theme; tuned to stay readable on both grounds */
  accent(dark: boolean) { return `oklch(${dark ? 0.7 : 0.6} 0.17 ${this.hue})`; }
}
export const prefs = new Prefs();

export const runLive = (s: string) => ['queued', 'running', 'waiting-approval', 'waiting-user', 'paused'].includes(s);
export const runWaiting = (s: string) => s === 'waiting-approval' || s === 'waiting-user';

export function statusLabel(s: string) {
  return ({ queued: 'Queued', running: 'Working', 'waiting-approval': 'Needs approval', 'waiting-user': 'Has a question', paused: 'You’re in control', done: 'Done', failed: 'Failed', stopped: 'Stopped' } as Record<string, string>)[s] ?? s;
}
export function statusVariant(s: string): 'accent' | 'warn' | 'ok' | 'danger' | 'neutral' {
  if (s === 'running' || s === 'queued') return 'accent';
  if (runWaiting(s) || s === 'paused') return 'warn';
  if (s === 'done') return 'ok';
  if (s === 'failed') return 'danger';
  return 'neutral';
}
export function elapsed(from: number, to = Date.now()) {
  const s = Math.max(0, Math.round((to - from) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
