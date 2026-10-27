<script lang="ts" module>
  import type { IconName } from '../../ui/icons';
  /** Skill icon ids are saved with each skill, so the ids stay as they were; the values are Fluent icon names. */
  export const ICONS: Record<string, IconName> = {
    telescope: 'search-sparkle', 'users-round': 'people', inbox: 'mail-inbox', radar: 'radar', tag: 'tag', 'text-cursor-input': 'textbox',
    'pen-line': 'pen', 'list-checks': 'task-list-ltr', briefcase: 'briefcase', plane: 'airplane', table: 'table', 'file-text': 'document-text',
    sparkles: 'sparkle', search: 'search', mail: 'mail', calendar: 'calendar-ltr', 'shopping-cart': 'cart', code: 'code', 'chart-line': 'data-line',
    globe: 'globe', bot: 'bot', lightbulb: 'lightbulb', 'book-open': 'book-open', megaphone: 'megaphone', camera: 'camera', music: 'music-note-2', wrench: 'wrench', zap: 'flash',
  };
</script>

<script lang="ts">
  import Icon from '../../ui/Icon.svelte';
  let { name = 'sparkles', size = 16 }: { name?: string; size?: number } = $props();
</script>
<Icon name={ICONS[name] ?? 'sparkle'} {size} />
