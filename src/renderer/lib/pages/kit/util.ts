import type { AgentRun, AgentRunStatus, Companion, ModelProvider } from '$shared/types';
import { owl } from '$lib/api';

/** Open an internal page. From the new-tab page this replaces the tab in place (main closes the newtab). */
export function openPage(url: string, fromTabId?: number | null) {
  if (fromTabId != null) return owl.navigate(fromTabId, url);
  return owl.newTab(url);
}

export function startOfDay(t: number) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

export function dayLabel(t: number) {
  const today = startOfDay(Date.now());
  const d = startOfDay(t);
  if (d === today) return 'Today';
  if (d === today - 86400000) return 'Yesterday';
  const date = new Date(t);
  if (today - d < 6 * 86400000) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function groupByDay<T>(items: T[], at: (x: T) => number): Array<{ key: number; label: string; items: T[] }> {
  const out: Array<{ key: number; label: string; items: T[] }> = [];
  for (const it of items) {
    const k = startOfDay(at(it));
    let g = out.find((x) => x.key === k);
    if (!g) { g = { key: k, label: dayLabel(at(it)), items: [] }; out.push(g); }
    g.items.push(it);
  }
  return out.sort((a, b) => b.key - a.key);
}

export function clock(t: number) { return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }

export function fmtWhen(t?: number) {
  if (!t) return '—';
  const d = startOfDay(t), today = startOfDay(Date.now());
  if (d === today) return `Today ${clock(t)}`;
  if (d === today + 86400000) return `Tomorrow ${clock(t)}`;
  if (d === today - 86400000) return `Yesterday ${clock(t)}`;
  return `${new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${clock(t)}`;
}

export function fmtBytes(n: number) {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i <= 1 ? 0 : 1)} ${u[i]}`;
}

export function fmtDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

export const LIVE: AgentRunStatus[] = ['queued', 'running', 'waiting-approval', 'waiting-user', 'paused'];
export const isLive = (r: AgentRun) => LIVE.includes(r.status);

export function statusMeta(s: AgentRunStatus): { label: string; variant: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'outline'; live: boolean } {
  switch (s) {
    case 'queued': return { label: 'Queued', variant: 'neutral', live: true };
    case 'running': return { label: 'Working', variant: 'accent', live: true };
    case 'waiting-approval': return { label: 'Needs approval', variant: 'warn', live: true };
    case 'waiting-user': return { label: 'Has a question', variant: 'warn', live: true };
    case 'paused': return { label: 'Paused', variant: 'neutral', live: true };
    case 'done': return { label: 'Done', variant: 'ok', live: false };
    case 'failed': return { label: 'Failed', variant: 'danger', live: false };
    case 'stopped': return { label: 'Stopped', variant: 'outline', live: false };
    default: return { label: String(s), variant: 'neutral', live: false };
  }
}

/** Last meaningful step line of a run, for one-line previews. */
export function lastStep(r: AgentRun) {
  for (let i = r.steps.length - 1; i >= 0; i--) {
    const s = r.steps[i];
    if (s.text && s.kind !== 'user') return s.text.replace(/\s+/g, ' ').slice(0, 220);
  }
  return r.status === 'queued' ? 'Waiting for a free slot…' : 'Starting…';
}

export function companionOf(list: Companion[], id?: string) { return list.find((c) => c.id === id) ?? null; }

export function debounce<A extends any[]>(fn: (...a: A) => void, ms = 200) {
  let t: any;
  return (...a: A) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Value encoding used by model pickers: "<providerId>::<model>". */
export const refKey = (r?: { providerId: string; model: string } | null) => (r ? `${r.providerId}::${r.model}` : '');
export function parseRef(k: string) { const i = k.indexOf('::'); return i < 0 ? null : { providerId: k.slice(0, i), model: k.slice(i + 2) }; }

export function modelGroups(providers: ModelProvider[]) {
  return providers.filter((p) => p.enabled && p.models.length).map((p) => ({
    heading: p.name,
    items: p.models.map((m) => ({ value: `${p.id}::${m}`, label: m })),
  }));
}

export const COMPANION_SWATCHES = ['#4C6FFF', '#FF9A3D', '#2FCB94', '#FF6F91', '#C2622D', '#14B8C4', '#F5B83D', '#9AA3B5'];

/** Mix a hex colour toward white (amt > 0) or black (amt < 0). */
export function shade(hex: string, amt: number) {
  const n = parseInt(hex.replace('#', ''), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/** Heuristic: does the composer text look like something to open rather than a task? */
export function looksLikeUrl(s: string) {
  const t = s.trim();
  if (!t || /\s/.test(t)) return false;
  return /^(https?|file|owl|about):/i.test(t) || /^localhost(:\d+)?(\/|$)/i.test(t) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(t) || /^[^\s]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(t);
}
