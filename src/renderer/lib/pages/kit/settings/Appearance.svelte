<script lang="ts">
  import { store } from '$lib/stores.svelte';
  import { prefs, BRAND_HUE } from '$lib/shell/prefs.svelte';
  import { Segmented } from '$lib/ui';
  import Section from './Section.svelte';
  import Group from './Group.svelte';
  import Row from '../Row.svelte';
  import { patch } from './patch';
  import { Monitor, Sun, Moon } from '@lucide/svelte';

  const s = $derived(store.settings);
  const WALLS = [
    { v: 'aurora', l: 'Aurora', bg: 'radial-gradient(80% 70% at 50% 0%, color-mix(in srgb, var(--accent) 35%, transparent), transparent), var(--ground)' },
    { v: 'dusk', l: 'Dusk', bg: 'linear-gradient(180deg, color-mix(in srgb, #ffb38a 40%, var(--ground)), var(--ground) 55%, color-mix(in srgb, #e8a317 22%, var(--ground)))' },
    { v: 'paper', l: 'Paper', bg: 'radial-gradient(var(--halftone) 1.2px, transparent 1.3px) 0 0 / 8px 8px, var(--ground)' },
    { v: 'none', l: 'Plain', bg: 'var(--ground)' },
  ] as const;
</script>

<Section title="Appearance" description="How OWL looks on this PC.">
  <Group>
    <Row title="Theme" description="System follows your Windows setting.">
      <Segmented value={s?.theme ?? 'system'} onValueChange={(v) => patch({ theme: v as any })} label="Theme" options={[{ value: 'system', label: 'System', icon: Monitor }, { value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon }]} />
    </Row>
    <Row title="Profile colour" description="Tints focus rings, progress and a few highlights.">
      <div class="flex w-[300px] items-center gap-3">
        <input type="range" min="0" max="360" step="1" value={prefs.hue} oninput={(e) => prefs.setHue(+(e.currentTarget as HTMLInputElement).value)} aria-label="Profile colour hue"
          class="hue h-5 flex-1 cursor-pointer appearance-none rounded-full bg-transparent" />
        <span class="size-6 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,.1)]" style:background="var(--accent)" aria-hidden="true"></span>
        <button type="button" class="owl-link shrink-0 text-[12.5px]" class:invisible={prefs.hue === BRAND_HUE} onclick={() => prefs.setHue(BRAND_HUE)}>Amber</button>
      </div>
    </Row>
    <Row title="Tab layout" description="Classic puts tabs on top; Modern keeps them in the sidebar as cards.">
      <Segmented value={store.layout} onValueChange={(v) => store.setLayout(v as any)} label="Tab layout" options={[{ value: 'classic', label: 'Classic' }, { value: 'modern', label: 'Modern' }]} />
    </Row>
  </Group>
  <Group label="New tab wallpaper" flush>
    <div class="grid grid-cols-4 gap-3" role="radiogroup" aria-label="New tab wallpaper">
      {#each WALLS as w (w.v)}
        {@const on = (s?.homeWallpaper ?? 'aurora') === w.v}
        <button type="button" role="radio" aria-checked={on} onclick={() => patch({ homeWallpaper: w.v })} class="flex flex-col gap-2 text-left">
          <span class="block aspect-[16/10] w-full rounded-xl transition-shadow" style:background={w.bg}
            style:box-shadow={on ? '0 0 0 2px var(--ground), 0 0 0 4px var(--ink)' : '0 0 0 1px var(--line)'}></span>
          <span class="px-0.5 text-[12.5px] {on ? 'font-medium text-ink' : 'text-ink-2'}">{w.l}</span>
        </button>
      {/each}
    </div>
  </Group>
</Section>

<style>
  .hue { background: linear-gradient(to right, oklch(.62 .17 0), oklch(.62 .17 60), oklch(.62 .17 120), oklch(.62 .17 180), oklch(.62 .17 240), oklch(.62 .17 300), oklch(.62 .17 360)); height: 8px; }
  .hue::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 99px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.35); }
</style>
