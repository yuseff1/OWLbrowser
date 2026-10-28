import { createStore } from '@/lib/store';

/** What the long-press link menu is showing (null = closed). */
export type LinkTarget = { tabId: string; href: string; src: string; text: string };
/** Find-in-page session for the active tab (null = closed). index is 0-based, -1 = no match. */
export type FindState = { tabId: string; query: string; count: number; index: number };

export const pageUiStore = createStore<{ link: LinkTarget | null; find: FindState | null }>({ link: null, find: null });
