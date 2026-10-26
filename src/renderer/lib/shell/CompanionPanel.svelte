<script lang="ts">
  import { owl, faviconFor } from '../api';
  import { store } from '../stores.svelte';
  import { threads } from '../threads.svelte';
  import { markdown } from '../markdown';
  import { IconButton, Menu, CompanionAvatar, Segmented, Textarea, Tooltip, type MenuItem } from '../ui';
  import { SquarePen, History, Ellipsis, X, ArrowUp, Plus, Globe, MessageCircle, Zap, ChevronDown, Users, Settings2, Trash2, Check } from '@lucide/svelte';
  import RunView from './RunView.svelte';
  import { runLive } from './prefs.svelte';

  const MIN = 340, MAX = 560;
  let width = $state(Math.min(MAX, Math.max(MIN, Number(localStorage.getItem('owl.panelW')) || 392)));
  let text = $state('');
  let mode = $state<'ask' | 'do'>('ask');
  let usePage = $state(true);
  let ta = $state<HTMLTextAreaElement | null>(null);
  let scroller = $state<HTMLDivElement | null>(null);

  const comp = $derived(store.activeCompanion);
  const hired = $derived(store.companions.filter((c) => c.hired));
  const thread = $derived(threads.current);
  const msgs = $derived(thread?.messages ?? []);
  const busy = $derived(msgs.some((m) => m.pending));
  const tab = $derived(store.activeTab);
  const pageable = $derived(!!tab && !tab.internal);
  const liveRun = $derived.by(() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const r = msgs[i].runId ? store.runs.find((x) => x.id === msgs[i].runId) : null;
      if (r && runLive(r.status)) return r;
    }
    return null;
  });
  const model = $derived(store.settings?.defaultModel?.model ?? null);
  const modelShort = $derived(model ? model.split('/').pop()!.replace(/-\d{8}$/, '') : 'Default');
  const color = $derived(comp?.look?.body ?? 'var(--accent)');

  // prefill from omnibox / 'ask' command
  $effect(() => {
    const p = store.panelPrefill;
    if (!p) return;
    text = p; store.panelPrefill = '';
    queueMicrotask(() => { ta?.focus(); });
  });
  $effect(() => { if (store.panelOpen) queueMicrotask(() => ta?.focus()); });
  // open a specific run (Agents page, agents popover, Chats page)
  $effect(() => {
    const id = store.panelRunId;
    if (!id) return;
    const r = store.runs.find((x) => x.id === id);
    if (r) { threads.openRun(r); store.setCompanion(r.companionId); mode = 'do'; store.panelOpen = true; }
    store.panelRunId = null;
  });

  // stick to bottom as content streams in
  $effect(() => {
    const last = msgs[msgs.length - 1];
    last?.content; msgs.length; liveRun?.steps.length;
    queueMicrotask(() => { if (scroller) scroller.scrollTop = scroller.scrollHeight; });
  });

  function send() {
    const q = text.trim();
    if (!q || busy || !comp) return;
    text = '';
    if (mode === 'do') {
      if (liveRun) {
        const th = threads.current!;
        th.messages.push({ id: Math.random().toString(36).slice(2), role: 'user', content: q, t: Date.now(), companionId: comp.id });
        owl.followUp(liveRun.id, q); threads.save();
      } else threads.doIt(comp.id, q);
    } else threads.ask(comp.id, q, usePage && pageable);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  }
  function starter(s: { q: string; mode: 'ask' | 'do' }) { mode = s.mode; text = s.q; send(); }
  const starters = $derived(pageable
    ? [
        { q: 'Summarize this page in five bullet points', mode: 'ask' as const },
        { q: 'What should I know before acting on this page?', mode: 'ask' as const },
        { q: 'Pull the key facts from this page into a table', mode: 'do' as const },
      ]
    : [
        { q: 'What can you do in my browser?', mode: 'ask' as const },
        { q: 'Find three highly rated cafés near me that open early', mode: 'do' as const },
        { q: 'Compare the latest MacBook Air and Surface Laptop prices', mode: 'do' as const },
      ]);

  // resize from the left edge; freeze the page under glass while dragging so the native view does not eat the pointer
  let resizing = $state(false);
  function startResize(e: PointerEvent) {
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    resizing = true; store.pushOverlay();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => { width = Math.min(MAX, Math.max(MIN, w0 + (x0 - ev.clientX))); };
    const up = () => {
      resizing = false; store.popOverlay(); localStorage.setItem('owl.panelW', String(Math.round(width)));
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  function onHandleKey(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') width = Math.min(MAX, width + 16);
    else if (e.key === 'ArrowRight') width = Math.max(MIN, width - 16);
    else return;
    localStorage.setItem('owl.panelW', String(width));
  }

  const moreItems = $derived<MenuItem[]>([
    { label: 'Manage companions', icon: Users, onSelect: () => owl.newTab('owl://companions') },
    { label: 'Models & keys', icon: Settings2, onSelect: () => owl.newTab('owl://settings#models') },
    { separator: true },
    { label: 'Delete this chat', icon: Trash2, danger: true, disabled: !thread, onSelect: () => thread && threads.remove(thread.id) },
  ]);
  const plusItems = $derived<MenuItem[]>([
    { label: usePage && pageable ? 'Stop using this page' : 'Use this page', icon: usePage && pageable ? Check : Globe, disabled: !pageable, onSelect: () => (usePage = !usePage) },
    { label: 'New chat', icon: SquarePen, onSelect: () => threads.clear() },
  ]);
  const modelItems = $derived<MenuItem[]>([
    { heading: model ? `Using ${model}` : 'No default model yet' },
    { label: 'Change model…', icon: Settings2, onSelect: () => owl.newTab('owl://settings#models') },
  ]);
</script>

<aside class="panel" style:width="{width}px" aria-label="{comp?.name ?? 'Companion'} panel">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (focusable splitter is a valid ARIA pattern) -->
  <div class="handle" class:on={resizing} role="separator" aria-orientation="vertical" aria-label="Resize panel" aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={Math.round(width)}
    tabindex="0" onpointerdown={startResize} onkeydown={onHandleKey}></div>

  <header class="hd">
    <div class="who">
      {#each hired.slice(0, 5) as c (c.id)}
        <Tooltip text="{c.name} · {c.role}">
          {#snippet children(p)}
            <button {...p} class="sw" class:on={c.id === comp?.id} aria-pressed={c.id === comp?.id} aria-label="Switch to {c.name}" style:--cc={c.look.body}
              onclick={() => store.setCompanion(c.id)}>
              <CompanionAvatar companion={c} size={24} />
            </button>
          {/snippet}
        </Tooltip>
      {/each}
    </div>
    <div class="acts">
      <IconButton icon={SquarePen} label="New chat" size="sm" onclick={() => threads.clear()} />
      <IconButton icon={History} label="Chat history" size="sm" onclick={() => owl.newTab('owl://chats')} />
      <Menu items={moreItems}>
        {#snippet trigger(p)}<IconButton icon={Ellipsis} label="More" size="sm" {...p} />{/snippet}
      </Menu>
      <IconButton icon={X} label="Close" kbd="Ctrl+J" size="sm" onclick={() => (store.panelOpen = false)} />
    </div>
  </header>

  <div class="body" bind:this={scroller}>
    {#if !msgs.length}
      <div class="hello">
        <CompanionAvatar companion={comp} face={false} size={112} bob />
        <h2>{comp ? `I'm ${comp.name}.` : 'Hi.'}</h2>
        <p>{comp?.tagline ?? 'Ask anything, or hand me a task to do in your tabs.'}</p>
        <div class="starters">
          {#each starters as s (s.q)}
            <button class="st" onclick={() => starter(s)}>
              {#if s.mode === 'do'}<Zap size={13} strokeWidth={1.8} />{:else}<MessageCircle size={13} strokeWidth={1.8} />{/if}
              <span>{s.q}</span>
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <ol class="thread">
        {#each msgs as m (m.id)}
          <li class="msg {m.role}" class:error={m.error}>
            {#if m.role === 'user'}
              <div class="bubble">{m.content}</div>
            {:else}
              <div class="from"><CompanionAvatar companion={m.companionId} size={20} /></div>
              <div class="min-w-0 flex-1">
                {#if m.runId}
                  {@const r = store.runs.find((x) => x.id === m.runId)}
                  {#if r}<RunView run={r} />{:else}<p class="text-[12.5px] text-ink-3">Starting…</p>{/if}
                {:else if m.pending && !m.content}
                  <span class="typing" aria-label="Thinking"><i></i><i></i><i></i></span>
                {:else}
                  <div class="owl-prose">{@html markdown(m.content)}</div>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  </div>

  <div class="composer-wrap">
    <div class="composer neu-in">
      {#if pageable && usePage && mode === 'ask'}
        <div class="ctx">
          <span class="chip" title={tab?.url}>
            <img src={faviconFor(tab!.url, tab!.favicon)} alt="" width="12" height="12" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
            <span class="truncate">{tab?.title}</span>
            <button aria-label="Don’t use this page" onclick={() => (usePage = false)}><X size={11} strokeWidth={2.2} /></button>
          </span>
        </div>
      {/if}
      <Textarea bare bind:ref={ta} bind:value={text} maxHeight={180} onkeydown={onKey} aria-label="Message {comp?.name ?? 'companion'}"
        placeholder={mode === 'do' ? (liveRun ? `Add to ${comp?.name}'s task…` : `Tell ${comp?.name ?? 'me'} what to do…`) : msgs.length ? 'Ask a follow-up…' : `Ask ${comp?.name ?? 'anything'}…`} />
      <div class="row">
        <Menu items={plusItems} side="top" align="start">
          {#snippet trigger(p)}<IconButton icon={Plus} label="Add context" size="sm" side="top" {...p} />{/snippet}
        </Menu>
        <Segmented size="sm" label="Mode" bind:value={mode} options={[{ value: 'ask', label: 'Ask', icon: MessageCircle }, { value: 'do', label: 'Do it', icon: Zap }]} />
        <span class="flex-1"></span>
        <Menu items={modelItems} side="top" align="end" width={240}>
          {#snippet trigger(p)}
            <button {...p} class="model" aria-label="Model: {modelShort}">
              <span class="truncate">{modelShort}</span><ChevronDown size={12} strokeWidth={2} />
            </button>
          {/snippet}
        </Menu>
        <button class="send" style:--cc={color} disabled={!text.trim() || busy} aria-label={mode === 'do' ? 'Start task' : 'Send'} onclick={send}>
          <ArrowUp size={16} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  </div>
</aside>

<style>
  .panel { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; flex: none; }
  .handle { position: absolute; left: -5px; top: 0; bottom: 0; width: 8px; cursor: col-resize; z-index: 5; }
  .handle::after { content: ''; position: absolute; left: 3px; top: 50%; height: 36px; width: 2px; margin-top: -18px; border-radius: 2px; background: transparent; transition: background-color .15s; }
  .handle:hover::after, .handle.on::after, .handle:focus-visible::after { background: color-mix(in srgb, var(--ink) 25%, transparent); }
  .hd { display: flex; align-items: center; justify-content: space-between; height: 44px; padding: 0 8px 0 10px; flex: none; }
  .who { display: flex; align-items: center; gap: 2px; }
  .sw { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 99px; border: 0; background: transparent; opacity: .55; transition: opacity .15s, transform .15s var(--ease-spring); }
  .sw:hover { opacity: 1; transform: translateY(-1px); }
  .sw.on { opacity: 1; box-shadow: inset 0 0 0 1.5px var(--cc); }
  .acts { display: flex; align-items: center; gap: 1px; }
  .body { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 16px 16px; mask-image: linear-gradient(to bottom, transparent 0, #000 14px); }
  .hello { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 32px 4px 8px; }
  .hello h2 { margin-top: 14px; font-family: var(--font-display); font-size: 19px; font-weight: 600; letter-spacing: -0.015em; }
  .hello p { margin-top: 4px; max-width: 280px; font-size: 13px; color: var(--ink-2); }
  .starters { display: flex; flex-direction: column; gap: 6px; width: 100%; margin-top: 22px; }
  .st { display: flex; align-items: center; gap: 9px; width: 100%; padding: 9px 12px; border-radius: 12px; border: 0; background: var(--surface); box-shadow: 0 0 0 1px var(--line); color: var(--ink); font: inherit; font-size: 12.5px; text-align: left; transition: box-shadow .15s; }
  .st :global(svg) { color: var(--ink-3); flex: none; }
  .st:hover { box-shadow: 0 0 0 1px color-mix(in srgb, var(--ink) 18%, transparent); }
  .thread { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 16px; }
  .msg { display: flex; gap: 10px; font-size: 13.5px; }
  .msg.user { justify-content: flex-end; }
  .bubble { max-width: 85%; padding: 8px 12px; border-radius: 16px 16px 5px 16px; background: color-mix(in srgb, var(--ink) 6.5%, transparent); white-space: pre-wrap; overflow-wrap: anywhere; }
  .from { padding-top: 1px; flex: none; }
  .msg.error .owl-prose { color: #d43a3f; }
  .typing { display: inline-flex; gap: 4px; padding: 7px 0; }
  .typing i { width: 6px; height: 6px; border-radius: 99px; background: var(--ink-3); animation: owl-pulse 1.1s ease-in-out infinite; }
  .typing i:nth-child(2) { animation-delay: .15s; } .typing i:nth-child(3) { animation-delay: .3s; }
  .composer-wrap { padding: 0 10px 10px; flex: none; }
  .composer { display: flex; flex-direction: column; gap: 6px; padding: 10px 10px 8px 14px; border-radius: 20px; }
  .ctx { display: flex; }
  .chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; height: 22px; padding: 0 3px 0 8px; border-radius: 99px; background: var(--surface); box-shadow: 0 0 0 1px var(--line); font-size: 11.5px; color: var(--ink-2); }
  .chip img { border-radius: 2px; flex: none; }
  .chip button { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 99px; border: 0; background: transparent; color: var(--ink-3); flex: none; }
  .chip button:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink); }
  .composer :global(textarea) { min-height: 22px; font-size: 13.5px; }
  .row { display: flex; align-items: center; gap: 6px; margin-left: -4px; }
  .model { display: inline-flex; align-items: center; gap: 4px; max-width: 150px; height: 26px; padding: 0 9px; border-radius: 99px; border: 0; background: transparent; color: var(--ink-2); font: inherit; font-size: 12px; }
  .model:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); color: var(--ink); }
  .send { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 99px; border: 0; background: var(--cc); color: #fff; box-shadow: 0 2px 8px -2px color-mix(in srgb, var(--cc) 70%, transparent), inset 0 1px 0 rgba(255,255,255,.25); transition: transform .12s var(--ease-out), opacity .15s; flex: none; }
  .send:active:not(:disabled) { transform: scale(.92); }
  .send:disabled { opacity: .35; box-shadow: none; }
</style>
