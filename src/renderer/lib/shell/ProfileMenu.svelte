<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  import { Slider } from 'bits-ui';
  import { owl } from '../api';
  import { store } from '../stores.svelte';
  import { Segmented } from '../ui';
  import { prefs } from './prefs.svelte';
  import { profile } from './profile.svelte';

  let { close }: { close: () => void } = $props();
  const theme = $derived(store.settings?.theme ?? 'system');
  async function setTheme(t: 'light' | 'dark' | 'system') {
    const s = await owl.patchSettings({ theme: t });
    if (s) store.settings = s as any; else if (store.settings) store.settings.theme = t;
  }
  function openPage(u: string) { owl.newTab(u); close(); }
</script>

<div class="p-3">
  <div class="flex items-center gap-3 px-1 pb-3">
    <span class="avatar" aria-hidden="true">{profile.initial}</span>
    <div class="min-w-0">
      <div class="truncate text-[13.5px] font-semibold">{profile.name}</div>
      <div class="truncate text-[12px] text-ink-3">{store.win.incognito ? 'Incognito window' : profile.subtitle}</div>
    </div>
  </div>

  <div class="sec">
    <div class="lbl">Theme</div>
    <Segmented full size="sm" label="Theme" value={theme} onValueChange={setTheme}
      options={[{ value: 'light', label: 'Light', icon: 'weather-sunny' }, { value: 'dark', label: 'Dark', icon: 'weather-moon' }, { value: 'system', label: 'System', icon: 'desktop' }]} />
  </div>

  <div class="sec">
    <div class="lbl flex items-center justify-between">Profile colour <span class="swatch" style:background="var(--accent)"></span></div>
    <Slider.Root type="single" min={0} max={359} step={1} value={prefs.hue} onValueChange={(v) => prefs.setHue(v)} class="hue" aria-label="Profile colour">
      <Slider.Range class="hue-range" />
      <Slider.Thumb index={0} class="hue-thumb" />
    </Slider.Root>
  </div>

  <div class="sec">
    <div class="lbl">Layout</div>
    <div class="grid grid-cols-2 gap-2">
      {#each [{ v: 'classic', l: 'Classic', d: 'Tabs on top' }, { v: 'modern', l: 'Modern', d: 'Tabs on the side' }] as o (o.v)}
        <button class="lay" class:on={store.layout === o.v} aria-pressed={store.layout === o.v} onclick={() => store.setLayout(o.v as any)}>
          <span class="mini {o.v}" aria-hidden="true">
            {#if o.v === 'classic'}
              <i class="t"></i><i class="t s"></i><i class="t s"></i><b class="bar"></b><b class="pg"></b>
            {:else}
              <b class="side"><i></i><i></i><i></i><i></i></b><b class="pg"></b>
            {/if}
          </span>
          <span class="text-[12.5px] font-medium">{o.l}</span>
          <span class="text-[11.5px] text-ink-3">{o.d}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="mt-1 border-t border-line pt-1.5">
    <button class="link" onclick={() => openPage('owl://companions')}><Icon name="people" size={16} />Companions<Icon name="chevron-right" size={14} class="ml-auto text-ink-3" /></button>
    <button class="link" onclick={() => openPage('owl://memory')}><Icon name="brain-circuit" size={16} />Memory<Icon name="chevron-right" size={14} class="ml-auto text-ink-3" /></button>
    <button class="link" onclick={() => { owl.newWindow({ incognito: true }); close(); }}><Icon name="eye-off" size={16} />New incognito window</button>
    <button class="link" onclick={() => openPage('owl://settings')}><Icon name="settings" size={16} />Settings<Icon name="chevron-right" size={14} class="ml-auto text-ink-3" /></button>
  </div>
</div>

<style>
  .avatar { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 99px; background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: 14px; flex: none; }
  .sec { padding: 10px 4px; }
  .lbl { font-size: 12px; color: var(--ink-2); font-weight: 500; margin-bottom: 8px; }
  .swatch { width: 12px; height: 12px; border-radius: 99px; box-shadow: 0 0 0 2px var(--surface), 0 0 0 3px var(--line); }
  :global(.hue) {
    position: relative; display: flex; align-items: center; width: 100%; height: 14px; border-radius: 99px; touch-action: none;
    background: linear-gradient(90deg, oklch(0.65 0.17 0), oklch(0.65 0.17 60), oklch(0.65 0.17 120), oklch(0.65 0.17 180), oklch(0.65 0.17 240), oklch(0.65 0.17 300), oklch(0.65 0.17 359));
    box-shadow: inset 0 1px 2px rgba(0,0,0,.18);
  }
  :global(.hue-range) { display: none; }
  :global(.hue-thumb) {
    display: block; width: 20px; height: 20px; border-radius: 99px; background: var(--accent);
    box-shadow: 0 0 0 3px #fff, 0 2px 8px rgba(0,0,0,.3); outline: none;
  }
  :global(.hue-thumb:focus-visible) { box-shadow: 0 0 0 3px #fff, 0 0 0 5px color-mix(in srgb, var(--accent) 50%, transparent); }
  .lay { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 8px; border-radius: 14px; background: transparent; border: 0; color: var(--ink); text-align: left; box-shadow: inset 0 0 0 1px var(--line); font: inherit; }
  .lay:hover { background: color-mix(in srgb, var(--ink) 3%, transparent); }
  .lay.on { box-shadow: inset 0 0 0 1.5px var(--ink); }
  .mini { position: relative; display: block; width: 100%; height: 58px; margin-bottom: 6px; border-radius: 9px; background: var(--neu-bg); box-shadow: var(--neu-in); overflow: hidden; }
  .mini i, .mini b { position: absolute; display: block; border-radius: 3px; }
  .classic .t { top: 6px; left: 6px; width: 22px; height: 6px; background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
  .classic .t.s { left: 32px; background: color-mix(in srgb, var(--ink) 10%, transparent); box-shadow: none; }
  .classic .t.s + .t.s { left: 58px; }
  .classic .bar { top: 16px; left: 22%; right: 22%; height: 6px; border-radius: 99px; background: color-mix(in srgb, var(--ink) 10%, transparent); }
  .mini .pg { left: 6px; right: 6px; top: 27px; bottom: 6px; border-radius: 5px; background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
  .modern .side { top: 6px; left: 6px; bottom: 6px; width: 26%; }
  .modern .side i { position: relative; height: 5px; margin-bottom: 4px; border-radius: 3px; background: color-mix(in srgb, var(--ink) 10%, transparent); }
  .modern .side i:first-child { background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
  .modern .pg { left: calc(26% + 12px); top: 6px; }
  .link { display: flex; align-items: center; gap: 10px; width: 100%; height: 34px; padding: 0 8px; border-radius: 10px; border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 13px; }
  .link :global(svg:first-child) { color: var(--ink-2); }
  .link:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); }
</style>
