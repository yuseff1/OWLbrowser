/** Preview-only popup specs (`?popup=1&popupDemo=menu|menu-dark|suggest`) for design review of the popup layer. */
import type { PopupSpec } from '../ui/popup';

const ico = (d: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const plus = ico('<path d="M5 12h14"/><path d="M12 5v14"/>');
const clock = ico('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>');
const search = ico('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>');
const x = ico('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');

export function demoSpec(kind: string | null): (PopupSpec & { id: number }) | null {
  const dark = kind?.endsWith('-dark') ?? false;
  const theme = { dark, accent: dark ? '#F0B13A' : '#E8A317', accentInk: '#141317', platform: 'win32' };
  if (kind?.startsWith('menu')) return {
    id: 1, kind: 'menu', focus: true, keyboard: true, theme, anchor: { x: 1180, y: 44, width: 32, height: 32 }, side: 'bottom', align: 'end', width: 240,
    items: [
      { label: 'New tab', icon: plus, kbd: 'Ctrl+T' }, { label: 'New window', icon: plus, kbd: 'Ctrl+N' }, { separator: true },
      { label: 'History', icon: clock, kbd: 'Ctrl+H' }, { label: 'Find in page', icon: search, kbd: 'Ctrl+F', disabled: true }, { separator: true },
      { heading: 'Tab' }, { label: 'Close other tabs', icon: x, danger: true },
    ],
  };
  if (kind?.startsWith('suggest')) return {
    id: 2, kind: 'suggest', theme, inset: 20, rect: { x: 0, y: 0, width: 700, height: 6 * 36 + 12 + 40 }, sel: 1,
    items: [
      { title: 'github.com/varsen/owl', meta: 'github.com', icon: ico('<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/>') },
      { title: 'owl browser electron', prefix: 'Ask Hoot: ', avatar: './art/companions/hoot-face.webp' },
      { title: 'owl browser electron', meta: 'Google Search', icon: search },
      { title: 'OWL roadmap · varsen/owl', meta: 'github.com', icon: clock },
      { title: 'Owl — Wikipedia', meta: 'en.wikipedia.org', icon: clock },
      { title: 'Valencia → Lisbon · Skyscanner', meta: 'Switch to tab', icon: clock },
    ],
  };
  return null;
}
