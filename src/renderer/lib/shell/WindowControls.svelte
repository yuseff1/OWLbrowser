<script lang="ts">
  /**
   * Minimize / maximize / close for Linux. The window is frameless there and, unlike Windows
   * (titleBarOverlay) and macOS (traffic lights), Electron draws no caption buttons, so without these
   * the window could not be closed or resized from the chrome.
   */
  import { owl } from '../api';
  import { Minus, Square, X } from '@lucide/svelte';
</script>

<div class="wcs no-drag" role="group" aria-label="Window">
  <button class="wcb" aria-label="Minimize" title="Minimize" onclick={() => owl.windowControl('minimize')}><Minus size={15} strokeWidth={1.7} /></button>
  <button class="wcb" aria-label="Maximize" title="Maximize" onclick={() => owl.windowControl('maximize')}><Square size={12} strokeWidth={1.7} /></button>
  <button class="wcb close" aria-label="Close window" title="Close" onclick={() => owl.windowControl('close')}><X size={16} strokeWidth={1.7} /></button>
</div>

<style>
  .wcs { display: flex; align-items: center; justify-content: flex-end; gap: 2px; height: 100%; padding-right: 6px; }
  .wcb { display: grid; place-items: center; width: 34px; height: 28px; border-radius: 8px; border: 0; background: transparent; color: var(--ink-2); }
  .wcb:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink); }
  .wcb.close:hover { background: #d43a3f; color: #fff; }
</style>
