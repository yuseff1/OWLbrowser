<script lang="ts">
  /** Shift+Esc: every OWL process with its memory and CPU; tab renderers can be ended (the tab reloads when opened). */
  import Icon from '../ui/Icon.svelte';
  import { Dialog, Button } from '../ui';
  import { owl } from '../api';
  import { store } from '../stores.svelte';
  import type { IconName } from '../ui/icons';

  type TabRef = { id: number; title: string; favicon?: string; incognito: boolean; agent: boolean; sleeping: boolean; active: boolean };
  type Row = { pid: number; kind: 'tab' | 'ui' | 'browser' | 'gpu' | 'renderer' | 'utility'; type: string; name: string; memMB: number; cpu: number; tabs: TabRef[]; canEnd: boolean };
  type Snap = { rows: Row[]; totalMB: number; cpu: number; at: number };

  let snap = $state<Snap | null>(null);
  let sel = $state<number | null>(null);
  let sort = $state<{ key: 'name' | 'memMB' | 'cpu' | 'pid'; dir: 1 | -1 }>({ key: 'memMB', dir: -1 });
  let ended = $state<number[]>([]);

  async function load() { try { snap = (await (owl as any).taskManager()) as Snap; } catch { /* window closing */ } }
  $effect(() => {
    if (!store.taskManagerOpen) { sel = null; return; }
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  });

  const ORDER: Record<Row['kind'], number> = { browser: 0, gpu: 1, ui: 2, tab: 3, renderer: 4, utility: 5 };
  const rows = $derived.by(() => {
    const r = (snap?.rows ?? []).filter((x) => !ended.includes(x.pid));
    const k = sort.key, d = sort.dir;
    return [...r].sort((a, b) => (k === 'name' ? (ORDER[a.kind] - ORDER[b.kind]) || a.name.localeCompare(b.name) : (a[k] - b[k])) * (k === 'name' ? 1 : d));
  });
  const selected = $derived(rows.find((r) => r.pid === sel) ?? null);
  const ICON: Record<Row['kind'], IconName> = { browser: 'window', gpu: 'developer-board', ui: 'apps', tab: 'globe', renderer: 'document', utility: 'wrench' };
  const fmtMem = (mb: number) => (mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB');
  function by(key: typeof sort.key) { sort = sort.key === key ? { key, dir: (sort.dir * -1) as 1 | -1 } : { key, dir: key === 'name' ? 1 : -1 }; }
  async function end() {
    if (!selected?.canEnd) return;
    const pid = selected.pid;
    if (await (owl as any).endProcess(pid)) { ended = [...ended, pid]; sel = null; setTimeout(() => { ended = ended.filter((x) => x !== pid); load(); }, 1200); }
  }
  function onKey(e: KeyboardEvent) {
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.pid === sel);
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = rows[Math.min(rows.length - 1, i + 1)].pid; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = rows[Math.max(0, i - 1)].pid; }
    else if (e.key === 'Delete' && selected?.canEnd) { e.preventDefault(); end(); }
  }
</script>

<Dialog bind:open={store.taskManagerOpen} title="Task manager" width={720}>
  <div class="tm" role="grid" aria-label="OWL processes" tabindex="0" onkeydown={onKey}>
    <div class="hd" role="row">
      <button role="columnheader" class="c-name" aria-sort={sort.key === 'name' ? 'ascending' : 'none'} onclick={() => by('name')}>Task</button>
      <button role="columnheader" class="c-num" aria-sort={sort.key === 'memMB' ? (sort.dir < 0 ? 'descending' : 'ascending') : 'none'} onclick={() => by('memMB')}>Memory {#if sort.key === 'memMB'}<Icon name={sort.dir < 0 ? 'chevron-down' : 'chevron-up'} size={12} />{/if}</button>
      <button role="columnheader" class="c-num" aria-sort={sort.key === 'cpu' ? (sort.dir < 0 ? 'descending' : 'ascending') : 'none'} onclick={() => by('cpu')}>CPU {#if sort.key === 'cpu'}<Icon name={sort.dir < 0 ? 'chevron-down' : 'chevron-up'} size={12} />{/if}</button>
      <button role="columnheader" class="c-pid" onclick={() => by('pid')}>Process ID</button>
    </div>
    <div class="bd">
      {#if !snap}
        <div class="empty">Reading processes…</div>
      {/if}
      {#each rows as r (r.pid)}
        <div role="row" tabindex="-1" aria-selected={sel === r.pid} class="row" class:sel={sel === r.pid} onclick={() => (sel = r.pid)} ondblclick={() => { const t = r.tabs[0]; if (t && !t.incognito === !store.win.incognito) { owl.activateTab(t.id); store.taskManagerOpen = false; } }} onkeydown={() => {}}>
          <span class="c-name" role="gridcell">
            {#if r.kind === 'tab' && r.tabs[0]?.favicon}
              <img src={r.tabs[0].favicon} alt="" width="16" height="16" class="fav" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />
            {:else}
              <span class="ic"><Icon name={r.tabs[0]?.agent ? 'bot' : ICON[r.kind]} size={16} /></span>
            {/if}
            <span class="nm">
              {#if r.kind === 'tab'}<span class="pre">{r.tabs[0]?.agent ? 'Agent tab' : r.tabs[0]?.incognito ? 'Incognito tab' : 'Tab'}:</span>{/if}
              {r.name}
              {#if r.tabs.length > 1}<span class="pre"> (+{r.tabs.length - 1})</span>{/if}
            </span>
          </span>
          <span class="c-num tnum" role="gridcell">{fmtMem(r.memMB)}</span>
          <span class="c-num tnum" role="gridcell" class:hot={r.cpu >= 25}>{r.cpu.toFixed(1)}</span>
          <span class="c-pid tnum" role="gridcell">{r.pid}</span>
        </div>
      {/each}
    </div>
  </div>
  {#snippet footer()}
    <span class="mr-auto text-[12.5px] text-ink-3 tnum">{snap ? `${rows.length} processes · ${fmtMem(snap.totalMB)} · CPU ${snap.cpu.toFixed(1)}%` : ''}</span>
    <Button variant="danger" size="sm" disabled={!selected?.canEnd} onclick={end}>End process</Button>
  {/snippet}
</Dialog>

<style>
  .tm { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; outline: none; }
  .tm:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
  .hd, .row { display: grid; grid-template-columns: minmax(0, 1fr) 96px 64px 92px; align-items: center; }
  .hd { height: 32px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--ink) 3%, transparent); }
  .hd button { display: flex; align-items: center; gap: 4px; height: 100%; padding: 0 12px; border: 0; background: transparent; color: var(--ink-2); font: inherit; font-size: 12px; font-weight: 600; text-align: left; }
  .hd button:hover { color: var(--ink); }
  .hd .c-num, .hd .c-pid { justify-content: flex-end; }
  .bd { max-height: min(56vh, 460px); overflow-y: auto; }
  .row { height: 32px; font-size: 12.5px; color: var(--ink); cursor: default; }
  .row:nth-child(even) { background: color-mix(in srgb, var(--ink) 1.8%, transparent); }
  .row:hover { background: color-mix(in srgb, var(--ink) 5%, transparent); }
  .row.sel { background: color-mix(in srgb, var(--accent) 16%, transparent); }
  .row > span { padding: 0 12px; }
  .c-name { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .nm { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pre { color: var(--ink-3); }
  .ic { display: grid; place-items: center; color: var(--ink-3); flex: none; }
  .fav { border-radius: 3px; flex: none; }
  .c-num, .c-pid { text-align: right; color: var(--ink-2); }
  .hot { color: var(--ink); font-weight: 600; }
  .empty { padding: 24px; text-align: center; color: var(--ink-3); font-size: 13px; }
</style>
