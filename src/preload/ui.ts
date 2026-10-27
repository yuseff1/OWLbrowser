import { contextBridge, ipcRenderer } from 'electron';

/**
 * The OWL UI ↔ main contract. Exposed as `window.owl` in the Svelte UI.
 * Every method maps to ipcMain.handle('owl:<name>').
 */
const call = (name: string) => (...args: any[]) => ipcRenderer.invoke('owl:' + name, ...args);

const api = {
  platform: process.platform,
  // events from main: 'state' (WindowState), 'run' (AgentRun), 'find-result', 'download', 'command', 'toast', 'password-prompt', 'fullscreen', 'settings', 'snapshot'
  on(cb: (type: string, payload: any) => void) {
    const h = (_e: any, type: string, payload: any) => cb(type, payload);
    ipcRenderer.on('owl:event', h);
    return () => ipcRenderer.removeListener('owl:event', h);
  },

  // ---- popup layer (menus / omnibox dropdown drawn above native page views; see lib/ui/popup.ts)
  // UI → main: show/replace the popup ({ id, kind, rect?, focus?, ... }) or hide it. Answers arrive as event 'popup-event' { id, type, index? }.
  popupShow: (spec: unknown) => ipcRenderer.send('owl-popup:show', spec),
  popupHide: (id?: number) => ipcRenderer.send('owl-popup:hide', id),
  // used only by the popup renderer itself (?popup=1): it receives event 'popup' (spec | null)
  popupReady: () => ipcRenderer.send('owl-popup:ready'),
  popupEmit: (evt: unknown) => ipcRenderer.send('owl-popup:event', evt),

  // ---- window / tabs
  getState: call('getState'),
  setBounds: call('setBounds'), // (bounds, splitBounds|null)
  setOverlay: call('setOverlay'), // (on:boolean) → returns screenshot dataURL of active tab (for glass backdrop) when on
  newTab: call('newTab'), // (url?, opts?)
  closeTab: call('closeTab'),
  activateTab: call('activateTab'),
  moveTab: call('moveTab'), // (id, index)
  navigate: call('navigate'), // (tabId, input) input = url or search text
  back: call('back'), forward: call('forward'), reload: call('reload'), stop: call('stop'),
  pinTab: call('pinTab'), muteTab: call('muteTab'), duplicateTab: call('duplicateTab'),
  sleepTab: call('sleepTab'), reopenClosed: call('reopenClosed'),
  setSplit: call('setSplit'), // (tabId|null)
  zoom: call('zoom'), // (tabId, delta|'reset')
  find: call('find'), // (tabId, text, {forward, findNext})
  stopFind: call('stopFind'),
  devtools: call('devtools'), print: call('print'),
  command: call('command'), // (cmd, arg) run a browser command (same as shortcuts)
  windowControl: call('windowControl'), // ('minimize'|'maximize'|'close'|'fullscreen')
  newWindow: call('newWindow'), // ({profileId?, incognito?})
  suggest: call('suggest'), // (text) → omnibox suggestions
  pageInfo: call('pageInfo'), // (tabId) → { url, title, secure }

  // ---- profiles
  profiles: call('profiles'),
  createProfile: call('createProfile'), renameProfile: call('renameProfile'), removeProfile: call('removeProfile'),
  openProfile: call('openProfile'),

  // ---- data
  bookmarks: call('bookmarks'), toggleBookmark: call('toggleBookmark'), removeBookmark: call('removeBookmark'), renameBookmark: call('renameBookmark'), isBookmarked: call('isBookmarked'),
  history: call('history'), removeHistory: call('removeHistory'), clearHistory: call('clearHistory'),
  downloads: call('downloads'), openDownload: call('openDownload'), showDownload: call('showDownload'), cancelDownload: call('cancelDownload'), clearDownloads: call('clearDownloads'),
  clearBrowsingData: call('clearBrowsingData'), // ({cache, cookies, history})

  // ---- passwords
  passwords: call('passwords'), removePassword: call('removePassword'), savePassword: call('savePassword'), revealPassword: call('revealPassword'),

  // ---- settings & models
  settings: call('settings'), patchSettings: call('patchSettings'),
  providers: call('providers'), providerPresets: call('providerPresets'), upsertProvider: call('upsertProvider'), removeProvider: call('removeProvider'),
  discoverModels: call('discoverModels'), testModel: call('testModel'),
  setDefaultBrowser: call('setDefaultBrowser'), isDefaultBrowser: call('isDefaultBrowser'),
  memoryStats: call('memoryStats'), // RAM usage per tab
  appInfo: call('appInfo'),

  // ---- import
  importSources: call('importSources'), importFrom: call('importFrom'), importPasswordsCsv: call('importPasswordsCsv'),

  // ---- extensions
  extensions: call('extensions'), loadExtension: call('loadExtension'), removeExtension: call('removeExtension'), openWebStore: call('openWebStore'),

  // ---- companions & agents
  companions: call('companions'), saveCompanion: call('saveCompanion'), removeCompanion: call('removeCompanion'),
  runs: call('runs'), startRun: call('startRun'), // (companionId, task, {useCurrentTab, background}) → AgentRun
  stopRun: call('stopRun'), followUp: call('followUp'), answerRun: call('answerRun'), approveRun: call('approveRun'), takeover: call('takeover'),
  chat: call('chat'), // quick streaming chat: (companionId, messages) → text ; tokens arrive via 'chat-token' events

  // ---- memory / skills / routines / apps / library
  memory: call('memory'), addMemory: call('addMemory'), updateMemory: call('updateMemory'), removeMemory: call('removeMemory'), clearMemory: call('clearMemory'), searchMemory: call('searchMemory'),
  memoryProfile: call('memoryProfile'), refreshMemoryProfile: call('refreshMemoryProfile'), // → UserProfile | null
  chats: call('chats'), saveChat: call('saveChat'), removeChat: call('removeChat'), // persisted companion threads
  skills: call('skills'), saveSkill: call('saveSkill'), removeSkill: call('removeSkill'),
  routines: call('routines'), saveRoutine: call('saveRoutine'), removeRoutine: call('removeRoutine'), runRoutine: call('runRoutine'),
  apps: call('apps'), appCatalog: call('appCatalog'), saveApp: call('saveApp'), removeApp: call('removeApp'), connectApp: call('connectApp'), disconnectApp: call('disconnectApp'),
  artifacts: call('artifacts'), artifact: call('artifact'), removeArtifact: call('removeArtifact'), artifactUrl: call('artifactUrl'), openArtifact: call('openArtifact'), exportArtifact: call('exportArtifact'),

  // ---- onboarding
  onboarding: call('onboarding'), completeOnboarding: call('completeOnboarding'), // ({ userName?, companionId?, companionName?, look?, defaultModel?: { providerId, model } })

  // ---- auto-update (electron-updater; status changes also arrive as event 'update' → UpdateStatus)
  getUpdateStatus: call('getUpdateStatus'), // → UpdateStatus
  checkForUpdates: call('checkForUpdates'), // → UpdateStatus after the check (errors in .error, never throws)
  installUpdate: call('installUpdate'), // → boolean (true: OWL restarts into the downloaded update)
};

contextBridge.exposeInMainWorld('owl', api);
export type OwlApi = typeof api;
