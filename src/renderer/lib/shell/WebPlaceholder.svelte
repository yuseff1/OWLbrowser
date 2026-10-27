<script lang="ts">
  import Icon from '../ui/Icon.svelte';
  /** What sits under a native web view: in Electron the page covers it; in the browser preview it stands in for the page. */
  import type { TabState } from '$shared/types';
  import { hostOf } from '../api';
  import { isMock } from '../env';
  import TabIcon from './TabIcon.svelte';
  let { tab }: { tab: TabState } = $props();
</script>

{#if tab.sleeping}
  <div class="ph"><Icon name="weather-moon" size={20} class="text-ink-3" /><p class="text-[13px] text-ink-2">This tab is asleep to save memory. It wakes when you open it.</p></div>
{:else if isMock}
  <div class="mock" aria-hidden="true">
    <div class="mh"><TabIcon {tab} size={18} /><span>{hostOf(tab.url)}</span></div>
    <div class="mt"><b>{tab.title}</b></div>
    <div class="cols">
      <div class="lines">{#each [92, 84, 88, 60, 0, 90, 76, 82, 40] as w, i (i)}<i style:width="{w}%"></i>{/each}</div>
      <div class="box"></div>
    </div>
  </div>
{/if}

<style>
  .ph { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
  .mock { position: absolute; inset: 0; padding: 28px 40px; overflow: hidden; }
  .mh { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--ink-3); }
  .mt { margin-top: 26px; font-size: 26px; letter-spacing: -0.02em; color: var(--ink); max-width: 720px; }
  .mt b { font-weight: 600; }
  .cols { display: grid; grid-template-columns: 1.6fr 1fr; gap: 32px; margin-top: 28px; }
  .lines i { display: block; height: 10px; margin-bottom: 14px; border-radius: 6px; background: color-mix(in srgb, var(--ink) 7%, transparent); }
  .lines i[style*='width: 0%'] { margin-bottom: 28px; }
  .box { height: 220px; border-radius: 14px; background: color-mix(in srgb, var(--ink) 4%, transparent); }
</style>
