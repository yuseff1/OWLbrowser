<script lang="ts">
  import type { AgentRun, AgentStep } from '$shared/types';
  import { owl } from '../api';
  import { store } from '../stores.svelte';
  import { Badge, Button, Input, Dialog, Spinner } from '../ui';
  import { markdown } from '../markdown';
  import { statusLabel, statusVariant, runLive, elapsed } from './prefs.svelte';
  import {
    Globe, MousePointerClick, Keyboard, FileText, Search, Camera, Check, CircleAlert, User, ShieldQuestion, Wrench,
    Hand, Play, Square, CornerDownLeft, ArrowUpRight, ScrollText, Brain,
  } from '@lucide/svelte';

  let { run, showTask = false }: { run: AgentRun; showTask?: boolean } = $props();

  const live = $derived(runLive(run.status));
  const name = $derived(store.companions.find((c) => c.id === run.companionId)?.name ?? 'Agent');
  let now = $state(Date.now());
  $effect(() => { if (!live) return; const t = setInterval(() => (now = Date.now()), 1000); return () => clearInterval(t); });

  let expanded = $state(false);
  const LIMIT = 6;
  const steps = $derived(expanded ? run.steps : run.steps.slice(-LIMIT));
  const hidden = $derived(run.steps.length - steps.length);

  let answer = $state('');
  let follow = $state('');
  let shot = $state<string | null>(null);
  let shotOpen = $state(false);

  function toolIcon(s: AgentStep) {
    const t = (s.tool || '').toLowerCase();
    if (/nav|open|goto|url/.test(t)) return Globe;
    if (/click|tap|press/.test(t)) return MousePointerClick;
    if (/type|fill|input|key/.test(t)) return Keyboard;
    if (/search|find/.test(t)) return Search;
    if (/shot|capture|vision/.test(t)) return Camera;
    if (/scroll/.test(t)) return ScrollText;
    if (/read|extract|text|page/.test(t)) return FileText;
    if (/memory|remember/.test(t)) return Brain;
    return Wrench;
  }
  function sendAnswer() { if (!answer.trim()) return; owl.answerRun(run.id, answer.trim()); answer = ''; }
  function sendFollow() { if (!follow.trim()) return; owl.followUp(run.id, follow.trim()); follow = ''; }
  function openTab() { const id = run.tabIds?.[0]; if (id != null) owl.activateTab(id); }
</script>

<div class="run">
  <div class="head">
    <Badge variant={statusVariant(run.status)} dot pulse={run.status === 'running'}>{statusLabel(run.status)}</Badge>
    <span class="meta tnum">{elapsed(run.startedAt, run.endedAt ?? now)}</span>
    {#if run.tabIds?.length && run.tabIds[0] !== store.win.activeTabId}
      <button class="lnk" onclick={openTab}>Open tab <ArrowUpRight size={12} strokeWidth={2} /></button>
    {/if}
  </div>
  {#if showTask}<p class="task">{run.task}</p>{/if}

  <ol class="steps">
    {#if hidden > 0}
      <li><button class="more" onclick={() => (expanded = true)}>Show {hidden} earlier step{hidden === 1 ? '' : 's'}</button></li>
    {/if}
    {#each steps as s, i (s.t + ':' + i)}
      <li class="step {s.kind}">
        {#if s.kind === 'message'}
          <div class="owl-prose">{@html markdown(s.text)}</div>
        {:else if s.kind === 'thought'}
          <span class="thought">{s.text}</span>
        {:else}
          <span class="ic">
            {#if s.kind === 'tool'}{@const I = toolIcon(s)}<I size={13} strokeWidth={1.8} />
            {:else if s.kind === 'result'}<Check size={13} strokeWidth={2} />
            {:else if s.kind === 'error'}<CircleAlert size={13} strokeWidth={1.9} />
            {:else if s.kind === 'approval'}<ShieldQuestion size={13} strokeWidth={1.8} />
            {:else if s.kind === 'user'}<User size={13} strokeWidth={1.8} />{/if}
          </span>
          <span class="txt">{s.kind === 'user' ? `You: ${s.text}` : s.text}</span>
        {/if}
        {#if s.image}
          <button class="thumb" onclick={() => { shot = s.image!; shotOpen = true; }} aria-label="View screenshot">
            <img src={s.image} alt="Screenshot from step" loading="lazy" />
          </button>
        {/if}
      </li>
    {/each}
    {#if run.status === 'running'}
      <li class="step working"><span class="ic"><Spinner size={12} /></span><span class="txt">{name} is working…</span></li>
    {/if}
  </ol>

  {#if run.pendingApproval}
    <div class="card warn" role="group" aria-label="Approval needed">
      <div class="ct"><ShieldQuestion size={15} strokeWidth={1.8} /> {name} wants to {run.pendingApproval.action.charAt(0).toLowerCase() + run.pendingApproval.action.slice(1)}</div>
      {#if run.pendingApproval.detail}<p class="cd">{run.pendingApproval.detail}</p>{/if}
      <div class="ca">
        <Button size="sm" variant="primary" icon={Check} onclick={() => owl.approveRun(run.id, true)}>Approve</Button>
        <Button size="sm" variant="secondary" onclick={() => owl.approveRun(run.id, false)}>Deny</Button>
      </div>
    </div>
  {/if}

  {#if run.pendingQuestion}
    <div class="card" role="group" aria-label="Question from {name}">
      <div class="ct">{run.pendingQuestion.question}</div>
      <form class="mt-2 flex gap-2" onsubmit={(e) => { e.preventDefault(); sendAnswer(); }}>
        <Input size="sm" class="flex-1" placeholder="Your answer…" bind:value={answer} aria-label="Answer" />
        <Button size="sm" variant="primary" type="submit" disabled={!answer.trim()}>Send</Button>
      </form>
    </div>
  {/if}

  {#if run.status === 'done' && run.result}
    <div class="final owl-prose">{@html markdown(run.result)}</div>
  {/if}

  {#if live}
    <div class="ctl">
      {#if run.status === 'paused'}
        <Button size="sm" variant="secondary" icon={Play} onclick={() => owl.takeover(run.id, false)}>Resume</Button>
      {:else}
        <Button size="sm" variant="secondary" icon={Hand} onclick={() => { owl.takeover(run.id, true); openTab(); }}>Take over</Button>
      {/if}
      <Button size="sm" variant="ghost" icon={Square} onclick={() => owl.stopRun(run.id)}>Stop</Button>
    </div>
    <form class="follow" onsubmit={(e) => { e.preventDefault(); sendFollow(); }}>
      <input bind:value={follow} placeholder="Queue a follow-up…" aria-label="Queue a follow-up for {name}" />
      <button type="submit" aria-label="Queue follow-up" disabled={!follow.trim()}><CornerDownLeft size={13} strokeWidth={2} /></button>
    </form>
  {/if}
</div>

<Dialog bind:open={shotOpen} title="Screenshot" width={860}>
  {#if shot}<img src={shot} alt="Agent screenshot" class="w-full rounded-xl" />{/if}
</Dialog>

<style>
  .run { display: flex; flex-direction: column; gap: 8px; }
  .head { display: flex; align-items: center; gap: 8px; }
  .meta { font-size: 11.5px; color: var(--ink-3); }
  .lnk { margin-left: auto; display: inline-flex; align-items: center; gap: 3px; font-size: 12px; color: var(--ink-2); background: transparent; border: 0; padding: 2px 4px; border-radius: 6px; }
  .lnk:hover { color: var(--ink); background: color-mix(in srgb, var(--ink) 6%, transparent); }
  .task { font-size: 13px; color: var(--ink); }
  .steps { list-style: none; margin: 0; padding: 0 0 0 2px; display: flex; flex-direction: column; gap: 2px; position: relative; }
  .steps::before { content: ''; position: absolute; left: 11px; top: 6px; bottom: 6px; width: 1px; background: var(--line); }
  .step { position: relative; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding: 3px 0; font-size: 12.5px; color: var(--ink-2); line-height: 1.45; }
  .ic { position: relative; z-index: 1; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 99px; background: var(--surface); box-shadow: 0 0 0 1px var(--line); color: var(--ink-2); flex: none; }
  .step.result .ic { color: #2f8f5b; }
  .step.error .ic, .step.error .txt { color: #d43a3f; }
  .step.user .txt { color: var(--ink); }
  .txt { flex: 1; min-width: 0; padding-top: 1px; }
  .thought { padding-left: 28px; font-size: 12px; color: var(--ink-3); }
  .step.message { padding-left: 28px; color: var(--ink); font-size: 13px; }
  .step.message .owl-prose { width: 100%; }
  .thumb { margin-left: 28px; display: block; border: 0; padding: 0; background: none; border-radius: 9px; overflow: hidden; box-shadow: 0 0 0 1px var(--line); }
  .thumb img { display: block; height: 72px; width: auto; max-width: 220px; object-fit: cover; }
  .more { margin-left: 28px; font-size: 12px; color: var(--ink-3); background: transparent; border: 0; padding: 2px 0; }
  .more:hover { color: var(--ink); }
  .card { padding: 12px; border-radius: 14px; background: var(--surface); box-shadow: 0 0 0 1px var(--line), 0 4px 14px -6px rgba(0,0,0,.12); }
  .card.warn { box-shadow: 0 0 0 1px color-mix(in srgb, #f5a524 45%, transparent), 0 4px 14px -6px rgba(0,0,0,.12); }
  .ct { display: flex; align-items: flex-start; gap: 7px; font-size: 13px; font-weight: 500; color: var(--ink); }
  .ct :global(svg) { margin-top: 2px; flex: none; color: #c27c0e; }
  .cd { margin-top: 6px; font-size: 12.5px; color: var(--ink-2); line-height: 1.5; }
  .ca { display: flex; gap: 6px; margin-top: 10px; }
  .final { padding: 10px 12px; border-radius: 12px; background: color-mix(in srgb, #30a46c 8%, var(--surface)); font-size: 13px; }
  .ctl { display: flex; gap: 6px; }
  .follow { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 4px 0 12px; border-radius: 99px; background: color-mix(in srgb, var(--ink) 5%, transparent); }
  .follow input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; font-size: 12.5px; }
  .follow input::placeholder { color: var(--ink-3); }
  .follow button { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 99px; border: 0; background: var(--ink); color: var(--ground); }
  .follow button:disabled { opacity: .3; }
</style>
