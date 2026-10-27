<script lang="ts">
  import Icon from '../../../ui/Icon.svelte';
  import { onMount } from 'svelte';
  import type { ModelProvider, ProviderKind } from '$shared/types';
  import { owl, hostOf } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Input, Select, Switch, Dialog, Menu, Badge, Spinner } from '$lib/ui';
  import Section from './Section.svelte';
  import Group from './Group.svelte';
  import Row from '../Row.svelte';
  import Field from '../Field.svelte';
  import Note from '../Note.svelte';
  import Skel from '../Skel.svelte';
  import GroupedSelect from '../GroupedSelect.svelte';
  import { modelGroups, refKey, parseRef } from '../util';
  import { patch, PROVIDER_DOMAIN, favicon } from './patch';

  type Preset = { name: string; baseUrl: string; local: boolean; models: string[]; keyUrl?: string };
  const CLOUD: ProviderKind[] = ['openrouter', 'openai', 'anthropic', 'google', 'xai', 'groq', 'mistral', 'deepseek', 'nvidia'];
  const LOCAL: ProviderKind[] = ['ollama', 'lmstudio', 'llamacpp', 'custom'];

  let providers = $state<ModelProvider[]>([]);
  let presets = $state<Record<string, Preset>>({});
  let loading = $state(true);
  let error = $state('');
  let busy = $state<Record<string, 'detect' | 'test' | null>>({});
  let tests = $state<Record<string, { ok: boolean; text?: string; error?: string; ms: number; model: string }>>({});
  let testModel = $state<Record<string, string>>({});
  let iconFail = $state<Record<string, boolean>>({});

  async function load() {
    error = '';
    try { const [p, pr] = await Promise.all([owl.providers(), owl.providerPresets()]); providers = (p as ModelProvider[]) || []; presets = (pr as any) || {}; }
    catch (e: any) { error = e?.message || 'Couldn’t load model providers.'; }
    loading = false;
  }
  onMount(() => { load(); });

  const s = $derived(store.settings);
  const groups = $derived(modelGroups(providers));
  const hasAnyModel = $derived(groups.length > 0);

  async function setEnabled(p: ModelProvider, v: boolean) {
    providers = providers.map((x) => (x.id === p.id ? { ...x, enabled: v } : x));
    try { await owl.upsertProvider({ id: p.id, kind: p.kind, enabled: v }); } catch (e: any) { providers = providers.map((x) => (x.id === p.id ? { ...x, enabled: !v } : x)); store.toast('Couldn’t update the provider', e?.message, 'error'); }
  }
  async function detect(p: ModelProvider) {
    busy[p.id] = 'detect';
    try {
      const models = ((await owl.discoverModels(p.id)) as string[]) || [];
      providers = providers.map((x) => (x.id === p.id ? { ...x, models: models.length ? models : x.models } : x));
      store.toast(models.length ? `${models.length} models found` : 'No models found', models.length ? p.name : p.local ? `Is ${p.name.replace(/ \(local\)/, '')} running on ${hostOf(p.baseUrl)}?` : 'Check the key and base URL.', models.length ? 'success' : 'info');
    } catch (e: any) { store.toast('Couldn’t reach ' + p.name, e?.message, 'error'); }
    busy[p.id] = null;
  }
  async function test(p: ModelProvider) {
    const model = testModel[p.id] || p.models[0];
    if (!model) { store.toast('Detect models first', `${p.name} has no models listed yet.`); return; }
    busy[p.id] = 'test';
    try { const r = (await owl.testModel({ providerId: p.id, model })) as any; tests[p.id] = { ...r, model }; }
    catch (e: any) { tests[p.id] = { ok: false, error: e?.message || String(e), ms: 0, model }; }
    busy[p.id] = null;
  }
  async function remove(p: ModelProvider) {
    try {
      await owl.removeProvider(p.id);
      providers = providers.filter((x) => x.id !== p.id);
      if (s?.defaultModel?.providerId === p.id) patch({ defaultModel: null });
      if (s?.visionModel?.providerId === p.id) patch({ visionModel: null });
    } catch (e: any) { store.toast('Couldn’t remove ' + p.name, e?.message, 'error'); }
  }

  // ---- add / edit
  let open = $state(false);
  let step = $state<'pick' | 'form'>('pick');
  let f = $state({ id: undefined as string | undefined, kind: 'openrouter' as ProviderKind, name: '', baseUrl: '', apiKey: '', hasKey: false });
  let saving = $state(false);
  let formError = $state('');
  const preset = $derived(presets[f.kind]);
  const needsKey = $derived(!preset?.local);

  function add() { step = 'pick'; formError = ''; open = true; }
  function pick(k: ProviderKind) { const pr = presets[k]; f = { id: undefined, kind: k, name: pr?.name ?? k, baseUrl: pr?.baseUrl ?? '', apiKey: '', hasKey: false }; step = 'form'; }
  function edit(p: ModelProvider) { f = { id: p.id, kind: p.kind, name: p.name, baseUrl: p.baseUrl, apiKey: '', hasKey: !!p.hasKey }; step = 'form'; formError = ''; open = true; }

  async function save() {
    if (!/^https?:\/\//.test(f.baseUrl.trim())) { formError = 'The base URL must start with http:// or https://'; return; }
    if (needsKey && f.kind !== 'custom' && !f.apiKey.trim() && !f.hasKey) { formError = 'Paste your API key.'; return; }
    saving = true; formError = '';
    try {
      const saved = (await owl.upsertProvider({ id: f.id, kind: f.kind, name: f.name.trim() || preset?.name, baseUrl: f.baseUrl.trim(), ...(f.apiKey.trim() ? { apiKey: f.apiKey.trim() } : {}), enabled: true })) as ModelProvider;
      providers = f.id ? providers.map((x) => (x.id === saved.id ? saved : x)) : [...providers, saved];
      open = false;
      if (!saved.models?.length || saved.local) detect(saved);
      if (!s?.defaultModel && saved.models?.length) patch({ defaultModel: { providerId: saved.id, model: saved.models[0] } });
    } catch (e: any) { formError = e?.message || 'Couldn’t save the provider.'; }
    saving = false;
  }
  const iconFor = (k: string) => PROVIDER_DOMAIN[k];
</script>

<Section title="Models" description="Bring your own AI. Use cloud providers with your key, or run models locally for free and private.">
  {#snippet actions()}<Button variant="primary" icon="add" onclick={add}>Add provider</Button>{/snippet}

  {#if error}<Note kind="error" text={error} retry={load} />{/if}

  <Group>
    <Row title="Default model" description="Used by every companion unless it has its own model.">
      <GroupedSelect {groups} value={refKey(s?.defaultModel)} onValueChange={(v) => patch({ defaultModel: parseRef(v) })} label="Default model" placeholder="Choose a model" class="w-[280px]" />
    </Row>
    <Row title="Vision model" description="Reads screenshots when a page can’t be read as text. Pick one that accepts images.">
      <GroupedSelect {groups} value={refKey(s?.visionModel)} onValueChange={(v) => patch({ visionModel: parseRef(v) })} label="Vision model" placeholder="Same as default" class="w-[280px]" />
    </Row>
  </Group>
  {#if !loading && !hasAnyModel}
    <Note kind="warn">Companions need at least one model. Add a provider: <strong>OpenRouter</strong> gives you every major model with one key, or <strong>Ollama</strong> / <strong>LM Studio</strong> run models on this computer for free.</Note>
  {/if}

  <Group label="Providers">
    {#if loading}
      {#each Array(3) as _, i (i)}<div class="flex items-center gap-3.5 px-4 py-4"><Skel w={36} h={36} r={10} /><div class="flex flex-1 flex-col gap-2"><Skel w="30%" h={13} /><Skel w="50%" h={11} /></div><Skel w={34} h={20} r={99} /></div>{/each}
    {:else if !providers.length}
      <div class="px-4 py-6 text-center text-[13px] text-ink-2">No providers yet.</div>
    {:else}
      {#each providers as p (p.id)}
        {@const t = tests[p.id]}
        {@const d = iconFor(p.kind)}
        <div class="px-4 py-3.5" class:opacity-60={!p.enabled}>
          <div class="flex items-center gap-3.5">
            <span class="owl-tile size-9">
              {#if d && !iconFail[p.id]}<img src={favicon(d)} alt="" onerror={() => (iconFail[p.id] = true)} />{:else if p.kind === 'llamacpp'}<Icon name="developer-board" size={16} class="text-ink-2" />{:else}<Icon name="server" size={16} class="text-ink-2" />{/if}
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate text-[13.5px] font-medium">{p.name}</span>
                <Badge variant="outline">{#if p.local}<Icon name="laptop" size={12} /> Local{:else}<Icon name="cloud" size={12} /> Cloud{/if}</Badge>
                {#if !p.local}{#if p.hasKey}<Badge variant="ok">Key saved</Badge>{:else}<Badge variant="warn">No key</Badge>{/if}{/if}
              </div>
              <div class="mt-0.5 flex items-center gap-2 text-[12px] text-ink-2">
                <span class="truncate font-mono text-[11.5px]">{p.baseUrl}</span>
                <span aria-hidden="true">·</span>
                <span class="tnum shrink-0">{p.models.length} {p.models.length === 1 ? 'model' : 'models'}</span>
              </div>
            </div>
            <Switch checked={p.enabled} label="Use {p.name}" onCheckedChange={(v) => setEnabled(p, v)} />
            <Menu items={[{ label: p.local ? 'Edit address' : 'Change key or address', icon: 'key', onSelect: () => edit(p) }, { separator: true }, { label: 'Remove', icon: 'delete', danger: true, onSelect: () => remove(p) }]}>
              {#snippet trigger(pp)}<button {...pp} type="button" aria-label="More for {p.name}" class="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink"><Icon name="more-horizontal" size={16} /></button>{/snippet}
            </Menu>
          </div>
          <div class="ml-[50px] mt-2.5 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon="developer-board-search" loading={busy[p.id] === 'detect'} disabled={!p.enabled} onclick={() => detect(p)}>Detect models</Button>
            {#if p.models.length}
              <Select items={p.models.map((m) => ({ value: m, label: m }))} value={testModel[p.id] || p.models[0]} onValueChange={(v) => (testModel[p.id] = v)} size="sm" label="Model to test" class="w-[220px]" />
            {/if}
            <Button size="sm" variant="ghost" icon="beaker" loading={busy[p.id] === 'test'} disabled={!p.enabled || !p.models.length} onclick={() => test(p)}>Test</Button>
            {#if t}
              <span class="flex min-w-0 items-center gap-1.5 text-[12.5px]" role="status">
                {#if t.ok}<Icon name="checkmark-circle" size={14} class="shrink-0 text-[#24855a]" /><span class="truncate">“{t.text}”</span><span class="tnum shrink-0 text-ink-2">{t.ms.toLocaleString()} ms</span>
                {:else}<Icon name="error-circle" size={14} class="shrink-0 text-[#d43a3f]" /><span class="truncate text-[#c4242a] dark:text-[#ff7a7e]" title={t.error}>{t.error}</span>{/if}
              </span>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </Group>
</Section>

<Dialog bind:open title={step === 'pick' ? 'Add a model provider' : f.id ? `Edit ${f.name}` : `Connect ${preset?.name ?? f.kind}`} description={step === 'pick' ? 'Cloud providers need an API key. Local ones run on this computer and stay private.' : undefined} width={step === 'pick' ? 620 : 480}>
  {#if step === 'pick'}
    {#each [{ l: 'Cloud', kinds: CLOUD }, { l: 'On this computer', kinds: LOCAL }] as g (g.l)}
      <h3 class="owl-group-label mt-1">{g.l}</h3>
      <div class="mb-4 grid grid-cols-3 gap-2">
        {#each g.kinds as k (k)}
          {@const pr = presets[k]}
          {@const d = iconFor(k)}
          <button type="button" onclick={() => pick(k)} class="flex items-center gap-2.5 rounded-xl bg-surface p-2.5 text-left shadow-[0_0_0_1px_var(--line)] hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--ink)_22%,transparent)] active:scale-[.98]">
            <span class="owl-tile size-8">{#if d && !iconFail['p' + k]}<img src={favicon(d)} alt="" onerror={() => (iconFail['p' + k] = true)} />{:else if k === 'llamacpp'}<Icon name="developer-board" size={16} class="text-ink-2" />{:else}<Icon name="server" size={16} class="text-ink-2" />{/if}</span>
            <span class="min-w-0 truncate text-[13px] font-medium">{(pr?.name ?? k).replace(' (local)', '').replace(' (OpenAI-compatible)', '')}</span>
          </button>
        {/each}
      </div>
    {/each}
  {:else}
    <form id="prov-form" class="flex flex-col gap-3.5" onsubmit={(e) => { e.preventDefault(); save(); }}>
      {#if !f.id}<button type="button" class="owl-link -mt-1 self-start" onclick={() => (step = 'pick')}><Icon name="chevron-left" size={14} /> All providers</button>{/if}
      <Field label="Name" for="pv-name"><Input id="pv-name" bind:value={f.name} /></Field>
      <Field label="Base URL" for="pv-url" hint={preset?.local ? 'Where the local server listens. Start it before detecting models.' : 'OpenAI-compatible endpoint. The preset is right for most people.'}>
        <Input id="pv-url" bind:value={f.baseUrl} class="font-mono" spellcheck="false" />
      </Field>
      {#if needsKey || f.kind === 'custom'}
        <Field label={f.kind === 'custom' ? 'API key (if the server needs one)' : 'API key'} for="pv-key" hint={f.hasKey ? 'A key is saved. Leave empty to keep it.' : 'Stored encrypted on this computer; never shown again.'}>
          <Input id="pv-key" type="password" bind:value={f.apiKey} placeholder={f.hasKey ? '••••••••••••' : 'sk-…'} autocomplete="off" />
        </Field>
        {#if preset?.keyUrl}<button type="button" class="owl-link self-start" onclick={() => owl.newTab(preset.keyUrl!)}>Get a key on {hostOf(preset.keyUrl)} <Icon name="open" size={12} /></button>{/if}
      {/if}
      {#if formError}<Note kind="error" text={formError} />{/if}
    </form>
  {/if}
  {#snippet footer()}
    {#if step === 'form'}
      <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
      <Button variant="primary" type="submit" form="prov-form" loading={saving}>{f.id ? 'Save' : 'Add provider'}</Button>
    {/if}
  {/snippet}
</Dialog>
