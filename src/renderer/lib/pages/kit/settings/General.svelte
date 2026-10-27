<script lang="ts">
  import Icon from '../../../ui/Icon.svelte';
  import { osSettingsName } from '$lib/env';
  import { onMount } from 'svelte';
  import { owl } from '$lib/api';
  import { store } from '$lib/stores.svelte';
  import { Button, Select, Switch, Badge } from '$lib/ui';
  import Section from './Section.svelte';
  import Group from './Group.svelte';
  import Row from '../Row.svelte';
  import { patch } from './patch';

  const s = $derived(store.settings);
  let isDefault = $state<boolean | null>(null);
  let setting = $state(false);
  onMount(() => { owl.isDefaultBrowser().then((v: any) => (isDefault = !!v)).catch(() => (isDefault = false)); });

  async function makeDefault() {
    setting = true;
    try { isDefault = !!(await owl.setDefaultBrowser()); if (!isDefault) store.toast(`Finish in ${osSettingsName}`, 'Pick OWL as the default web browser, then come back.'); }
    catch (e: any) { store.toast('Couldn’t set OWL as default', e?.message, 'error'); }
    setting = false;
  }
  const engines = [
    { value: 'google', label: 'Google' }, { value: 'duckduckgo', label: 'DuckDuckGo' }, { value: 'bing', label: 'Bing' },
    { value: 'brave', label: 'Brave Search' }, { value: 'perplexity', label: 'Perplexity' }, { value: 'kagi', label: 'Kagi' },
  ];
</script>

<Section title="General" description="Startup, search and the basics.">
  <Group>
    <Row title="Default browser" description={isDefault ? 'Links from other apps open in OWL.' : 'Links from email, chat and other apps open in another browser.'}>
      {#if isDefault === null}<span class="text-[12.5px] text-ink-2">Checking…</span>
      {:else if isDefault}<Badge variant="ok"><Icon name="checkmark" size={12} /> OWL is your default</Badge>
      {:else}<Button size="sm" variant="primary" loading={setting} onclick={makeDefault}>Make default</Button>{/if}
    </Row>
    <Row title="Search engine" description="Used when you type words instead of an address.">
      <Select items={engines} value={s?.searchEngine ?? 'google'} onValueChange={(v) => patch({ searchEngine: v as any })} label="Search engine" class="w-[180px]" />
    </Row>
  </Group>
  <Group label="On startup">
    <Row title="Continue where you left off" description="Reopen the tabs from your last session.">
      <Switch checked={s?.restoreSession ?? true} label="Continue where you left off" onCheckedChange={(v) => patch({ restoreSession: v })} />
    </Row>
    <Row title="Show bookmarks bar" description="Ctrl+Shift+B toggles it anywhere.">
      <Switch checked={s?.showBookmarksBar ?? false} label="Show bookmarks bar" onCheckedChange={(v) => patch({ showBookmarksBar: v })} />
    </Row>
  </Group>
</Section>
