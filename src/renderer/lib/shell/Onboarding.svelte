<script lang="ts">
  import { owl, art } from '../api';
  import { store } from '../stores.svelte';
  import { Button, Input, Select, Switch, IconButton, Kbd, Spinner, Segmented } from '../ui';
  import { Shuffle, Check, ArrowLeft, Cpu, KeyRound, ExternalLink } from '@lucide/svelte';
  import type { ImportSource, ImportResult, ModelProvider } from '$shared/types';

  let { onDone }: { onDone: (r: { companionId: string }) => void } = $props();

  const STEPS = 6;
  let step = $state(0);
  let userName = $state('');
  let companionId = $state('hoot');
  let companionName = $state('Hoot');
  let nameTouched = $state(false);

  const official = $derived(store.companions.filter((c) => c.official).slice(0, 6));
  const chosen = $derived(store.companions.find((c) => c.id === companionId));
  $effect(() => { if (!nameTouched && chosen) companionName = chosen.name; });

  // ---- names
  const POOL = ['Juniper', 'Milo', 'Sage', 'Olive', 'Pixel', 'Kiwi', 'Orbit', 'Maple', 'Ziggy', 'Luna', 'Biscuit', 'Rook', 'Clover', 'Mochi', 'Fable', 'Quill', 'Nimbus', 'Pepper'];
  let chips = $state<string[]>(shuffle());
  function shuffle() { return [...POOL].sort(() => Math.random() - 0.5).slice(0, 4); }

  // ---- import
  let sources = $state<ImportSource[]>([]);
  let source = $state('');
  const KINDS = ['bookmarks', 'history', 'passwords', 'extensions'] as const;
  let what = $state({ bookmarks: true, history: true, passwords: true, extensions: true });
  let importing = $state(false);
  let result = $state<ImportResult | null>(null);
  owl.importSources().then((s: any) => { sources = s || []; if (sources[0]) source = sources[0].path; });
  const label = (s: ImportSource) => `${s.browser[0].toUpperCase() + s.browser.slice(1)} — ${s.profileName}`;
  async function doImport() {
    const s = sources.find((x) => x.path === source);
    if (!s) return;
    importing = true;
    try { result = (await owl.importFrom(s, { ...what })) as ImportResult; }
    catch (e: any) { result = { bookmarks: 0, history: 0, passwords: 0, extensions: 0, searchEngines: 0, errors: [e?.message || 'Import stopped early.'] }; }
    importing = false;
  }
  const fmt = (n: number) => n.toLocaleString();

  // ---- brain
  let brainMode = $state<'local' | 'key'>('local');
  let providers = $state<ModelProvider[]>([]);
  let presets = $state<Record<string, { name: string; local: boolean; keyUrl?: string }>>({});
  let kind = $state('openrouter');
  let apiKey = $state('');
  let connecting = $state(false);
  let connected = $state<{ providerId: string; models: string[] } | null>(null);
  let connectError = $state('');
  let model = $state('');
  owl.providers().then((p: any) => {
    providers = p || [];
    if (!providers.some((x) => x.local && x.models?.length)) brainMode = 'key';
  });
  owl.providerPresets().then((p: any) => (presets = p || {}));
  const localFound = $derived(providers.filter((p) => p.local && p.models?.length));
  const keyKinds = $derived(Object.entries(presets).filter(([, v]) => !v.local).map(([k, v]) => ({ value: k, label: v.name })));
  const localModels = $derived(localFound.flatMap((p) => p.models.map((m) => ({ value: `${p.id}::${m}`, label: m, hint: p.name }))));
  $effect(() => { if (brainMode === 'local' && !model && localModels[0]) model = localModels[0].value; });

  async function connect() {
    connecting = true; connectError = '';
    try {
      const p = (await owl.upsertProvider({ kind, apiKey: apiKey.trim() })) as ModelProvider | null;
      if (!p) throw new Error('Couldn’t save that key.');
      const models = ((await owl.discoverModels(p.id)) as string[]) || p.models || [];
      connected = { providerId: p.id, models };
      model = models[0] ? `${p.id}::${models[0]}` : '';
      if (!models.length) connectError = 'Key saved, but no models came back. Check the key, or pick a model later in Settings.';
    } catch (e: any) { connectError = e?.message || 'That key didn’t work.'; }
    connecting = false;
  }
  async function saveBrain() {
    if (!model) return;
    const [providerId, m] = model.split('::');
    await owl.patchSettings({ defaultModel: { providerId, model: m } });
  }

  // ---- flow
  const canNext = $derived(step === 1 ? userName.trim().length > 0 : step === 2 ? !!companionId && companionName.trim().length > 0 : true);
  async function next() {
    if (!canNext) return;
    if (step === 4) await saveBrain();
    if (step < STEPS - 1) { step++; return; }
    await finish();
  }
  async function finish() {
    await owl.completeOnboarding({ userName: userName.trim() || 'Friend', companionId, companionName: companionName.trim() || chosen?.name || 'Hoot' });
    onDone({ companionId });
  }
  async function skipAll() {
    await owl.completeOnboarding({ userName: userName.trim() || 'Friend', companionId, companionName: companionName.trim() || chosen?.name || 'Hoot' });
    onDone({ companionId });
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !(e.target as HTMLElement)?.closest?.('textarea,[role=listbox],[role=option],button')) { e.preventDefault(); next(); }
  }

  const stageArt = $derived(step < 2 ? art.hero : art.companion(companionId));
  const speaker = $derived(step < 2 ? 'Hoot' : companionName || chosen?.name || 'Hoot');
</script>

<svelte:window onkeydown={onKey} />

<div class="onb halftone">
  <div class="top drag">
    <div class="prog" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={step + 1} aria-label="Setup progress">
      <span style:width="{((step + 1) / STEPS) * 100}%"></span>
    </div>
    <button class="skip no-drag" onclick={skipAll}>Skip all</button>
  </div>

  <main class="stage">
    <div class="art" aria-hidden="true">
      {#key stageArt}
        <img src={stageArt} alt="" class="animate-bob fade" draggable="false" />
      {/key}
      <div class="shadow"></div>
    </div>

    <section class="talk" aria-live="polite">
      {#key step}
        <div class="fade flex flex-col gap-3">
          {#if step === 0}
            <div class="bubble"><h1>Hi, I’m Hoot. Welcome to OWL.</h1></div>
            <div class="bubble sub"><p>OWL is a browser with companions who can read pages, fill forms and run errands in their own tabs while you keep working. Setup takes about a minute.</p></div>
          {:else if step === 1}
            <div class="bubble"><h1>What should I call you?</h1></div>
            <div class="ctrl"><Input size="lg" placeholder="Your first name" bind:value={userName} autofocus aria-label="Your name" maxlength={40} /></div>
          {:else if step === 2}
            <div class="bubble"><h1>{userName ? `Nice to meet you, ${userName.trim()}.` : 'Nice to meet you.'} Pick your first companion.</h1></div>
            <div class="grid max-w-[480px] grid-cols-3 gap-2" role="radiogroup" aria-label="Companions">
              {#each official as c (c.id)}
                <button class="card" class:on={c.id === companionId} role="radio" aria-checked={c.id === companionId} style:--cc={c.look.body}
                  onclick={() => { companionId = c.id; nameTouched = false; }}>
                  <img src={art.companion(c.id)} alt="" draggable="false" />
                  <span class="nm">{c.name}</span>
                  <span class="rl">{c.role}</span>
                  {#if c.id === companionId}<span class="ck"><Check size={11} strokeWidth={3} /></span>{/if}
                </button>
              {/each}
            </div>
            <div class="bubble mt-1"><h2>What would you like to name me?</h2></div>
            <div class="ctrl">
              <Input size="lg" bind:value={companionName} oninput={() => (nameTouched = true)} aria-label="Companion name" maxlength={24} />
              <div class="mt-2 flex flex-wrap items-center gap-1.5">
                {#each [chosen?.name ?? 'Hoot', ...chips.filter((c) => c !== chosen?.name)] as n (n)}
                  <button class="nchip" class:on={companionName === n} onclick={() => { companionName = n; nameTouched = true; }}>{n}</button>
                {/each}
                <IconButton icon={Shuffle} label="More names" size="sm" side="top" onclick={() => (chips = shuffle())} />
              </div>
            </div>
          {:else if step === 3}
            <div class="bubble"><h1>Bring your stuff from Chrome.</h1></div>
            <div class="bubble sub"><p>I’ll copy what you choose, so OWL feels like home from the first tab. Nothing leaves this computer.</p></div>
            <div class="panel">
              {#if sources.length}
                <Select items={sources.map((s) => ({ value: s.path, label: label(s) }))} bind:value={source} label="Import from" class="w-full" />
                <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                  {#each KINDS as k (k)}
                    <label class="opt"><Switch bind:checked={what[k]} label={k[0].toUpperCase() + k.slice(1)} />{k[0].toUpperCase() + k.slice(1)}</label>
                  {/each}
                </div>
                {#if result}
                  <div class="res">
                    <div class="flex items-center gap-2 text-[13px] font-medium"><Check size={15} strokeWidth={2.2} class="text-[#2f8f5b]" />Imported</div>
                    <p class="mt-1 text-[12.5px] text-ink-2 tnum">{fmt(result.bookmarks)} bookmarks · {fmt(result.history)} pages of history · {fmt(result.passwords)} passwords · {fmt(result.extensions)} extensions</p>
                    {#each result.errors as n (n)}<p class="mt-1 text-[12px] text-ink-3">{n}</p>{/each}
                  </div>
                {:else}
                  <div class="mt-4"><Button variant="secondary" loading={importing} disabled={!Object.values(what).some(Boolean)} onclick={doImport}>{importing ? 'Importing…' : 'Import'}</Button></div>
                {/if}
              {:else}
                <p class="text-[13px] text-ink-2">I didn’t find Chrome, Edge or Brave on this computer. You can import later from Settings.</p>
              {/if}
            </div>
          {:else if step === 4}
            <div class="bubble"><h1>Connect a brain.</h1></div>
            <div class="bubble sub"><p>I think with a language model. Run one on this computer for privacy, or paste an API key for the strongest models.</p></div>
            <div class="panel">
              <Segmented full label="Model source" bind:value={brainMode} options={[{ value: 'local', label: 'On this computer', icon: Cpu }, { value: 'key', label: 'API key', icon: KeyRound }]} />
              {#if brainMode === 'local'}
                {#if localModels.length}
                  <p class="mt-3 text-[12.5px] text-ink-2">Found {localFound.map((p) => p.name).join(' and ')} running. Pick a model:</p>
                  <Select class="mt-2 w-full" items={localModels} bind:value={model} label="Local model" />
                {:else}
                  <p class="mt-3 text-[13px] text-ink-2">No local model is running. Install <a class="lnk" href="https://ollama.com/download" target="_blank" rel="noreferrer">Ollama</a> or <a class="lnk" href="https://lmstudio.ai" target="_blank" rel="noreferrer">LM Studio</a>, start a model, then come back — or use an API key.</p>
                {/if}
              {:else}
                <div class="mt-3 flex gap-2">
                  <Select items={keyKinds} bind:value={kind} label="Provider" class="w-[170px]" onValueChange={() => { connected = null; connectError = ''; }} />
                  <Input type="password" class="flex-1" placeholder="Paste your API key" bind:value={apiKey} aria-label="API key" autocomplete="off" />
                </div>
                <div class="mt-2 flex items-center gap-2">
                  <Button variant="secondary" size="sm" loading={connecting} disabled={!apiKey.trim()} onclick={connect}>{connected ? 'Reconnect' : 'Connect'}</Button>
                  {#if presets[kind]?.keyUrl}<a class="lnk inline-flex items-center gap-1 text-[12.5px]" href={presets[kind].keyUrl} target="_blank" rel="noreferrer">Get a key <ExternalLink size={12} /></a>{/if}
                </div>
                {#if connected?.models.length}
                  <Select class="mt-3 w-full" items={connected.models.map((m) => ({ value: `${connected!.providerId}::${m}`, label: m }))} bind:value={model} label="Model" />
                {/if}
                {#if connectError}<p class="mt-2 text-[12.5px] text-[#d43a3f]">{connectError}</p>{/if}
              {/if}
              <p class="mt-3 text-[12px] text-ink-3">You can skip this and add models later in Settings → Models.</p>
            </div>
          {:else}
            <div class="bubble"><h1>You’re set{userName ? `, ${userName.trim()}` : ''}.</h1></div>
            <div class="bubble sub"><p>I’m {companionName || chosen?.name}. Press <Kbd keys="Ctrl+Shift+J" /> to ask me about any page, or switch to <b>Do it</b> and I’ll handle the clicking in my own tab.</p></div>
          {/if}
        </div>
      {/key}
    </section>
  </main>

  <footer class="foot">
    {#if step > 0}
      <Button variant="ghost" icon={ArrowLeft} onclick={() => (step = Math.max(0, step - 1))}>Back</Button>
    {/if}
    <span class="flex-1"></span>
    {#if step === 3 || step === 4}
      <Button variant="ghost" onclick={() => step++}>Skip</Button>
    {/if}
    <Button variant="primary" size="lg" disabled={!canNext} onclick={next}>
      {step === STEPS - 1 ? 'Start browsing' : 'Continue'}<span class="ml-1 opacity-60"><Kbd keys="Enter" class="enter" /></span>
    </Button>
  </footer>
</div>

<style>
  .onb {
    position: fixed; inset: 0; z-index: 100; display: flex; flex-direction: column; color: var(--ink);
    background-color: #f2f1f5;
    --ink: #1d1b22; --ink-2: #5d5966; --ink-3: #8e8a97; --surface: #fff; --surface-2: #f7f6fa; --line: rgba(20,16,30,.08); --ground: #f2f1f5;
    --neu-bg: #eeedf3; --neu-in: inset 3px 3px 7px rgba(163,158,180,.45), inset -3px -3px 7px rgba(255,255,255,.9);
    --glass-bg-strong: rgba(255,255,255,.86); --glass-border: rgba(255,255,255,.7); --halftone: rgba(110,100,150,.09);
    color-scheme: light;
  }
  .top { display: flex; align-items: center; gap: 16px; height: 38px; padding: 0 160px 0 24px; flex: none; }
  :global(.platform-darwin) .top { padding: 0 24px 0 90px; }
  .prog { flex: 1; max-width: 420px; height: 4px; margin: 0 auto; border-radius: 99px; background: rgba(20,16,30,.08); overflow: hidden; }
  .prog span { display: block; height: 100%; border-radius: 99px; background: var(--ink); transition: width .4s var(--ease-out); }
  .skip { font: inherit; font-size: 12.5px; color: var(--ink-2); background: transparent; border: 0; padding: 4px 8px; border-radius: 8px; }
  .skip:hover { color: var(--ink); background: rgba(20,16,30,.06); }
  .stage { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: 24px; max-width: 1120px; width: 100%; margin: 0 auto; padding: 0 48px; }
  .art { position: relative; display: grid; place-items: center; height: 100%; max-height: 560px; }
  .art img { width: min(420px, 90%); max-height: 70vh; object-fit: contain; filter: drop-shadow(0 30px 40px rgba(40,30,80,.18)); }
  .shadow { position: absolute; bottom: 9%; width: 42%; height: 18px; border-radius: 50%; background: radial-gradient(closest-side, rgba(40,30,80,.18), transparent); }
  .talk { max-height: 100%; overflow-y: auto; padding: 24px 6px; }
  .bubble { position: relative; align-self: flex-start; max-width: 480px; padding: 14px 18px; border-radius: 22px; background: #fff; box-shadow: 0 1px 2px rgba(30,20,60,.06), 0 12px 32px -14px rgba(30,20,60,.2); }
  .bubble:first-child::before { content: ''; position: absolute; left: -7px; top: 18px; width: 16px; height: 16px; background: #fff; transform: rotate(45deg); border-radius: 3px; }
  .bubble h1 { font-family: var(--font-display); font-size: 22px; line-height: 1.25; font-weight: 600; letter-spacing: -0.02em; }
  .bubble h2 { font-family: var(--font-display); font-size: 17px; font-weight: 600; letter-spacing: -0.015em; }
  .bubble.sub p { font-size: 14px; line-height: 1.55; color: var(--ink-2); }
  .bubble.sub b { color: var(--ink); font-weight: 600; }
  .ctrl, .panel { max-width: 480px; }
  .panel { padding: 16px; border-radius: 20px; background: rgba(255,255,255,.7); box-shadow: 0 0 0 1px var(--line); backdrop-filter: blur(12px); }
  .card { position: relative; display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 10px 6px 10px; border-radius: 16px; border: 0; background: #fff; box-shadow: 0 0 0 1px var(--line); font: inherit; transition: box-shadow .15s, transform .15s var(--ease-out); }
  .card:hover { transform: translateY(-2px); box-shadow: 0 0 0 1px rgba(20,16,30,.14), 0 8px 20px -10px rgba(30,20,60,.25); }
  .card.on { box-shadow: 0 0 0 2px var(--ink), 0 8px 20px -10px rgba(30,20,60,.25); }
  .card img { width: 72px; height: 72px; object-fit: contain; margin-bottom: 4px; }
  .nm { font-size: 13px; font-weight: 600; color: var(--ink); }
  .rl { font-size: 11.5px; color: var(--ink-3); }
  .ck { position: absolute; top: 8px; right: 8px; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 99px; background: var(--ink); color: #fff; }
  .nchip { height: 28px; padding: 0 12px; border-radius: 99px; border: 0; background: #fff; box-shadow: 0 0 0 1px var(--line); font: inherit; font-size: 12.5px; color: var(--ink-2); }
  .nchip:hover { color: var(--ink); box-shadow: 0 0 0 1px rgba(20,16,30,.18); }
  .nchip.on { background: var(--ink); color: #fff; box-shadow: none; }
  .opt { display: flex; align-items: center; gap: 10px; font-size: 13px; }
  .res { margin-top: 14px; padding: 12px; border-radius: 14px; background: #fff; box-shadow: 0 0 0 1px var(--line); }
  .lnk { color: var(--ink); text-decoration: underline; text-underline-offset: 2px; text-decoration-color: rgba(20,16,30,.3); }
  .foot { display: flex; align-items: center; gap: 8px; max-width: 1120px; width: 100%; margin: 0 auto; padding: 16px 48px 28px; flex: none; }
  .foot :global(.enter kbd) { background: transparent; border-color: rgba(255,255,255,.3); color: inherit; box-shadow: none; }
  .fade { animation: owl-in .35s var(--ease-out) both; }
  @media (max-width: 860px) { .stage { grid-template-columns: 1fr; } .art { display: none; } }
</style>
