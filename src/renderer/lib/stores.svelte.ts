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

  /** ref-counted overlay: hides native page views and shows a frozen glass screenshot behind popovers */
  async pushOverlay() {
    this.overlayCount++;
    if (this.overlayCount === 1) this.overlayShot = (await owl.setOverlay(true)) as string | null;
  }
  async popOverlay() {
    this.overlayCount = Math.max(0, this.overlayCount - 1);
    if (this.overlayCount === 0) { await owl.setOverlay(false); this.overlayShot = null; }
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
      case 'find': this.findOpen = true; break;
      case 'toggle-companion': this.panelOpen = !this.panelOpen; break;
      case 'palette': this.paletteOpen = !this.paletteOpen; break;
      case 'toggle-sidebar': this.sidebarOpen = !this.sidebarOpen; break;
      case 'ask': this.panelOpen = true; this.panelPrefill = String(arg || ''); break;
      case 'toggle-bookmarks-bar': if (this.settings) owl.patchSettings({ showBookmarksBar: !this.settings.showBookmarksBar }).then((s: any) => (this.settings = s)); break;
    }
  }
}

export const store = new OwlStore();
