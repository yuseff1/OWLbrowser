# OWL UI ↔ main contract

The Svelte UI talks to Electron main ONLY through `window.owl` (see `src/preload/ui.ts`). All calls return Promises. Types are in `src/shared/types.ts` (import with `import type { ... } from '$shared/types'`).

Events: `owl.on((type, payload) => …)`:
- `state` → WindowState (tabs, activeTabId, splitTabId, profileId, incognito). Pushed on every change.
- `run` → AgentRun (live progress of any companion run in this profile).
- `chat-token` → { threadId, token }  (streaming quick chat)
- `find-result` → { tabId, active, total }
- `download` → DownloadItem (progress)
- `command` → { cmd, arg } — browser commands the UI must handle: 'focus-omnibox', 'find', 'find-next', 'find-prev', 'toggle-companion', 'palette', 'toggle-bookmarks-bar', 'toggle-sidebar', 'ask' (arg = prefilled prompt; open companion panel with it), 'bookmark-changed', 'app-menu' (Alt+F), 'home' (Alt+Home), 'clear-data' (Ctrl+Shift+Del), 'move-tab-left'/'move-tab-right' (Ctrl+Shift+PgUp/PgDn)
- `fullscreen` is also sent for window fullscreen (F11), so the chrome hides like Chrome's F11.
- Shortcuts (window.ts `handleShortcut`, Chrome parity): Ctrl+T/N/Shift+N/W/F4/Shift+W/Shift+T, Ctrl+L/E/Alt+D/F6, Ctrl+R/F5/Shift+R/Ctrl+F5, Ctrl+F, F3/Ctrl+G (+Shift), Ctrl+D, **Ctrl+J downloads, Ctrl+Shift+J companion**, Ctrl+K/Ctrl+Shift+A palette, Ctrl+H history, Ctrl+Shift+B/O, Ctrl+=/-/0, Ctrl+Tab/PgUp/PgDn (+Shift moves the tab), Ctrl+1–9, Alt+←/→, Alt+Home, F11, F12/Ctrl+Shift+I/C, Ctrl+P/S/Shift+S/U, Alt+F/E menu, Ctrl+\\ sidebar.
- `toast` → { title, body?, kind?: 'info'|'success'|'error' }
- `password-prompt` → { id, origin, username } (ask "Save password?" → call owl.savePassword(id, true|false))
- `fullscreen` → boolean (hide all chrome)
- `settings` → Settings

Returns:
- getState() → WindowState
- setBounds(bounds, splitBounds|null): the UI MUST report the pixel rect (relative to window, CSS px) where the web page should be drawn, whenever layout changes (ResizeObserver). Web pages are native views drawn ON TOP of the UI in that rect.
- popupShow(spec) / popupHide(id?) → the **popup layer**: a transparent WebContentsView main keeps above every page view, so menus and the omnibox dropdown draw over live pages (no freeze). The UI never calls these directly: use `lib/ui/popup.ts` (`openMenu`, `showPopup`). `Menu` and `ContextMenu` from `lib/ui` and the omnibox use it automatically in Electron and fall back to in-DOM rendering in the browser preview. spec = `{ id, kind: 'menu'|'suggest', rect?, focus?, theme, … }`; answers arrive as event `popup-event` `{ id, type: 'hover'|'select'|'dismiss', index? }`. Main dismisses it on window blur/resize/move. The layer document (`index.html?popup=1`, `lib/popup/PopupApp.svelte`) has no `owl:*` access.
- setOverlay(on) → when on=true returns a JPEG dataURL screenshot of the active page (or null); the native page view is hidden while overlay is on, so show the screenshot (blurred, glass) behind menus/popovers/palettes that would overlap the page area. Call setOverlay(false) when closed. Use for modal UI only (command palette, dialogs, popovers); `store.pushOverlay(rect?)` skips the freeze when no native page is underneath (internal pages) or the popover rect does not touch the page rect.
- newTab(url?='owl://newtab', {background?}) ; navigate(tabId, input) (input can be a URL or search words)
- Internal pages are tabs whose `internal` is one of newtab|settings|companions|history|downloads|bookmarks|memory|routines|artifact — the UI renders these itself in the page rect (no native view). Open them with newTab('owl://settings') etc. Settings sub-sections via hash: 'owl://settings#models'. Also: skills, apps, library, chats (chat history), agents (live bots dashboard).
- suggest(text) → Array<{ type: 'history'|'bookmark'|'search'|'url'|'tab'|'command', title, url, favicon? }>
- profiles() → { profiles: Profile[], current: string }
- bookmarks() → Bookmark[] ; toggleBookmark(url,title,favicon) → boolean ; isBookmarked(url) → boolean
- history(query='', offset=0, limit=200) → HistoryEntry[]
- downloads() → DownloadItem[]
- passwords() → PasswordEntry[] ; revealPassword(id) → string (after OS confirm)
- settings() → Settings ; patchSettings(partial) → Settings
- providers() → ModelProvider[] ; providerPresets() → Record<ProviderKind, {name, baseUrl, local, models, keyUrl?}>
- upsertProvider({ id?, kind, name?, baseUrl?, apiKey?, models?, enabled? }) → ModelProvider
- discoverModels(providerId) → string[] ; testModel({providerId, model}) → { ok, text?, error?, ms }
- memoryStats() → { totalMB, tabs: Array<{ id, title, mb, sleeping }> }
- importSources() → ImportSource[] ; importFrom(source, {bookmarks,history,passwords,extensions}) → ImportResult (errors[] contains NOTES, not failures) ; importPasswordsCsv() opens a file dialog → number
- extensions() → Array<{ id, name, version, path }> ; loadExtension() (folder picker) ; removeExtension(id)
- companions() → Companion[] ; saveCompanion(partial) → Companion ; removeCompanion(id)
- runs() → AgentRun[] ; startRun(companionId, task, { useCurrentTab?: boolean, background?: boolean }) → AgentRun
- stopRun(id) ; followUp(id, text) ; answerRun(id, text) ; approveRun(id, ok) ; takeover(id, on)
- chat(companionId, messages:[{role,content}], { threadId, withPage?: boolean }) → { text } (streams 'chat-token'). withPage=true includes the active tab's text as context.
- memory() → MemoryItem[] ; addMemory(text, kind) ; updateMemory(id, patch) ; removeMemory(id) ; clearMemory() ; searchMemory(q) → hits
- skills() → { mine: Skill[], official: Skill[] } (Skill = {id,name,description,icon,instructions}) ; saveSkill ; removeSkill
- routines() → Routine[] ; saveRoutine(partial) ; removeRoutine(id) ; runRoutine(id)
- apps() → Array<McpServerView> ({id,name,transport,url?,command?,args?,enabled,hasToken,status,error?,description?,icon?}) ; appCatalog() → Array<{id?, name, description, category, transport, url, needsToken, iconDomain}> ; saveApp(cfg & {token?}) ; removeApp(id) ; connectApp(id) → {ok, status, error?, tools?}
- artifacts() → Artifact[] ; artifact(id) → Artifact ; openArtifact(id) ; exportArtifact(id) (save dialog)
- onboarding() → { done: boolean, userName?: string, companionId?: string } ; completeOnboarding({ userName, companionId, companionName, look?, defaultModel?: { providerId, model } })
- renameBookmark(id, title) ; toggleBookmark / Ctrl+D emit event 'command' { cmd: 'bookmark-changed' }
- internal tab URLs keep their hash: owl://settings#models
- appInfo() → { version, electron, chrome, platform, userData, computerUse }
- memoryProfile() → UserProfile | null ({ static: string[], dynamic: string[], at, generated: 'llm'|'heuristic' }) ; refreshMemoryProfile() → UserProfile | null (one small LLM call)
- chats() → Thread[] (newest first; [] in incognito) ; saveChat(thread | thread[]) → count (upsert, newer updatedAt wins) ; removeChat(threadId). Thread = { id, title, companionId, createdAt, updatedAt, messages: [{ id, role, content, t, companionId, runId?, error?, withPage? }] }
- artifactUrl(id) → 'owl-artifact://a/<id>' : frame it with <iframe sandbox="allow-scripts …"> (no allow-same-origin). Served with its own CSP so inline scripts and https CDNs run; only the UI session can load it.

Art: `art/owl-mark.png`, `art/onboarding-hoot.png`, `art/companions/<id>.png|webp`, `art/companions/<id>-face.png|webp` for ids hoot, nova, pip, echo, atlas, byte, custom (served from src/renderer/public → './art/...').
