/** UI-only preferences kept in localStorage (profile colour). */
/** Tangent Owl amber (#E8A317) is the default profile colour. */
export const BRAND_HUE = 75;
class Prefs {
  hue = $state<number>(Number(localStorage.getItem('owl.hue') ?? BRAND_HUE));
  setHue(h: number) { this.hue = Math.round(h); localStorage.setItem('owl.hue', String(this.hue)); }
  /** warm hues (amber → lime) are light: they take dark ink and a higher lightness */
  private get warm() { return this.hue >= 40 && this.hue <= 125; }
  /** accent for the current theme; tuned to stay readable on both grounds */
  accent(dark: boolean) {
    if (this.hue === BRAND_HUE) return dark ? '#F0B13A' : '#E8A317';
    return this.warm ? `oklch(${dark ? 0.8 : 0.76} 0.16 ${this.hue})` : `oklch(${dark ? 0.7 : 0.6} 0.17 ${this.hue})`;
  }
  /** text/icon colour on top of the accent */
  accentInk() { return this.warm ? '#141317' : '#ffffff'; }
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
