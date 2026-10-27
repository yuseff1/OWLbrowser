<script lang="ts">
  import Icon from '../../../ui/Icon.svelte';
  import { onMount } from 'svelte';
  import { owl } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, IconButton } from '$lib/ui';
  import Section from './Section.svelte';
  import Group from './Group.svelte';
  import Skel from '../Skel.svelte';
  import Note from '../Note.svelte';

  type Ext = { id: string; name: string; version: string; path: string };
  let list = $state<Ext[]>([]);
  let loading = $state(true);
  let error = $state('');
  let adding = $state(false);

  async function load() {
    error = '';
    try { list = ((await owl.extensions()) as Ext[]) || []; } catch (e: any) { error = e?.message || 'Couldn’t list extensions.'; }
    loading = false;
  }
  onMount(() => { load(); });
  async function loadUnpacked() {
    adding = true;
    try { const e = (await owl.loadExtension()) as Ext | null; if (e) { store.toast(`${e.name} added`, undefined, 'success'); load(); } }
    catch (e: any) { store.toast('Couldn’t load the extension', e?.message, 'error'); }
    adding = false;
  }
  async function remove(e: Ext) {
    try { await owl.removeExtension(e.id); list = list.filter((x) => x.id !== e.id); store.toast(`${e.name} removed`); } catch (err: any) { store.toast('Couldn’t remove', err?.message, 'error'); }
  }
</script>

<Section title="Extensions" description="Chrome extensions that work in OWL.">
  {#snippet actions()}<Button variant="secondary" icon="folder-arrow-right" loading={adding} onclick={loadUnpacked}>Load unpacked…</Button>{/snippet}
  {#if error}<Note kind="error" text={error} retry={load} />{/if}
  <Group>
    {#if loading}
      {#each Array(2) as _, i (i)}<div class="flex items-center gap-3 px-4 py-3.5"><Skel w={32} h={32} r={9} /><div class="flex flex-1 flex-col gap-1.5"><Skel w="35%" h={13} /><Skel w="50%" h={10} /></div></div>{/each}
    {:else if !list.length}
      <div class="flex items-center gap-3 px-4 py-5 text-[13px] text-ink-2"><Icon name="puzzle-piece" size={16} /> No extensions yet. Import them from Chrome, or load an unpacked folder.</div>
    {:else}
      {#each list as e (e.id)}
        <div class="owl-hoverable flex items-center gap-3 px-4 py-3">
          <span class="owl-tile size-8 text-ink-2"><Icon name="puzzle-piece" size={16} /></span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-[13.5px] font-medium">{e.name} <span class="tnum font-normal text-ink-2">{e.version}</span></div>
            <div class="truncate font-mono text-[11.5px] text-ink-2">{e.id}</div>
          </div>
          <IconButton icon="delete" label="Remove {e.name}" size="sm" onclick={() => remove(e)} />
        </div>
      {/each}
    {/if}
  </Group>
  <Note kind="info">
    Most Chrome Web Store extensions install directly: open the store, then press “Add to Chrome”. Extensions that need Google sign-in or Chrome-only APIs may not work.
    <button type="button" class="owl-link mt-1.5" onclick={() => owl.openWebStore()}>Open the Chrome Web Store <Icon name="open" size={12} /></button>
  </Note>
</Section>
