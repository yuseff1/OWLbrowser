# UI → main / shell requests (from internal pages, lib/pages)

Requests from the internal-pages engineer. Nothing here is required for the pages to work today; each item says what the page does meanwhile.

## For main (src/main, src/preload)

1. **Keep the hash on internal tab URLs.** `newTab('owl://settings#models')` opens Settings, but `Tab.state().url` is rebuilt as `owl://${internal}`, so the `#models` part is lost. Please store the hash on the Tab (e.g. `this.hash`) and return `owl://settings#models` in `state().url`, and keep it when `navigate()` replaces a newtab with an internal page.
   *Meanwhile:* Settings reads the hash from `tab.url` when present, otherwise the last section the user opened (localStorage `owl.settings.section`).
2. **`memoryProfile()` → `UserProfile | null`** (`{ static: string[], dynamic: string[], at, generated }`, already computed in `agents/memory.ts`). The Memory page wants to show "What OWL knows about you" at the top.
   *Meanwhile:* the page builds a summary from pinned items and counts per kind.
3. **Persisted quick-chat threads.** `chat()` streams but threads are not stored, so the Chats page can only list agent runs. Suggested: `chats() → Array<{ threadId, companionId, title, messages: ChatMessage[], updatedAt }>` and `removeChat(threadId)`.
   *Meanwhile:* the shell keeps panel threads in localStorage (`lib/threads.svelte.ts`); Chats lists those threads plus runs that aren't in a thread. Main-side storage would make them survive a profile reset/sync and be searchable by companions.
4. **Document what already exists** in `docs/ui-contract.md`: `appInfo().computerUse` (boolean), `searchMemory()` returns `MemoryHit[]` (`{ id, layer: 'memory'|'observation'|'session', title, kind, at, score }`), `removeArtifact`, `disconnectApp`, `removeProvider`, `isDefaultBrowser`, `openWebStore`, `createProfile/renameProfile/removeProfile/openProfile`, `removeHistory`, `removePassword`.
5. **Routine run history.** `Routine.lastResult` only keeps the last one. A `runs` filter by `routineId` is enough (runs already carry `routineId`), so no change needed if runs are kept long enough; please confirm the run list is not truncated aggressively.

6. **Expose `renameBookmark(id, title)`** (already in `data.ts` as `bookmarks.rename`) and ideally `moveBookmark(id, folder)`.
   *Meanwhile:* Bookmarks rename calls `owl.renameBookmark` when it exists, otherwise removes and re-adds the bookmark (it lands in "Bookmarks bar").
7. **Artifacts with scripts.** The Artifact page renders `artifact.html` in `<iframe sandbox="allow-scripts" srcdoc>`. A srcdoc frame inherits the UI's CSP (`script-src 'self'` in index.html), so inline `<script>` in an artifact (charts, small apps) is blocked. Suggested: serve artifacts from a custom protocol, e.g. `owl-artifact://<id>` with its own permissive CSP and no Node access, and the page will switch to `<iframe src>`; or relax `frame-src`/CSP for sandboxed frames. Static HTML/CSS artifacts render fine today.

## For the shell (lib/ui, lib/shell, stores)

1. ~~`.md > * + *` in ui.css collided with `size="md"` buttons~~ — done (renamed to `.owl-prose`).
2. ~~Open a specific run in the panel~~ — done: pages now set `store.panelRunId` (NewTab composer, NewTab live cards, Agents "Open", Agents foreground spin-up, Chats "Continue").
3. **PageHost route list** (all pages take `{ tab }`): `newtab → NewTab`, `companions → Companions`, `agents → Agents`, `chats → Chats`, `routines → Routines`, `skills → Skills`, `apps → Apps`, `library → Library`, `artifact → Artifact`, `memory → Memory`, `history → History`, `downloads → Downloads`, `bookmarks → Bookmarks`, `settings → Settings`. Everything in `lib/pages/kit/` is internal to the pages (not routes).

### Shell replies (from the shell engineer)

- **1 (`.md` collision): fixed.** Markdown output now uses `.owl-prose` (and `.owl-prose-table`); `lib/markdown.ts` emits those classes.
- **2 (open a run in the panel): done.** Set `store.panelRunId = run.id`. The panel opens, finds or creates the thread that shows that run (live `RunView` with approve / answer / take over / stop / follow-up), switches to the run's companion, then clears `panelRunId`.
- **3 (routes): matches** `lib/pages/PageHost.svelte`, which loads pages through `import.meta.glob('./*.svelte')`, so a missing page shows a quiet placeholder instead of breaking the build.
- **Quick-chat threads (main request 3) meanwhile:** the panel persists threads in `localStorage['owl.threads']` via `import { threads } from '$lib/threads.svelte'` (`threads.list`, `threads.recent`, `threads.open(id)`, `threads.remove(id)`, `threads.openRun(run)`). Shape: `{ id, title, companionId, createdAt, updatedAt, messages: [{ id, role, content, t, companionId, runId?, error? }] }`. The Chats page can list these alongside runs; to reopen one: `threads.open(id); store.panelOpen = true`.

## From the shell (lib/shell, App.svelte) → main

1. **An always-on-top overlay layer for chrome popups.** Native web views cover the page rect, so anything the shell draws over the page (tooltips under the toolbar, toasts, context menus, the omnibox dropdown) is hidden unless we freeze the page with `setOverlay(true)`. That freeze costs a screenshot round-trip and kills video/animation while a menu is open. Ask: a transparent `WebContentsView` for UI popups stacked above page views (Chrome's approach), or `setOverlayRegion(rects[])` that only cuts the native view where a popup sits.
   *Meanwhile:* menus/popovers/palette/omnibox dropdown use `pushOverlay()` (frozen glass screenshot); toasts sit in the toolbar band; the find bar is a strip that shrinks the page rect; tooltips can be clipped where they overlap the page.
2. **Agent views show through internal pages.** In `window.ts layout()`, background agent tabs are `setVisible(true)` at `this.bounds` (`v.setVisible(show || !!t.agentId)`). When the active tab is internal (newtab/settings…, no native view), nothing covers them, so an agent's page draws on top of the internal page. Please keep agent views rendering offscreen (e.g. bounds moved off-window, or `setVisible(false)` + `webContents.setBackgroundThrottling(false)`) whenever they are not the active/split tab.
3. **`Ctrl+Shift+J` never reaches 'downloads'.** In `handleShortcut`, `ctrl && k === 'j'` → `toggle-companion` is tested before `ctrl && shift && k === 'j'`. Move the shift variant above it.
4. **Split view order.** `setBounds(bounds, split)` gives the active tab `bounds` and the split tab `split`. The shell draws the active tab on the left and the split tab on the right; please keep that mapping.
5. **Theme for the window-controls overlay.** `updateTitleBar()` reads `settings.theme`; with `system` it follows `nativeTheme`, which matches the shell. Nothing to change unless the profile colour should tint the symbols.
6. **`completeOnboarding` with a model.** Onboarding sets `patchSettings({ defaultModel })` itself before finishing; if main would rather receive it, accept an optional `defaultModel` in `completeOnboarding`.
7. **Bounds during onboarding / before first layout.** The shell sends `setBounds({0,0,0,0}, null)` while onboarding is up. Please hide native views for a zero-size rect rather than drawing them at 0×0.
8. **Document** `windowControl('maximize')` toggling restore (double-click on the tab strip uses it) and `newWindow({ incognito })`.

### Main replies (audit, 2026-10-26)

- **Main 1 (hash on internal URLs): done.** `Tab.hash` keeps `#section`; `state().url` is `owl://settings#models`. Settings applies a hash once per distinct value, so state pushes no longer snap the page back.
- **Main 6 (`renameBookmark`): done.** `owl.renameBookmark(id, title)`. `toggleBookmark` and Ctrl+D now emit `command { cmd: 'bookmark-changed' }`; BookmarksBar and Omnibox listen for it (they listened for `bookmark-added`, which main never sent).
- **Shell 2 (agent views through internal pages): done.** Background agent views stay visible to Chromium but are parked off-window (`x = -width - 64`) at a real size, so they keep rendering and can be screenshotted without covering the page area.
- **Shell 3 (Ctrl+Shift+J): done.** Same bug for Ctrl+Shift+S (toggle-split was shadowed by Ctrl+S save-page): fixed too.
- **Shell 6 (`completeOnboarding` with a model): done.** Accepts optional `defaultModel: { providerId, model }`; Onboarding can keep calling `patchSettings` too.
- **Shell 7 (zero rect): done.** A 0×0 (or negative) rect hides page views instead of drawing them at 1×1.
- **Shell 1 (overlay layer for popups): not done.** Needs a transparent always-on-top `WebContentsView` for menus (its own preload/IPC); the frozen-screenshot overlay stays meanwhile.
