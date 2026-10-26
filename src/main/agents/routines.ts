import { createHash } from 'crypto';
import { dataFor } from '../data';
import { uid } from '../store';
import type { Routine } from '../../shared/types';
import type { AgentRuntime } from './runner';

/** Routines: recurring companion tasks ("every morning at 8, brief me") and page-change triggers. */
export class RoutineScheduler {
  private timer: NodeJS.Timeout | null = null;
  private hashes = new Map<string, string>();

  constructor(private runtime: AgentRuntime, private profileIds: () => string[], private fetchText: (profileId: string, url: string) => Promise<string>) {}

  start() { this.stop(); this.timer = setInterval(() => this.tick().catch(() => {}), 30_000); setTimeout(() => this.tick().catch(() => {}), 5000); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  list(profileId: string) { return dataFor(profileId).routines.get(); }

  save(profileId: string, r: Partial<Routine>): Routine {
    const id = r.id || uid('r_');
    const prev = this.list(profileId).find((x) => x.id === id);
    const next: Routine = {
      id, name: r.name ?? prev?.name ?? 'Routine', companionId: r.companionId ?? prev?.companionId ?? 'hoot', task: r.task ?? prev?.task ?? '',
      schedule: r.schedule ?? prev?.schedule ?? { type: 'daily', time: '08:00' }, trigger: r.trigger ?? prev?.trigger ?? null,
      enabled: r.enabled ?? prev?.enabled ?? true, lastRunAt: prev?.lastRunAt, lastResult: prev?.lastResult,
    };
    next.nextRunAt = computeNext(next, Date.now());
    dataFor(profileId).routines.update((l) => { const i = l.findIndex((x) => x.id === id); if (i >= 0) l[i] = next; else l.push(next); });
    return next;
  }

  remove(profileId: string, id: string) { dataFor(profileId).routines.update((l) => l.filter((x) => x.id !== id)); }

  runNow(profileId: string, id: string) {
    const r = this.list(profileId).find((x) => x.id === id);
    if (r) this.fire(profileId, r);
  }

  private fire(profileId: string, r: Routine, extra = '') {
    const run = this.runtime.start(profileId, r.companionId, `[Routine: ${r.name}] ${r.task}${extra}`, { background: true, routineId: r.id });
    dataFor(profileId).routines.update((l) => { const x = l.find((y) => y.id === r.id); if (x) { x.lastRunAt = Date.now(); x.nextRunAt = computeNext(x, Date.now() + 1000); } });
    const onUpdate = (u: any) => {
      if (u.id !== run.id || !['done', 'failed', 'stopped'].includes(u.status)) return;
      this.runtime.off('update', onUpdate);
      dataFor(profileId).routines.update((l) => { const x = l.find((y) => y.id === r.id); if (x) x.lastResult = (u.result || u.status).slice(0, 500); });
    };
    this.runtime.on('update', onUpdate);
  }

  private async tick() {
    const now = Date.now();
    for (const pid of this.profileIds()) {
      for (const r of this.list(pid)) {
        if (!r.enabled) continue;
        if (r.trigger?.type === 'page-change') {
          if (r.lastRunAt && now - r.lastRunAt < 5 * 60_000) continue;
          try {
            const html = await this.fetchText(pid, r.trigger.url);
            const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
            const h = createHash('sha1').update(text).digest('hex');
            const key = pid + r.id;
            const prev = this.hashes.get(key);
            this.hashes.set(key, h);
            if (prev && prev !== h) this.fire(pid, r, `\n\nTrigger: the page ${r.trigger.url} changed.`);
          } catch {}
          continue;
        }
        if (r.nextRunAt && r.nextRunAt <= now) this.fire(pid, r);
        else if (!r.nextRunAt) this.save(pid, r);
      }
    }
  }
}

export function computeNext(r: Routine, from: number): number {
  const s = r.schedule;
  if (s.type === 'interval') return from + Math.max(5, s.minutes) * 60_000;
  const [hh, mm] = s.time.split(':').map(Number);
  const d = new Date(from);
  for (let i = 0; i < 8; i++) {
    const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, hh || 0, mm || 0, 0, 0);
    if (c.getTime() <= from) continue;
    if (s.days?.length && !s.days.includes(c.getDay())) continue;
    return c.getTime();
  }
  return from + 86400000;
}
