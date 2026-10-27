<script lang="ts">
  import type { TabState, Artifact } from '$shared/types';
  import { owl, timeAgo } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, IconButton, CompanionAvatar, Empty } from '$lib/ui';
  import Skel from './kit/Skel.svelte';
  import Note from './kit/Note.svelte';
  import './kit/kit.css';

  let { tab }: { tab: TabState } = $props();

  let a = $state<Artifact | null>(null);
  let loading = $state(true);
  let error = $state('');
  let missing = $state(false);
  let nonce = $state(0);
  /** owl-artifact:// URL from main (own CSP, so scripted artifacts run); null in plain vite dev → srcdoc fallback */
  let src = $state<string | null>(null);

  async function load(id?: string) {
    loading = true; error = ''; missing = false;
    if (!id) { missing = true; loading = false; return; }
    try {
      a = (await owl.artifact(id)) as Artifact | null; missing = !a;
      src = a ? (((await owl.artifactUrl(id).catch(() => null)) as string | null) ?? null) : null;
    }
    catch (e: any) { error = e?.message || 'Couldn’t open this artifact.'; }
    loading = false;
  }
  $effect(() => { load(tab.artifactId); });

  const c = $derived(a?.companionId ? store.companions.find((x) => x.id === a!.companionId) : null);
  async function exp() { if (a) try { await owl.exportArtifact(a.id); } catch (e: any) { store.toast('Couldn’t export', e?.message, 'error'); } }
</script>

<div class="flex h-full flex-col">
  <header class="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-[color-mix(in_srgb,var(--surface)_70%,transparent)] px-4">
    {#if loading}
      <Skel w={22} h={22} r={99} /><Skel w={220} h={14} />
    {:else if a}
      {#if a.companionId}<CompanionAvatar companion={a.companionId} size={22} />{/if}
      <div class="min-w-0 flex-1">
        <h1 class="truncate text-[14px] font-semibold tracking-[-0.01em]">{a.title}</h1>
      </div>
      <span class="hidden text-[12px] text-ink-2 md:inline">{c ? `By ${c.name} · ` : ''}{timeAgo(a.createdAt)}</span>
      <IconButton icon="arrow-clockwise" label="Reload" size="sm" onclick={() => nonce++} />
      {#if a.companionId}<IconButton icon="chat" label="Ask {c?.name ?? 'companion'} to change it" size="sm" onclick={() => { store.setCompanion(a!.companionId!); store.panelPrefill = `Update the artifact “${a!.title}”: `; store.panelOpen = true; }} />{/if}
      <Button size="sm" variant="secondary" icon="arrow-download" onclick={exp}>Export</Button>
      <Button size="sm" variant="ghost" icon="library" onclick={() => owl.newTab('owl://library')}>Open in Library</Button>
    {:else}
      <div class="flex-1 text-[14px] font-semibold">Artifact</div>
      <Button size="sm" variant="ghost" icon="library" onclick={() => owl.navigate(tab.id, 'owl://library')}>Open Library</Button>
    {/if}
  </header>
  <div class="relative min-h-0 flex-1 bg-white">
    {#if loading}
      <div class="absolute inset-0 grid place-items-center bg-ground"><span class="sr-only">Loading</span></div>
    {:else if error}
      <div class="mx-auto max-w-[520px] p-10"><Note kind="error" text={error} retry={() => load(tab.artifactId)} /></div>
    {:else if missing || !a}
      <div class="absolute inset-0 bg-ground">
        <Empty icon="document-dismiss" title="This artifact isn’t here any more" body="It may have been deleted. Everything that’s left is in your Library." />
      </div>
    {:else}
      {#key nonce}
        {#if src}
          <iframe title={a.title} src={src} sandbox="allow-scripts allow-popups allow-forms allow-modals" referrerpolicy="no-referrer" class="absolute inset-0 size-full border-0"></iframe>
        {:else}
          <iframe title={a.title} srcdoc={a.html} sandbox="allow-scripts allow-popups allow-forms allow-modals" class="absolute inset-0 size-full border-0"></iframe>
        {/if}
      {/key}
    {/if}
  </div>
</div>
