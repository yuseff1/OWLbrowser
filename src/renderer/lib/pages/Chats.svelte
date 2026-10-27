<script lang="ts">
  import { onMount } from 'svelte';
  import type { TabState, AgentRun } from '$shared/types';
  import { owl } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { threads } from '$lib/threads.svelte';
  import { Button, Input, Select, Segmented, Empty, CompanionAvatar, Badge, IconButton } from '$lib/ui';
  import Page from './kit/Page.svelte';
  import Skel from './kit/Skel.svelte';
  import Note from './kit/Note.svelte';
  import { groupByDay, clock, statusMeta, isLive } from './kit/util';
  import { md, extLinks } from './kit/md';
  import { Search, MessagesSquare, Plus, RotateCcw, ChevronRight, PanelRight, Trash2, Bot } from '@lucide/svelte';

  let { tab }: { tab: TabState } = $props();

  type Msg = { me: boolean; text: string; runId?: string; error?: boolean };
  type Item = { key: string; kind: 'chat' | 'task'; companionId: string; title: string; preview: string; at: number; msgs: Msg[]; run?: AgentRun; threadId?: string };

  let loading = $state(store.runs.length === 0);
  let error = $state('');
  let q = $state('');
  let who = $state('all');
  let kind = $state<'all' | 'chat' | 'task'>('all');
  let openKey = $state<string | null>(null);

  async function load() {
    error = '';
    try { await store.refreshRuns(); } catch (e: any) { error = e?.message || 'Couldn’t load your tasks.'; }
    loading = false;
  }
  onMount(() => { load(); });

  const clean = (s: string) => s.replace(/[#*_`>|]/g, '').replace(/\s+/g, ' ').trim();
  function runMsgs(r: AgentRun): Msg[] {
    const out: Msg[] = [{ me: true, text: r.task }];
    for (const s of r.steps) {
      if (s.kind === 'user' && s.text && s.text !== r.task && !r.task.startsWith(s.text.replace(/…$/, ''))) out.push({ me: true, text: s.text });
      else if (s.kind === 'message') out.push({ me: false, text: s.text });
    }
    if (r.result) out.push({ me: false, text: r.result });
    else if (r.status === 'failed') { const err = [...r.steps].reverse().find((s) => s.kind === 'error'); if (err) out.push({ me: false, text: err.text, error: true }); }
    return out;
  }
  const runPreview = (r: AgentRun) => clean(r.result || [...r.steps].reverse().find((s) => s.kind === 'message' || s.kind === 'error' || s.kind === 'tool')?.text || '').slice(0, 160);

  const items = $derived.by<Item[]>(() => {
    const inThread = new Set<string>();
    const out: Item[] = [];
    for (const t of threads.list) {
      if (!t.messages.length) continue;
      const msgs: Msg[] = [];
      for (const m of t.messages) {
        if (m.runId) { inThread.add(m.runId); const r = store.runs.find((x) => x.id === m.runId); msgs.push({ me: false, text: r?.result || (r ? `Task ${statusMeta(r.status).label.toLowerCase()}.` : 'Task'), runId: m.runId }); }
        else msgs.push({ me: m.role === 'user', text: m.content, error: m.error });
      }
      const last = [...msgs].reverse().find((m) => !m.me);
      out.push({ key: 't:' + t.id, kind: 'chat', companionId: t.companionId, title: t.title || msgs[0]?.text || 'Chat', preview: clean(last?.text || '').slice(0, 160), at: t.updatedAt, msgs, threadId: t.id });
    }
    for (const r of store.runs) {
      if (inThread.has(r.id)) continue;
      out.push({ key: 'r:' + r.id, kind: 'task', companionId: r.companionId, title: r.task, preview: runPreview(r), at: r.startedAt, msgs: runMsgs(r), run: r });
    }
    return out.sort((a, b) => b.at - a.at);
  });
  const filtered = $derived.by(() => {
    const n = q.trim().toLowerCase();
    return items.filter((i) => (who === 'all' || i.companionId === who) && (kind === 'all' || i.kind === kind) && (!n || i.title.toLowerCase().includes(n) || i.msgs.some((m) => m.text.toLowerCase().includes(n))));
  });
  const groups = $derived(groupByDay(filtered, (i) => i.at));
  const companionItems = $derived([{ value: 'all', label: 'All companions' }, ...store.companions.filter((c) => items.some((i) => i.companionId === c.id)).map((c) => ({ value: c.id, label: c.name }))]);

  function continueIn(i: Item) {
    if (i.threadId) threads.open(i.threadId);
    else if (i.run) store.panelRunId = i.run.id;
    store.setCompanion(i.companionId);
    store.panelOpen = true;
  }
  function newChat() { threads.clear(); store.panelPrefill = ''; store.panelOpen = true; }
  function remove(i: Item) { if (i.threadId) { threads.remove(i.threadId); if (openKey === i.key) openKey = null; } }
</script>

<Page title="Chats" description="Your conversations and the tasks you gave companions, newest first.">
  {#snippet actions()}
    <Button variant="primary" icon={Plus} onclick={newChat}>New chat</Button>
  {/snippet}
  {#snippet toolbar()}
    <Input bind:value={q} icon={Search} pill placeholder="Search chats and tasks" class="w-[320px]" aria-label="Search chats" type="search" />
    <Segmented bind:value={kind} size="sm" label="Show" options={[{ value: 'all', label: 'All' }, { value: 'chat', label: 'Chats' }, { value: 'task', label: 'Tasks' }]} />
    <div class="flex-1"></div>
    <Select items={companionItems} bind:value={who} label="Companion" size="sm" class="w-[180px]" />
  {/snippet}

  {#if error}<Note kind="error" text={error} retry={load} class="mb-4" />{/if}

  {#if loading && !items.length}
    <div class="owl-sheet">{#each Array(5) as _, i (i)}<div class="flex items-center gap-3 px-4 py-3.5"><Skel w={28} h={28} r={99} /><div class="flex flex-1 flex-col gap-2"><Skel w="50%" h={13} /><Skel w="75%" h={11} /></div><Skel w={40} h={11} /></div>{/each}</div>
  {:else if !filtered.length}
    {#if q || who !== 'all' || kind !== 'all'}
      <Empty icon={Search} title="Nothing matches" body="Try other words, or clear the filters." compact>
        {#snippet actions()}<Button size="sm" variant="secondary" onclick={() => { q = ''; who = 'all'; kind = 'all'; }}>Clear filters</Button>{/snippet}
      </Empty>
    {:else}
      <Empty icon={MessagesSquare} title="No chats yet" body="Ask a companion anything from the new tab page, or press Ctrl+Shift+J on any site.">
        {#snippet actions()}<Button variant="primary" icon={Plus} onclick={newChat}>Start a chat</Button>{/snippet}
      </Empty>
    {/if}
  {:else}
    <div class="flex flex-col gap-6">
      {#each groups as g (g.key)}
        <section aria-label={g.label}>
          <h2 class="owl-group-label">{g.label}</h2>
          <div class="owl-sheet">
            {#each g.items as it (it.key)}
              {@const c = store.companions.find((x) => x.id === it.companionId)}
              {@const st = it.run ? statusMeta(it.run.status) : null}
              {@const open = openKey === it.key}
              <div>
                <button type="button" onclick={() => (openKey = open ? null : it.key)} aria-expanded={open} class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[color-mix(in_srgb,var(--ink)_2.5%,transparent)]">
                  <CompanionAvatar companion={it.companionId} size={28} />
                  <span class="min-w-0 flex-1">
                    <span class="flex items-center gap-2">
                      <span class="truncate text-[13.5px] font-medium">{it.title}</span>
                      {#if it.kind === 'task'}<Bot size={13} strokeWidth={1.8} class="shrink-0 text-ink-2" aria-label="Task" />{/if}
                    </span>
                    <span class="block truncate text-[12.5px] text-ink-2">{c?.name ?? 'Companion'}{it.preview ? ' — ' + it.preview : ''}</span>
                  </span>
                  {#if st && (st.live || it.run?.status === 'failed')}<Badge variant={st.variant} dot={st.live}>{st.label}</Badge>{/if}
                  <span class="tnum w-[64px] shrink-0 whitespace-nowrap text-right text-[12px] text-ink-2">{clock(it.at)}</span>
                  <ChevronRight size={15} class="text-ink-2 transition-transform {open ? 'rotate-90' : ''}" />
                </button>
                {#if open}
                  <div class="flex flex-col gap-3 border-t border-line bg-surface-2 px-5 py-4">
                    {#each it.msgs as m, i (i)}
                      {#if m.me}
                        <div class="ml-auto max-w-[78%] whitespace-pre-wrap rounded-[16px] rounded-br-md bg-ink px-3.5 py-2 text-[13.5px] leading-relaxed text-ground">{m.text}</div>
                      {:else}
                        <div class="flex max-w-[86%] items-start gap-2.5">
                          <CompanionAvatar companion={it.companionId} size={24} class="mt-0.5" />
                          <div class="owl-md rounded-[16px] rounded-tl-md bg-surface px-3.5 py-2.5 shadow-[0_0_0_1px_var(--line)] {m.error ? 'text-[#c4242a] dark:text-[#ff7a7e]' : ''}" use:extLinks>{@html md(m.text || '…')}</div>
                        </div>
                      {/if}
                    {/each}
                    <div class="mt-1 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="primary" icon={PanelRight} onclick={() => continueIn(it)}>{it.run && isLive(it.run) ? 'Follow in panel' : 'Continue'}</Button>
                      {#if it.run && !isLive(it.run)}<Button size="sm" variant="ghost" icon={RotateCcw} onclick={() => owl.startRun(it.run!.companionId, it.run!.task, { useCurrentTab: false, background: it.run!.background })}>Run again</Button>{/if}
                      <div class="flex-1"></div>
                      {#if it.threadId}<IconButton icon={Trash2} label="Delete chat" size="sm" onclick={() => remove(it)} />{/if}
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</Page>
