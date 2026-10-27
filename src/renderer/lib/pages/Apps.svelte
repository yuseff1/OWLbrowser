<script lang="ts">
  import { onMount } from 'svelte';
  import type { TabState } from '$shared/types';
  import { owl, hostOf } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Input, Textarea, Segmented, Dialog, Menu, Empty, Spinner } from '$lib/ui';
  import Page from './kit/Page.svelte';
  import Field from './kit/Field.svelte';
  import Skel from './kit/Skel.svelte';
  import Note from './kit/Note.svelte';
  import { Plus, Check, Search, Ellipsis, Trash2, KeyRound, Plug, Unplug, Terminal, Blocks, ExternalLink, RefreshCw } from '@lucide/svelte';

  let { tab }: { tab: TabState } = $props();

  type App = { id: string; name: string; transport: 'http' | 'stdio'; url?: string; command?: string; args?: string[]; env?: Record<string, string>; enabled: boolean; hasToken: boolean; status: 'connected' | 'connecting' | 'error' | 'off'; error?: string; description?: string; icon?: string };
  type Entry = { id?: string; name: string; description: string; category: string; transport: 'http'; url: string; needsToken: boolean; iconDomain: string };

  let apps = $state<App[]>([]);
  let catalog = $state<Entry[]>([]);
  let loading = $state(true);
  let error = $state('');
  let q = $state('');
  let busy = $state<Record<string, boolean>>({});
  let iconFail = $state<Record<string, boolean>>({});

  async function load() {
    error = '';
    try {
      const [a, c] = await Promise.all([owl.apps(), owl.appCatalog()]);
      apps = (a as App[]) || []; catalog = (c as Entry[]) || [];
    } catch (e: any) { error = e?.message || 'Couldn’t load apps.'; }
    loading = false;
  }
  onMount(() => { load(); });

  const icon = (domain?: string) => (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : '');
  const appDomain = (a: App) => a.icon && /\./.test(a.icon) ? a.icon : a.url ? hostOf(a.url).split('.').slice(-2).join('.') : '';
  const added = (e: Entry) => apps.find((a) => a.url && a.url.replace(/\/$/, '') === e.url.replace(/\/$/, ''));

  const categories = $derived.by(() => {
    const n = q.trim().toLowerCase();
    const order = ['Essentials', 'Productivity', 'Sales & CRM', 'Dev', 'Data'];
    const by = new Map<string, Entry[]>();
    for (const e of catalog) {
      if (n && !(e.name + ' ' + e.description + ' ' + e.category).toLowerCase().includes(n)) continue;
      if (!by.has(e.category)) by.set(e.category, []);
      by.get(e.category)!.push(e);
    }
    return [...by.entries()].sort((a, b) => (order.indexOf(a[0]) + 99) % 99 - (order.indexOf(b[0]) + 99) % 99);
  });
  const statusLabel = { connected: 'Connected', connecting: 'Connecting…', error: 'Needs attention', off: 'Not connected' } as const;
  const statusColor = { connected: '#30a46c', connecting: '#e8742a', error: '#e5484d', off: 'var(--ink-3)' } as const;

  async function connect(id: string) {
    busy[id] = true;
    try {
      const r = (await owl.connectApp(id)) as { ok: boolean; status: App['status']; error?: string; tools?: number };
      apps = apps.map((a) => (a.id === id ? { ...a, status: r.status, error: r.error } : a));
      if (r.ok) store.toast(`${apps.find((a) => a.id === id)?.name ?? 'App'} connected`, r.tools != null ? `${r.tools} tools available to your companions.` : undefined, 'success');
    } catch (e: any) { apps = apps.map((a) => (a.id === id ? { ...a, status: 'error', error: e?.message } : a)); }
    busy[id] = false;
  }
  async function disconnect(a: App) {
    busy[a.id] = true;
    try { await owl.disconnectApp(a.id); apps = apps.map((x) => (x.id === a.id ? { ...x, status: 'off', error: undefined } : x)); } catch (e: any) { store.toast('Couldn’t disconnect', e?.message, 'error'); }
    busy[a.id] = false;
  }
  async function remove(a: App) {
    try { await owl.removeApp(a.id); apps = apps.filter((x) => x.id !== a.id); store.toast(`${a.name} removed`); } catch (e: any) { store.toast('Couldn’t remove', e?.message, 'error'); }
  }

  // ---- add from catalog / token dialog
  let tokOpen = $state(false);
  let tokFor = $state<{ entry?: Entry; app?: App } | null>(null);
  let token = $state('');
  let tokSaving = $state(false);
  let tokError = $state('');

  async function addEntry(e: Entry) {
    if (e.needsToken) { tokFor = { entry: e }; token = ''; tokError = ''; tokOpen = true; return; }
    const key = 'cat:' + e.url;
    busy[key] = true;
    try {
      const saved = (await owl.saveApp({ name: e.name, transport: 'http', url: e.url, description: e.description, icon: e.iconDomain, enabled: true })) as App;
      apps = [...apps, { ...saved, hasToken: false, status: 'connecting' }];
      await connect(saved.id);
    } catch (err: any) { store.toast(`Couldn’t add ${e.name}`, err?.message, 'error'); }
    busy[key] = false;
  }
  function editToken(a: App) { tokFor = { app: a }; token = ''; tokError = ''; tokOpen = true; }
  async function saveToken() {
    if (!token.trim()) { tokError = 'Paste the token or API key.'; return; }
    tokSaving = true; tokError = '';
    try {
      let id: string;
      if (tokFor?.entry) {
        const e = tokFor.entry;
        const saved = (await owl.saveApp({ name: e.name, transport: 'http', url: e.url, description: e.description, icon: e.iconDomain, enabled: true, token: token.trim() })) as App;
        apps = [...apps, { ...saved, hasToken: true, status: 'connecting' }];
        id = saved.id;
      } else {
        const a = tokFor!.app!;
        await owl.saveApp({ id: a.id, token: token.trim() });
        apps = apps.map((x) => (x.id === a.id ? { ...x, hasToken: true, status: 'connecting', error: undefined } : x));
        id = a.id;
      }
      tokOpen = false;
      await connect(id);
    } catch (e: any) { tokError = e?.message || 'Couldn’t save the token.'; }
    tokSaving = false;
  }

  // ---- custom MCP
  let mcpOpen = $state(false);
  let m = $state({ name: '', transport: 'http' as 'http' | 'stdio', url: '', command: '', args: '', env: '', token: '' });
  let mcpSaving = $state(false);
  let mcpError = $state('');
  function splitArgs(s: string) { return (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((x) => x.replace(/^["']|["']$/g, '')); }
  async function saveMcp() {
    if (!m.name.trim()) { mcpError = 'Name the app.'; return; }
    if (m.transport === 'http' && !/^https?:\/\//.test(m.url.trim())) { mcpError = 'The server URL must start with http:// or https://'; return; }
    if (m.transport === 'stdio' && !m.command.trim()) { mcpError = 'Enter the command that starts the server, for example npx.'; return; }
    const env: Record<string, string> = {};
    for (const line of m.env.split('\n')) { const i = line.indexOf('='); if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    mcpSaving = true; mcpError = '';
    try {
      const cfg: any = { name: m.name.trim(), transport: m.transport, enabled: true, ...(m.transport === 'http' ? { url: m.url.trim() } : { command: m.command.trim(), args: splitArgs(m.args) }), ...(Object.keys(env).length ? { env } : {}) };
      if (m.token.trim()) cfg.token = m.token.trim();
      const saved = (await owl.saveApp(cfg)) as App;
      apps = [...apps, { ...saved, hasToken: !!m.token.trim(), status: 'connecting' }];
      mcpOpen = false;
      await connect(saved.id);
    } catch (e: any) { mcpError = e?.message || 'Couldn’t add the server.'; }
    mcpSaving = false;
  }
  function openMcp() { m = { name: '', transport: 'http', url: '', command: '', args: '', env: '', token: '' }; mcpError = ''; mcpOpen = true; }
</script>

<Page title="Apps" description="Connect the tools your companions can use. Tokens stay encrypted on this PC." width={980}>
  {#snippet actions()}
    <Button variant="primary" icon={Plus} onclick={openMcp}>Add custom MCP</Button>
  {/snippet}
  {#snippet toolbar()}
    <Input bind:value={q} icon={Search} pill placeholder="Search apps" class="w-[320px]" type="search" aria-label="Search apps" />
  {/snippet}

  {#if error}<Note kind="error" text={error} retry={load} class="mb-5" />{/if}

  {#if loading}
    <div class="owl-sheet mb-8">{#each Array(2) as _, i (i)}<div class="flex items-center gap-3 px-4 py-3.5"><Skel w={36} h={36} r={10} /><div class="flex flex-1 flex-col gap-2"><Skel w="25%" h={13} /><Skel w="45%" h={11} /></div></div>{/each}</div>
  {:else if apps.length}
    <section class="mb-9" aria-labelledby="apps-connected">
      <h2 id="apps-connected" class="mb-2.5 px-0.5 text-[14px] font-semibold">Your apps</h2>
      <div class="owl-sheet">
        {#each apps as a (a.id)}
          {@const d = appDomain(a)}
          <div class="flex items-center gap-3.5 px-4 py-3">
            <span class="owl-tile size-9">
              {#if a.transport === 'stdio' || !d || iconFail[a.id]}<Terminal size={16} class="text-ink-2" />{:else}<img src={icon(d)} alt="" onerror={() => (iconFail[a.id] = true)} />{/if}
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate text-[13.5px] font-medium">{a.name}</span>
                <span class="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-2"><span class="size-[7px] rounded-full" style:background={statusColor[a.status]} class:animate-pulse-soft={a.status === 'connecting' || busy[a.id]}></span>{busy[a.id] ? 'Connecting…' : statusLabel[a.status]}</span>
              </div>
              <div class="truncate text-[12.5px] {a.status === 'error' ? 'text-[#c4242a] dark:text-[#ff7a7e]' : 'text-ink-2'}">{a.status === 'error' && a.error ? a.error : a.description || (a.transport === 'http' ? a.url : [a.command, ...(a.args ?? [])].join(' '))}</div>
            </div>
            {#if a.status === 'connected'}
              <Button size="sm" variant="ghost" icon={Unplug} disabled={busy[a.id]} onclick={() => disconnect(a)}>Disconnect</Button>
            {:else if a.status === 'error' && a.transport === 'http' && /token|auth|401|403/i.test(a.error || '')}
              <Button size="sm" variant="secondary" icon={KeyRound} onclick={() => editToken(a)}>{a.hasToken ? 'Replace token' : 'Add token'}</Button>
            {:else}
              <Button size="sm" variant="secondary" icon={a.status === 'error' ? RefreshCw : Plug} loading={busy[a.id]} onclick={() => connect(a.id)}>{a.status === 'error' ? 'Retry' : 'Connect'}</Button>
            {/if}
            <Menu items={[...(a.transport === 'http' ? [{ label: a.hasToken ? 'Replace token' : 'Add token', icon: KeyRound, onSelect: () => editToken(a) }] : []), { separator: true }, { label: 'Remove', icon: Trash2, danger: true, onSelect: () => remove(a) }]}>
              {#snippet trigger(p)}<button {...p} type="button" aria-label="More for {a.name}" class="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-ink"><Ellipsis size={16} /></button>{/snippet}
            </Menu>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if loading}
    {#each Array(2) as _, g (g)}
      <div class="mb-8"><Skel w={110} h={14} class="mb-3" /><div class="grid grid-cols-3 gap-x-6 gap-y-1">{#each Array(6) as _, i (i)}<div class="flex items-center gap-3 py-2.5"><Skel w={36} h={36} r={10} /><div class="flex flex-1 flex-col gap-1.5"><Skel w="50%" h={12} /><Skel w="85%" h={10} /></div></div>{/each}</div></div>
    {/each}
  {:else if !categories.length}
    <Empty icon={Blocks} title={q ? `No apps match “${q}”` : 'No apps in the catalog'} body="You can still connect any MCP server with Add custom MCP." compact>
      {#snippet actions()}<Button size="sm" variant="secondary" icon={Plus} onclick={openMcp}>Add custom MCP</Button>{/snippet}
    </Empty>
  {:else}
    {#each categories as [cat, entries] (cat)}
      <section class="mb-8" aria-label={cat}>
        <h2 class="mb-1.5 px-0.5 text-[14px] font-semibold">{cat}</h2>
        <ul class="grid grid-cols-3 gap-x-6">
          {#each entries as e (e.url)}
            {@const have = added(e)}
            <li class="flex items-center gap-3 border-b border-line py-3">
              <span class="owl-tile size-9">{#if iconFail['c' + e.url]}<Blocks size={16} class="text-ink-2" />{:else}<img src={icon(e.iconDomain)} alt="" loading="lazy" onerror={() => (iconFail['c' + e.url] = true)} />{/if}</span>
              <div class="min-w-0 flex-1">
                <div class="truncate text-[13.5px] font-medium">{e.name}</div>
                <div class="truncate text-[12.5px] text-ink-2" title={e.description}>{e.description}</div>
              </div>
              {#if have}
                <span class="grid size-8 place-items-center text-[#24855a]" title="Added"><Check size={16} strokeWidth={2.2} aria-label="{e.name} added" /></span>
              {:else}
                <button type="button" aria-label="Add {e.name}" disabled={busy['cat:' + e.url]} onclick={() => addEntry(e)}
                  class="grid size-8 shrink-0 place-items-center rounded-full bg-surface text-ink-2 shadow-[0_0_0_1px_var(--line)] hover:text-ink active:scale-95">
                  {#if busy['cat:' + e.url]}<Spinner size={13} />{:else}<Plus size={15} strokeWidth={2} />{/if}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</Page>

<Dialog bind:open={tokOpen} title={tokFor?.entry ? `Connect ${tokFor.entry.name}` : `Token for ${tokFor?.app?.name ?? 'app'}`} description="Paste an API key or access token from your account. It is encrypted and never shown again." width={480}>
  <form id="tok-form" class="flex flex-col gap-3" onsubmit={(e) => { e.preventDefault(); saveToken(); }}>
    <Field label="Token or API key" for="tok"><Input id="tok" type="password" bind:value={token} placeholder="Paste here" autocomplete="off" /></Field>
    {#if tokFor?.entry || tokFor?.app}
      {@const dom = tokFor.entry?.iconDomain || (tokFor.app ? appDomain(tokFor.app) : '')}
      {#if dom}<button type="button" class="owl-link self-start" onclick={() => owl.newTab('https://' + dom)}>Get a token on {dom} <ExternalLink size={12} /></button>{/if}
    {/if}
    {#if tokError}<Note kind="error" text={tokError} />{/if}
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (tokOpen = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="tok-form" loading={tokSaving}>Save and connect</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={mcpOpen} title="Add a custom MCP server" description="Any Model Context Protocol server: a remote URL, or a command that runs on this PC." width={560}>
  <form id="mcp-form" class="flex flex-col gap-4" onsubmit={(e) => { e.preventDefault(); saveMcp(); }}>
    <div class="grid grid-cols-[1fr_auto] items-end gap-3">
      <Field label="Name" for="mcp-name"><Input id="mcp-name" bind:value={m.name} placeholder="My files" /></Field>
      <Segmented bind:value={m.transport} label="Transport" options={[{ value: 'http', label: 'Remote (HTTP)' }, { value: 'stdio', label: 'Local command' }]} />
    </div>
    {#if m.transport === 'http'}
      <Field label="Server URL" for="mcp-url"><Input id="mcp-url" type="url" bind:value={m.url} placeholder="https://example.com/mcp" /></Field>
      <Field label="Token (optional)" for="mcp-tok" hint="Sent as a Bearer token."><Input id="mcp-tok" type="password" bind:value={m.token} autocomplete="off" placeholder="Paste here" /></Field>
    {:else}
      <div class="grid grid-cols-[160px_1fr] gap-3">
        <Field label="Command" for="mcp-cmd"><Input id="mcp-cmd" bind:value={m.command} placeholder="npx" class="font-mono" /></Field>
        <Field label="Arguments" for="mcp-args"><Input id="mcp-args" bind:value={m.args} placeholder="-y @modelcontextprotocol/server-filesystem C:\Users\me\Documents" class="font-mono" /></Field>
      </div>
      <Field label="Environment (optional)" for="mcp-env" hint="One KEY=value per line.">
        <Textarea id="mcp-env" bind:value={m.env} placeholder="API_KEY=…" class="min-h-[64px] font-mono !text-[12.5px]" />
      </Field>
      <Note kind="warn" text="Local commands run with your Windows permissions. Only add servers you trust." />
    {/if}
    {#if mcpError}<Note kind="error" text={mcpError} />{/if}
  </form>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (mcpOpen = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="mcp-form" loading={mcpSaving}>Add and connect</Button>
  {/snippet}
</Dialog>
