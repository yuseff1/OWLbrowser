<script lang="ts">
  import type { SVGAttributes } from 'svelte/elements';
  import { iconArt, type IconName } from './icons';

  type Props = Omit<SVGAttributes<SVGSVGElement>, 'name'> & {
    name: IconName;
    /** rendered px; 14 / 16 / 20 are the house sizes */
    size?: number;
    /** filled art, for active / selected states only */
    filled?: boolean;
  };
  let { name, size = 16, filled = false, class: cls = '', ...rest }: Props = $props();
  const art = $derived(iconArt(name, size, filled));
  const labelled = $derived(!!(rest['aria-label'] || rest['aria-labelledby']));
</script>

<svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 {art.box} {art.box}" fill="currentColor"
  aria-hidden={labelled ? undefined : 'true'} role={labelled ? 'img' : undefined} focusable="false"
  class="owl-icon {cls}" {...rest}>
  {#each art.d as d, i (i)}<path {d} />{/each}
</svg>

<style>
  .owl-icon { flex-shrink: 0; }
</style>
