<script lang="ts">
  let { size = 18, class: cls = '' }: { size?: number; class?: string } = $props();
</script>

<svg class={cls} width={size} height={size} viewBox="0 0 96 96" aria-hidden="true">
  <path fill="currentColor" fill-rule="evenodd" d="M6 44A21 21 0 1 1 48 44A21 21 0 1 1 6 44ZM48 44A21 21 0 1 1 90 44A21 21 0 1 1 48 44ZM18 44A9 9 0 1 0 36 44A9 9 0 1 0 18 44ZM60 44A9 9 0 1 0 78 44A9 9 0 1 0 60 44ZM48 94L12.298 58.995L27 62L69 62L83.702 58.995ZM6 4L30 26L6 26ZM90 4L90 26L66 26Z" />
</svg>
