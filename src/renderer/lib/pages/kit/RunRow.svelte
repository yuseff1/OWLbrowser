<script lang="ts">
  /** One agent run as an expandable row (used by Agents and Chats). Not a routed page. */
  import type { AgentRun, AgentStep } from '$shared/types';
  import { owl } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Badge, Button, CompanionAvatar, Input } from '$lib/ui';
  import { statusMeta, lastStep, fmtDuration, clock, isLive } from './util';
  import { md, extLinks } from './md';
  import { ChevronRight, Square, ExternalLink, CornerDownRight, Check, X, AppWindow, Brain, Wrench, MessageSquare, CircleAlert, ShieldQuestion, User, Flag, RotateCcw } from '@lucide/svelte';

  let { run, now, expanded = false, onToggle }: { run: AgentRun; now: number; expanded?: boolean; onToggle?: () => void } = $props();

  const st = $derived(statusMeta(run.status));
  const live = $derived(isLive(run));
  const companion = $derived(store.companions.find((c) => c.id === run.companionId));
  const openTabs = $derived(run.tabIds.filter((id) => store.win.tabs.some((t) => t.id === id)));
  const elapsed = $derived((run.endedAt ?? now) - run.startedAt);

  let follow = $state('');
  let answer = $state('');
  let busy = $state(false);

  const stepIcon: Record<AgentStep['kind'], any> = { thought: Brain, tool: Wrench, result: Flag, message: MessageSquare, error: CircleAlert, approval: ShieldQuestion, user: User };

  async function act(fn: () => Promise<any>, fail: string) {
    busy = true;
    try { await fn(); } catch (e: any) { store.toast(fail, e?.message, 'error'); }
    busy = false;
  }
  const stop = () => act(() => owl.stopRun(run.id), 'Couldn’t stop the run');
  const approve = (ok: boolean) => act(() => owl.approveRun(run.id, ok), 'Couldn’t send your answer');
  const sendAnswer = () => { const t = answer.trim(); if (t) act(async () => { await owl.answerRun(run.id, t); answer = ''; }, 'Couldn’t send your answer'); };
  const sendFollow = () => { const t = follow.trim(); if (t) act(async () => { await owl.followUp(run.id, t); follow = ''; store.toast('Follow-up sent', `${companion?.name ?? 'Your companion'} will pick it up.`); }, 'Couldn’t send the follow-up'); };
  const again = () => act(() => owl.startRun(run.companionId, run.task, { useCurrentTab: false, background: run.background }), 'Couldn’t start the run');
  function openRun() { if (openTabs[0] != null) owl.activateTab(openTabs[0]); store.panelRunId = run.id; store.panelOpen = true; }
</script>

<div class="owl-hoverable">
  <div class="flex items-start gap-3 px-4 py-3.5">
    <button type="button" onclick={onToggle} aria-expanded={expanded} aria-controls="run-{run.id}" class="flex min-w-0 flex-1 items-start gap-3 text-left">
      <CompanionAvatar companion={run.companionId} size={32} status={run.status === 'running' ? 'running' : live ? 'waiting' : null} />
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-2">
          <span class="truncate text-[13.5px] font-medium">{run.task}</span>
        </span>
        <span class="mt-0.5 flex items-center gap-2 text-[12.5px] text-ink-2">
          <span class="shrink-0">{companion?.name ?? 'Companion'}</span>
          <span aria-hidden="true">·</span>
          <span class="truncate">{live ? lastStep(run) : run.status === 'done' && run.result ? run.result.replace(/[#*_`>|\-]/g, '').replace(/\s+/g, ' ').slice(0, 140) : lastStep(run)}</span>
        </span>
      </span>
    </button>
    <div class="flex shrink-0 items-center gap-2.5 pt-0.5">
      {#if run.tabIds.length}<span class="flex items-center gap-1 text-[12px] text-ink-2" title="{run.tabIds.length} tabs"><AppWindow size={13} strokeWidth={1.8} /><span class="tnum">{run.tabIds.length}</span></span>{/if}
      <span class="tnum w-[64px] whitespace-nowrap text-right text-[12px] text-ink-2">{live ? fmtDuration(elapsed) : clock(run.endedAt ?? run.startedAt)}</span>
      <Badge variant={st.variant} dot={live} pulse={run.status === 'running'}>{st.label}</Badge>
      <button type="button" onclick={onToggle} aria-label={expanded ? 'Collapse' : 'Expand'} class="grid size-7 place-items-center rounded-lg text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]">
        <ChevronRight size={15} class="transition-transform {expanded ? 'rotate-90' : ''}" />
      </button>
    </div>
  </div>

  {#if run.status === 'waiting-approval' && run.pendingApproval}
    <div class="mx-4 mb-3 ml-[60px] flex items-center gap-3 rounded-xl bg-[color-mix(in_srgb,#e8742a_10%,transparent)] px-3 py-2.5">
      <ShieldQuestion size={16} class="shrink-0 text-[#b7740b]" />
      <div class="min-w-0 flex-1 text-[13px]"><span class="font-medium">{run.pendingApproval.action}</span> <span class="text-ink-2">{run.pendingApproval.detail}</span></div>
      <Button size="sm" variant="ghost" icon={X} disabled={busy} onclick={() => approve(false)}>Deny</Button>
      <Button size="sm" variant="primary" icon={Check} disabled={busy} onclick={() => approve(true)}>Allow</Button>
    </div>
  {:else if run.status === 'waiting-user' && run.pendingQuestion}
    <form class="mx-4 mb-3 ml-[60px] rounded-xl bg-[color-mix(in_srgb,#e8742a_10%,transparent)] p-3" onsubmit={(e) => { e.preventDefault(); sendAnswer(); }}>
      <p class="mb-2 text-[13px]">{run.pendingQuestion.question}</p>
      <div class="flex gap-2"><Input bind:value={answer} size="sm" placeholder="Your answer" class="flex-1" aria-label="Answer" /><Button size="sm" variant="primary" type="submit" disabled={busy || !answer.trim()}>Reply</Button></div>
    </form>
  {/if}

  {#if expanded}
    <div id="run-{run.id}" class="ml-[60px] mr-4 pb-4">
      {#if run.result}
        <div class="owl-md mb-4 rounded-xl bg-surface-2 p-3.5" use:extLinks>{@html md(run.result)}</div>
      {/if}
      <ol class="relative flex flex-col gap-2.5 border-l border-line pl-4" aria-label="Steps">
        {#each run.steps as s, i (i)}
          {@const I = stepIcon[s.kind] ?? Wrench}
          <li class="relative text-[12.5px] leading-snug">
            <span class="absolute -left-[25px] top-0 grid size-[17px] place-items-center rounded-full bg-surface text-ink-2 shadow-[0_0_0_1px_var(--line)]" class:!text-[#d43a3f]={s.kind === 'error'}><I size={10} strokeWidth={2} /></span>
            <div class="flex gap-2">
              <span class="tnum w-[60px] shrink-0 whitespace-nowrap text-ink-2">{clock(s.t)}</span>
              <span class="min-w-0 flex-1 {s.kind === 'thought' ? 'text-ink-2' : 'text-ink'}">{s.kind === 'user' ? 'You: ' : ''}{s.text}</span>
            </div>
            {#if s.image}<img src={s.image} alt="Screenshot from this step" class="ml-[68px] mt-1.5 max-h-[120px] rounded-lg shadow-[0_0_0_1px_var(--line)]" />{/if}
          </li>
        {/each}
      </ol>
      <div class="mt-4 flex flex-wrap items-center gap-2">
        {#if live}
          <Button size="sm" variant="secondary" icon={ExternalLink} onclick={openRun}>Open</Button>
          <Button size="sm" variant="danger" icon={Square} disabled={busy} onclick={stop}>Stop</Button>
          <form class="flex min-w-[260px] flex-1 gap-2" onsubmit={(e) => { e.preventDefault(); sendFollow(); }}>
            <Input bind:value={follow} size="sm" icon={CornerDownRight} placeholder="Add an instruction while it works" class="flex-1" aria-label="Follow-up instruction" />
            <Button size="sm" variant="secondary" type="submit" disabled={busy || !follow.trim()}>Send</Button>
          </form>
        {:else}
          <Button size="sm" variant="secondary" icon={RotateCcw} disabled={busy} onclick={again}>Run again</Button>
          <form class="flex min-w-[260px] flex-1 gap-2" onsubmit={(e) => { e.preventDefault(); sendFollow(); }}>
            <Input bind:value={follow} size="sm" icon={CornerDownRight} placeholder="Follow up on this" class="flex-1" aria-label="Follow-up" />
            <Button size="sm" variant="secondary" type="submit" disabled={busy || !follow.trim()}>Send</Button>
          </form>
        {/if}
      </div>
      <p class="tnum mt-3 text-[12px] text-ink-2">{fmtDuration(elapsed)} · {run.tokens.toLocaleString()} tokens{run.background ? ' · background' : ''}</p>
    </div>
  {/if}
</div>
