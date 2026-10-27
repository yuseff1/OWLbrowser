<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import type { IconName } from '../ui/icons';
  import { Command, Dialog, computeCommandScore } from 'bits-ui';
  import { owl, hostOf } from '../api';
  import { store } from '../stores.svelte';
  import { threads } from '../threads.svelte';
  import { CompanionAvatar, Kbd } from '../ui';
  import TabIcon from './TabIcon.svelte';

  let q = $state('');
  let sugg = $state<Array<{ type: string; title: string; url: string }>>([]);
  const comp = $derived(store.activeCompanion);

  let pushed = false;
  $effect(() => {
    if (store.paletteOpen && !pushed) { pushed = true; store.pushOverlay(); }
    else if (!store.paletteOpen && pushed) { pushed = false; store.popOverlay(); q = ''; }
  });

  let timer: any;
  $effect(() => {
    const t = q.trim();
    clearTimeout(timer);
    if (t.length < 2) { sugg = []; return; }
    timer = setTimeout(async () => {
      const r = ((await owl.suggest(t)) as any[]) || [];
      sugg = r.filter((s) => s.type === 'history' || s.type === 'bookmark').slice(0, 6);
    }, 80);
  });

  function run(fn: () => void) { store.paletteOpen = false; fn(); }
  const page = (id: string) => () => owl.newTab(`owl://${id}`);

  type Cmd = { label: string; icon: IconName; kbd?: string; act: () => void };
  const commands: Cmd[] = [
    { label: 'New tab', icon: 'add', kbd: 'Ctrl+T', act: () => owl.newTab() },
    { label: 'New window', icon: 'window', kbd: 'Ctrl+N', act: () => owl.newWindow({}) },
    { label: 'New incognito window', icon: 'eye-off', kbd: 'Ctrl+Shift+N', act: () => owl.newWindow({ incognito: true }) },
    { label: 'Reopen closed tab', icon: 'arrow-counterclockwise', kbd: 'Ctrl+Shift+T', act: () => owl.reopenClosed() },
    { label: 'New chat with companion', icon: 'chat', kbd: 'Ctrl+Shift+J', act: () => { threads.clear(); store.panelOpen = true; } },
    { label: 'Toggle sidebar', icon: 'panel-left', kbd: 'Ctrl+\\', act: () => (store.sidebarOpen = !store.sidebarOpen) },
    { label: 'Toggle bookmarks bar', icon: 'bookmark', kbd: 'Ctrl+Shift+B', act: () => store.onCommand('toggle-bookmarks-bar') },
    { label: 'Split view', icon: 'split-vertical', kbd: 'Ctrl+Shift+S', act: () => owl.command('toggle-split') },
    { label: 'Reader mode', icon: 'immersive-reader', kbd: 'F9', act: () => owl.command('reader') },
    { label: 'Task manager', icon: 'data-usage', kbd: 'Shift+Esc', act: () => (store.taskManagerOpen = true) },
    { label: 'Switch profile', icon: 'person-swap', kbd: 'Ctrl+Shift+M', act: () => store.onCommand('switch-profile') },
    { label: 'Switch to light or dark', icon: 'dark-theme', act: () => owl.patchSettings({ theme: document.documentElement.classList.contains('dark') ? 'light' : 'dark' }).then((s: any) => s && (store.settings = s)) },
    { label: 'Switch tab layout', icon: 'panel-top-expand', act: () => store.setLayout(store.layout === 'classic' ? 'modern' : 'classic') },
    { label: 'Bookmark this tab', icon: 'star', kbd: 'Ctrl+D', act: () => owl.command('bookmark') },
  ];
  const pages: Cmd[] = [
    { label: 'Settings', icon: 'settings', act: page('settings') },
    { label: 'Models & API keys', icon: 'settings', act: page('settings#models') },
    { label: 'Companions', icon: 'people', act: page('companions') },
    { label: 'Agents', icon: 'bot', act: page('agents') },
    { label: 'Chat history', icon: 'chat-multiple', act: page('chats') },
    { label: 'Routines', icon: 'arrow-repeat-all', act: page('routines') },
    { label: 'Skills', icon: 'sparkle', act: page('skills') },
    { label: 'Apps', icon: 'apps', act: page('apps') },
    { label: 'Library', icon: 'library', act: page('library') },
    { label: 'Memory', icon: 'brain-circuit', act: page('memory') },
    { label: 'History', icon: 'clock', kbd: 'Ctrl+H', act: page('history') },
    { label: 'Downloads', icon: 'arrow-download', act: page('downloads') },
    { label: 'Bookmarks', icon: 'bookmark', kbd: 'Ctrl+Shift+O', act: page('bookmarks') },
  ];
</script>

<Dialog.Root bind:open={store.paletteOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="pal-backdrop" />
    <Dialog.Content class="pal glass-strong glass-lens" aria-label="Command palette">
      <Command.Root class="flex min-h-0 flex-col" loop filter={(value, search, keywords) => (/^(ask|do|search):/.test(value) ? 1 : computeCommandScore(value, search, keywords))}>
        <div class="in">
          <Icon name="search" size={16} class="text-ink-3" />
          <Command.Input bind:value={q} placeholder="Search tabs, history, commands — or ask {comp?.name ?? 'your companion'}" class="pal-input" />
          <Kbd keys="Esc" />
        </div>
        <Command.List class="list">
          <Command.Viewport>
            <Command.Empty class="empty">Nothing matches. Press Enter to ask {comp?.name ?? 'your companion'}.</Command.Empty>

            {#if q.trim()}
              <Command.Group forceMount value="ask-group">
                <Command.GroupItems>
                  <Command.Item value="ask:{q}" forceMount class="item" onSelect={() => run(() => { store.panelOpen = true; store.panelPrefill = q.trim(); })}>
                    <CompanionAvatar companion={comp} size={18} />
                    <span class="t">Ask {comp?.name}: <b>{q}</b></span>
                    <span class="hint">Chat</span>
                  </Command.Item>
                  <Command.Item value="do:{q}" forceMount class="item" onSelect={() => run(() => { store.panelOpen = true; if (comp) threads.doIt(comp.id, q.trim()); })}>
                    <Icon name="flash" size={16} />
                    <span class="t">Have {comp?.name} do it: <b>{q}</b></span>
                    <span class="hint">Agent</span>
                  </Command.Item>
                  <Command.Item value="search:{q}" forceMount class="item" onSelect={() => run(() => owl.newTab(q.trim()))}>
                    <Icon name="globe" size={16} />
                    <span class="t">Search the web for <b>{q}</b></span>
                  </Command.Item>
                </Command.GroupItems>
              </Command.Group>
            {/if}

            <Command.Group>
              <Command.GroupHeading class="gh">Tabs</Command.GroupHeading>
              <Command.GroupItems>
                {#each store.win.tabs as t (t.id)}
                  <Command.Item value="tab:{t.id}:{t.title}" keywords={[t.url, hostOf(t.url)]} class="item" onSelect={() => run(() => owl.activateTab(t.id))}>
                    <TabIcon tab={t} size={16} />
                    <span class="t">{t.title || t.url}</span>
                    <span class="hint">{t.id === store.win.activeTabId ? 'Current' : t.internal ? 'OWL' : hostOf(t.url)}</span>
                  </Command.Item>
                {/each}
              </Command.GroupItems>
            </Command.Group>

            {#if sugg.length}
              <Command.Group>
                <Command.GroupHeading class="gh">History and bookmarks</Command.GroupHeading>
                <Command.GroupItems>
                  {#each sugg as s (s.url)}
                    <Command.Item value="url:{s.url}:{s.title}" class="item" onSelect={() => run(() => owl.newTab(s.url))}>
                      {#if s.type === 'bookmark'}<Icon name="star" size={16} />{:else}<Icon name="clock" size={16} />{/if}
                      <span class="t">{s.title}</span>
                      <span class="hint">{hostOf(s.url)}</span>
                    </Command.Item>
                  {/each}
                </Command.GroupItems>
              </Command.Group>
            {/if}

            <Command.Group>
              <Command.GroupHeading class="gh">Commands</Command.GroupHeading>
              <Command.GroupItems>
                {#each commands as c (c.label)}
                  <Command.Item value={c.label} class="item" onSelect={() => run(c.act)}>
                    <Icon name={c.icon} size={16} />
                    <span class="t">{c.label}</span>
                    {#if c.kbd}<Kbd keys={c.kbd} />{/if}
                  </Command.Item>
                {/each}
              </Command.GroupItems>
            </Command.Group>

            <Command.Group>
              <Command.GroupHeading class="gh">Go to</Command.GroupHeading>
              <Command.GroupItems>
                {#each pages as c (c.label)}
                  <Command.Item value={'Go to ' + c.label} class="item" onSelect={() => run(c.act)}>
                    <Icon name={c.icon} size={16} />
                    <span class="t">{c.label}</span>
                    {#if c.kbd}<Kbd keys={c.kbd} />{/if}
                  </Command.Item>
                {/each}
              </Command.GroupItems>
            </Command.Group>
          </Command.Viewport>
        </Command.List>
      </Command.Root>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.pal-backdrop) { position: fixed; inset: 0; z-index: 70; background: color-mix(in srgb, var(--ground) 20%, transparent); }
  :global(.pal) {
    position: fixed; left: 50%; top: 12vh; z-index: 71; transform: translateX(-50%);
    width: min(640px, calc(100vw - 32px)); max-height: min(520px, 76vh); display: flex; flex-direction: column;
    border-radius: 22px; overflow: hidden; outline: none; animation: pal-in .2s var(--ease-out) both;
  }
  @keyframes -global-pal-in { from { opacity: 0; transform: translateX(-50%) translateY(6px) scale(.985); } to { opacity: 1; transform: translateX(-50%); } }
  .in { display: flex; align-items: center; gap: 10px; height: 54px; padding: 0 16px; border-bottom: 1px solid var(--line); flex: none; }
  :global(.pal-input) { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; font-size: 15px; }
  :global(.pal-input::placeholder) { color: var(--ink-3); }
  :global(.pal .list) { overflow-y: auto; padding: 6px; min-height: 0; }
  :global(.pal .gh) { padding: 10px 10px 4px; font-size: 11.5px; font-weight: 500; color: var(--ink-3); }
  :global(.pal .item) { display: flex; align-items: center; gap: 11px; height: 38px; padding: 0 10px; border-radius: 11px; color: var(--ink); font-size: 13.5px; cursor: default; }
  :global(.pal .item svg) { color: var(--ink-2); flex: none; }
  :global(.pal .item[data-selected]) { background: color-mix(in srgb, var(--ink) 7%, transparent); }
  :global(.pal .item .t) { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  :global(.pal .item .t b) { font-weight: 600; }
  :global(.pal .item .hint) { font-size: 12px; color: var(--ink-3); white-space: nowrap; }
  :global(.pal .empty) { padding: 22px; text-align: center; font-size: 13px; color: var(--ink-3); }
</style>
