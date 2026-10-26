<script lang="ts">
  /** Flat grey placeholder at the real size of what it stands in for (no shimmer, no layout shift). */
  let { w = '100%', h = 14, r = 6, class: cls = '' }: { w?: string | number; h?: number; r?: number; class?: string } = $props();
</script>
<span aria-hidden="true" class="owl-skel {cls}" style:width={typeof w === 'number' ? w + 'px' : w} style:height="{h}px" style:border-radius="{r}px"></span>
