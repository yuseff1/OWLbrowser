<script lang="ts">
  let { size = 14, class: cls = '', label = 'Loading' }: { size?: number; class?: string; label?: string } = $props();
</script>

<svg class="owl-spin {cls}" width={size} height={size} viewBox="0 0 16 16" role="status" aria-label={label}>
  <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-width="1.75" />
  <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
</svg>

<style>
  .owl-spin { animation: owl-rot 0.8s linear infinite; flex: none; }
  @keyframes owl-rot { to { transform: rotate(360deg); } }
</style>
