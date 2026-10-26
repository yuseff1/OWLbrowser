<script lang="ts" module>
  import { Telescope, UsersRound, Inbox, Radar, Tag, TextCursorInput, PenLine, ListChecks, Briefcase, Plane, Table, FileText, Sparkles, Search, Mail, Calendar, ShoppingCart, Code, ChartLine, Globe, Bot, Lightbulb, BookOpen, Megaphone, Camera, Music, Wrench, Zap } from '@lucide/svelte';
  export const ICONS: Record<string, any> = {
    telescope: Telescope, 'users-round': UsersRound, inbox: Inbox, radar: Radar, tag: Tag, 'text-cursor-input': TextCursorInput,
    'pen-line': PenLine, 'list-checks': ListChecks, briefcase: Briefcase, plane: Plane, table: Table, 'file-text': FileText,
    sparkles: Sparkles, search: Search, mail: Mail, calendar: Calendar, 'shopping-cart': ShoppingCart, code: Code, 'chart-line': ChartLine,
    globe: Globe, bot: Bot, lightbulb: Lightbulb, 'book-open': BookOpen, megaphone: Megaphone, camera: Camera, music: Music, wrench: Wrench, zap: Zap,
  };
</script>

<script lang="ts">
  let { name = 'sparkles', size = 16 }: { name?: string; size?: number } = $props();
  const I = $derived(ICONS[name] ?? Sparkles);
</script>
<I {size} strokeWidth={1.7} />
