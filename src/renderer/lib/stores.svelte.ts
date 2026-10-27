import { owl, PROFILE_ID } from './api';
import type { WindowState, AgentRun, Settings, Companion, TabState } from '$shared/types';

/** Global reactive UI state (Svelte 5 runes, shared module state). */
class OwlStore {
  win = $state<WindowState>({ windowId: 0, profileId: PROFILE_ID, incognito: false, tabs: [], activeTabId: null, splitTabId: null });
  runs = $state<AgentRun[]>([]);
  settings = $state<Settings | null>(null);
  companions = $state<Companion[]>([]);
  /** right-side companion panel */
  panelOpen = $state(false);
  panelPrefill = $state('');
  /** set to a run id to open that run in the companion panel (panel opens, focuses the run's thread, then clears this) */
  panelRunId = $state<string | null>(null);
  /** left nav sidebar (Strawberry-style) */
  sidebarOpen = $state(true);
  layout = $state<'classic' | 'modern'>((localStorage.getItem('owl.layout') as any) || 'classic');
  paletteOpen = $state(false);
  findOpen = $state(false);
  fullscreen = $state(false);
  overlayShot = $state<string | null>(null);
  overlayCount = 0;
  toasts = $state<Array<{ id: number; title: string; body?: string; kind?: string }>>([]);
  activeCompanionId = $state(localStorage.getItem('owl.companion') || 'hoot');
  omniboxFocus = $state(0);
  /** bumped by Ctrl+F (focus + select the find field) and F3 / Ctrl+G (step through matches) */
  findFocus = $state(0);
  findStep = $state<{ n: number; forward: boolean }>({ n: 0, forward: true });
  /** the toolbar's "More" menu (Alt+F / Alt+E) */
  appMenuOpen = $state(false);

  get activeTab(): TabState | null { return this.win.tabs.find((t) => t.id === this.win.activeTabId) ?? null; }
  get activeCompanion(): Companion | null { return this.companions.find((c) => c.id === this.activeCompanionId) ?? this.companions[0] ?? null; }
  get liveRuns() { return this.runs.filter((r) => ['queued', 'running', 'waiting-approval', 'waiting-user', 'paused'].includes(r.status)); }

  setLayout(l: 'classic' | 'modern') { this.layout = l; localStorage.setItem('owl.layout', l); }
  setCompanion(id: string) { this.activeCompanionId = id; localStorage.setItem('owl.companion', id); }

  toast(title: string, body?: string, kind = 'info') {
    const id = Date.now() + Math.random();
    this.toasts.push({ id, title, body, kind });
    setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); }, 4200);
  }

  /** page rects last reported to main (window CSS px): where native page views draw */
  pageRects: Array<{ x: number; y: number; width: number; height: number }> = [];
  private frozen = false;

  /** true when something drawn at `rect` (or anywhere, without a rect) would sit under a native page view */
  needsFreeze(rect?: { left: number; top: number; right: number; bottom: number }) {
    if (this.fullscreen) return true;
    const split = this.win.splitTabId ? this.win.tabs.find((t) => t.id === this.win.splitTabId) : null;
    const native = [this.activeTab, split].filter((t) => t && !t.internal);
    if (!native.length) return false; // internal pages are drawn by the UI itself: nothing covers popovers
    if (!rect) return true;
    return this.pageRects.some((p) => rect.left < p.x + p.width && rect.right > p.x && rect.top < p.y + p.height && rect.bottom > p.y);
  }

  /**
   * Ref-counted page freeze for modal UI (dialogs, palette, popovers) that must sit over a web page:
   * hides the native view and shows a blurred screenshot. Skipped when nothing native is underneath.
   * Menus and the omnibox dropdown use the live popup layer instead (lib/ui/popup.ts).
   */
  async pushOverlay(rect?: { left: number; top: number; right: number; bottom: number }) {
    this.overlayCount++;
    if (this.frozen || !this.needsFreeze(rect)) return;
    this.frozen = true;
    const shot = (await owl.setOverlay(true)) as string | null;
    if (!this.frozen) { owl.setOverlay(false); return; } // closed while the screenshot was taken
    this.overlayShot = shot;
  }
  async popOverlay() {
    this.overlayCount = Math.max(0, this.overlayCount - 1);
    if (this.overlayCount === 0 && this.frozen) { this.frozen = false; this.overlayShot = null; await owl.setOverlay(false); }
  }

  async refreshCompanions() { this.companions = ((await owl.companions()) as Companion[]) || []; }
  async refreshRuns() { this.runs = ((await owl.runs()) as AgentRun[]) || []; }

  async init() {
    owl.on((type, payload) => {
      if (type === 'state') this.win = payload;
      else if (type === 'run') {
        const i = this.runs.findIndex((r) => r.id === payload.id);
        if (i >= 0) this.runs[i] = payload; else this.runs.unshift(payload);
      } else if (type === 'settings') this.settings = payload;
      else if (type === 'toast') this.toast(payload.title, payload.body, payload.kind);
      else if (type === 'fullscreen') this.fullscreen = payload;
      else if (type === 'command') this.onCommand(payload.cmd, payload.arg);
    });
    const [st, s] = await Promise.all([owl.getState(), owl.settings()]);
    if (st) this.win = st as WindowState;
    if (s) this.settings = s as Settings;
    await Promise.all([this.refreshCompanions(), this.refreshRuns()]);
  }

  onCommand(cmd: string, arg?: any) {
    switch (cmd) {
      case 'focus-omnibox': this.omniboxFocus++; break;
      case 'find': this.findOpen = true; this.findFocus++; break;
      case 'find-next': case 'find-prev':
        if (!this.findOpen) { this.findOpen = true; this.findFocus++; }
        else this.findStep = { n: this.findStep.n + 1, forward: cmd === 'find-next' };
        break;
      case 'app-menu': this.appMenuOpen = !this.appMenuOpen; break;
      case 'home': { const t = this.activeTab; if (t) owl.navigate(t.id, 'owl://newtab'); else owl.newTab(); break; }
      case 'clear-data': owl.newTab('owl://settings#privacy'); break;
      case 'move-tab-left': case 'move-tab-right': {
        const tabs = this.win.tabs, i = tabs.findIndex((t) => t.id === this.win.activeTabId);
        if (i < 0) break;
        const j = i + (cmd === 'move-tab-left' ? -1 : 1);
        // pinned tabs stay together at the start
        if (j >= 0 && j < tabs.length && !!tabs[j].pinned === !!tabs[i].pinned) owl.moveTab(tabs[i].id, j);
        break;
      }
      case 'toggle-companion': this.panelOpen = !this.panelOpen; break;
      case 'palette': this.paletteOpen = !this.paletteOpen; break;
      case 'toggle-sidebar': this.sidebarOpen = !this.sidebarOpen; break;
      case 'ask': this.panelOpen = true; this.panelPrefill = String(arg || ''); break;
      case 'toggle-bookmarks-bar': if (this.settings) owl.patchSettings({ showBookmarksBar: !this.settings.showBookmarksBar }).then((s: any) => (this.settings = s)); break;
    }
  }
}

export const store = new OwlStore();
