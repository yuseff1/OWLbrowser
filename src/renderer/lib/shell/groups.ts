import type { TabGroup, TabGroupColor, TabState } from '$shared/types';

/**
 * Tab-group palette: Chrome's nine hues, muted so they sit on the warm glass chrome without glowing.
 * `dark` variants are a touch lighter to keep contrast on the dark theme.
 */
export const GROUP_COLORS: Record<TabGroupColor, { light: string; dark: string; name: string }> = {
  grey: { light: '#7C828C', dark: '#9AA0A8', name: 'Grey' },
  blue: { light: '#4C7BD0', dark: '#7FA3E6', name: 'Blue' },
  red: { light: '#C8564F', dark: '#E07C74', name: 'Red' },
  yellow: { light: '#E8A317', dark: '#EDB443', name: 'Amber' },
  green: { light: '#4A9467', dark: '#6FB98B', name: 'Green' },
  pink: { light: '#C95F86', dark: '#E08AA9', name: 'Pink' },
  purple: { light: '#7E70B3', dark: '#A497D1', name: 'Lavender' },
  cyan: { light: '#3A93A6', dark: '#62B6C7', name: 'Teal' },
  orange: { light: '#D2733A', dark: '#E8955F', name: 'Orange' },
};
export const GROUP_COLOR_ORDER: TabGroupColor[] = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

/** CSS custom-property value for a group colour; both themes resolve through --gc-l / --gc-d */
export function groupStyle(c: TabGroupColor | undefined) {
  const v = GROUP_COLORS[c ?? 'grey'] ?? GROUP_COLORS.grey;
  return `--gc-l:${v.light};--gc-d:${v.dark}`;
}

/** a strip row: a group chip (before the group's first tab) or a tab (hidden when its group is collapsed) */
export type StripItem = { kind: 'chip'; group: TabGroup; count: number } | { kind: 'tab'; tab: TabState; group: TabGroup | null; last: boolean };

export function stripItems(tabs: TabState[], groups: TabGroup[]): StripItem[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out: StripItem[] = [];
  tabs.forEach((t, i) => {
    const g = (t.groupId && byId.get(t.groupId)) || null;
    if (g && tabs[i - 1]?.groupId !== g.id) out.push({ kind: 'chip', group: g, count: tabs.filter((x) => x.groupId === g.id).length });
    if (g?.collapsed) return;
    out.push({ kind: 'tab', tab: t, group: g, last: !!g && tabs[i + 1]?.groupId !== g.id });
  });
  return out;
}

/** label shown on the chip and in menus */
export const groupLabel = (g: TabGroup, count?: number) => g.title || (count != null ? `${count} tab${count === 1 ? '' : 's'}` : 'Unnamed group');
