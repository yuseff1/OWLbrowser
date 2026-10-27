/** Ctrl+Shift+M: Chrome's "switch person" — a menu of profiles at the top-right of the window. */
import type { Profile } from '$shared/types';
import type { MenuItem } from '../ui/Menu.svelte';
import { owl } from '../api';
import { store } from '../stores.svelte';
import { hasPopupLayer, openMenu, type PopupHandle } from '../ui/popup';

let handle: PopupHandle | null = null;

export async function openProfileSwitcher() {
  if (handle?.open) { handle.close(); handle = null; return; }
  const r = (await owl.profiles().catch(() => null)) as { profiles: Profile[]; current: string } | null;
  const list = r?.profiles ?? [];
  const current = store.win.incognito ? '' : r?.current ?? '';
  if (!hasPopupLayer) { owl.newTab('owl://settings#profiles'); return; }
  const items: MenuItem[] = [
    { heading: 'Switch profile' },
    ...list.map((p): MenuItem => ({
      label: p.name + (p.id === current ? ' — this window' : ''),
      icon: p.id === current ? 'checkmark' : 'person',
      disabled: p.id === current,
      onSelect: () => owl.openProfile(p.id),
    })),
    { separator: true },
    { label: 'Open incognito window', icon: 'eye-off', kbd: 'Ctrl+Shift+N', onSelect: () => owl.command('incognito') },
    { label: 'Manage profiles', icon: 'person-swap', onSelect: () => owl.newTab('owl://settings#profiles') },
  ];
  // the visible profile button (toolbar when the sidebar is hidden, sidebar footer otherwise)
  const anchor = [...document.querySelectorAll('[data-profile-button]')].map((e) => e.getBoundingClientRect()).find((b) => b.width > 0);
  const low = !!anchor && anchor.top > innerHeight / 2;
  handle = openMenu({
    anchor: anchor ? { x: anchor.left, y: anchor.top, width: anchor.width, height: anchor.height } : { x: innerWidth - 160, y: 44, width: 0, height: 0 },
    point: !anchor, side: low ? 'top' : 'bottom', align: low ? 'start' : 'end', width: 260, items, keyboard: true,
  }, () => { handle = null; });
}
