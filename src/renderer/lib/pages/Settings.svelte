<script lang="ts">
  import type { TabState } from '$shared/types';
  import { Input } from '$lib/ui';
  import './kit/kit.css';
  import General from './kit/settings/General.svelte';
  import Appearance from './kit/settings/Appearance.svelte';
  import Models from './kit/settings/Models.svelte';
  import AgentsSettings from './kit/settings/Agents.svelte';
  import Privacy from './kit/settings/Privacy.svelte';
  import Performance from './kit/settings/Performance.svelte';
  import ImportSection from './kit/settings/Import.svelte';
  import Extensions from './kit/settings/Extensions.svelte';
  import Profiles from './kit/settings/Profiles.svelte';
  import About from './kit/settings/About.svelte';
  import { Settings2, Palette, Cpu, Bot, ShieldCheck, Gauge, Download, Puzzle, UsersRound, Info, Search } from '@lucide/svelte';

  let { tab }: { tab: TabState } = $props();

  const SECTIONS = [
    { id: 'general', label: 'General', icon: Settings2, C: General, keys: 'default browser search engine startup session bookmarks bar' },
    { id: 'appearance', label: 'Appearance', icon: Palette, C: Appearance, keys: 'theme dark light colour color layout wallpaper tabs' },
    { id: 'models', label: 'Models', icon: Cpu, C: Models, keys: 'ai provider api key openrouter openai anthropic gemini ollama lm studio local model vision' },
    { id: 'agents', label: 'Companions & Agents', icon: Bot, C: AgentsSettings, keys: 'approval autonomous parallel bots computer use' },
    { id: 'privacy', label: 'Privacy & Security', icon: ShieldCheck, C: Privacy, keys: 'adblock ads trackers do not track passwords clear data cookies cache' },
    { id: 'performance', label: 'Performance', icon: Gauge, C: Performance, keys: 'memory ram sleep tabs saver speed' },
    { id: 'import', label: 'Import', icon: Download, C: ImportSection, keys: 'chrome edge brave import bookmarks history passwords csv' },
    { id: 'extensions', label: 'Extensions', icon: Puzzle, C: Extensions, keys: 'chrome web store unpacked addons' },
    { id: 'profiles', label: 'Profiles', icon: UsersRound, C: Profiles, keys: 'work personal accounts windows' },
    { id: 'about', label: 'About', icon: Info, C: About, keys: 'version update chromium electron' },
  ] as const;
  type Id = (typeof SECTIONS)[number]['id'];

  const fromHash = (url: string) => { const h = url.split('#')[1]?.toLowerCase(); return SECTIONS.find((s) => s.id === h)?.id; };
  const initial = (): Id => fromHash(tab.url) ?? ((localStorage.getItem('owl.settings.section') as Id) || 'general');
  let section = $state<Id>(initial());
  // apply a deep-link hash once per distinct hash: tab objects are replaced on every state push, and
  // re-applying the same hash would yank the user back while they browse other sections
  let appliedHash: string | undefined = fromHash(tab.url);
  $effect(() => { const h = fromHash(tab.url); if (h && h !== appliedHash) { appliedHash = h; section = h; } });
  let scroller: HTMLElement | null = $state(null);
  function go(id: Id) { section = id; localStorage.setItem('owl.settings.section', id); scroller?.scrollTo({ top: 0 }); }

  let q = $state('');
  const matches = $derived(q.trim() ? SECTIONS.filter((s) => (s.label + ' ' + s.keys).toLowerCase().includes(q.trim().toLowerCase())) : SECTIONS);
  const Current = $derived(SECTIONS.find((s) => s.id === section)?.C ?? General);

  function navKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const ids = matches.map((s) => s.id);
    const i = ids.indexOf(section);
    const n = ids[(i + (e.key === 'ArrowDown' ? 1 : -1) + ids.length) % ids.length];
    if (n) { go(n); (document.getElementById('set-nav-' + n) as HTMLElement | null)?.focus(); }
  }
</script>

<div bind:this={scroller} class="h-full overflow-y-auto overflow-x-hidden">
  <div class="mx-auto grid w-full max-w-[1032px] grid-cols-[216px_minmax(0,1fr)] gap-10 px-8 pb-20 pt-10">
    <aside class="sticky top-10 self-start">
      <div class="mb-3 px-1 text-[20px] font-semibold leading-7 tracking-[-0.015em]">Settings</div>
      <Input bind:value={q} icon={Search} size="sm" pill placeholder="Find a setting" aria-label="Find a setting" type="search" class="mb-3"
        onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' && matches[0]) go(matches[0].id); }} />
      <nav aria-label="Settings sections" class="flex flex-col gap-0.5">
        {#each matches as s (s.id)}
          <button type="button" id="set-nav-{s.id}" onclick={() => go(s.id)} onkeydown={navKey} aria-current={section === s.id ? 'page' : undefined}
            class="flex h-[34px] items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[13.5px] transition-colors {section === s.id ? 'bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] font-medium text-ink' : 'text-ink-2 hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] hover:text-ink'}">
            <s.icon size={16} strokeWidth={1.75} class="shrink-0" />
            <span class="truncate">{s.label}</span>
          </button>
        {:else}
          <p class="px-2.5 py-2 text-[12.5px] text-ink-2">No settings match.</p>
        {/each}
      </nav>
    </aside>
    <main class="min-w-0 max-w-[720px]">
      {#key section}<Current />{/key}
    </main>
  </div>
</div>
