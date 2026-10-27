# OWL roadmap

Source of truth for the overnight build loop. Tick only after verification.

## v0.1 — usable daily (deadline 2026-10-27 19:45 CET)
- [x] Main process: windows, tabs, sessions, profiles, settings, IPC (`src/main/main.ts`)
- [x] Agent runtime, browser tools, memory (hybrid recall), skills, routines, MCP
- [x] Adblock (Ghostery)
- [x] Brand: Tangent Owl icon (ico/png/svg)
- [x] Renderer shell: tabs, toolbar, omnibox, sidebar, companion panel, onboarding, overlays
- [x] Internal pages: new tab, settings, companions, agents, chats, routines, skills, apps, library, memory, history, downloads, bookmarks
- [x] Local checks: tsc main, svelte-check, vite build
- [x] CI: Windows NSIS + ZIP build green, nightly release published
- [x] Main ← UI requests (docs/ui-requests.md): overlay layer for popups over native views (popup layer WebContentsView; runtime-probed headless)
- [x] Hide background agent views when an internal page is active (parked off-window)
- [x] Ctrl+Shift+J → downloads (shortcut order; Ctrl+Shift+S split too)
- [x] Settings deep link hash (`owl://settings#models`)
- [x] Chats API in main (`chats/saveChat/removeChat`, threads.ts; UI migrates localStorage once)
- [x] `renameBookmark` IPC
- [x] Memory profile API for the Memory page (`memoryProfile`)
- [x] Artifact sandbox frame with its own CSP so scripted artifacts run (`owl-artifact://`)
- [x] Hide native views when page rect is zero
- [x] `completeOnboarding` accepts defaultModel
- [ ] Windows runtime smoke test (launch, browse, import Chrome, run Hoot)

- [x] Security audit: owl-ui:// origin, IPC sender check, agent URL guard, fuses (docs/security-audit.md)
- [ ] Auto-update from GitHub releases (electron-updater)
- [ ] Agent end-to-end check with a cloud + local model (mock OpenAI-compatible server test)

## v0.1.x — daily Chrome replacement (night 2026-10-27)
- [x] Secrets via safeStorage everywhere + migration of base64/legacy values; honest "not encrypted" on Linux basic_text
- [x] Real OS name in Settings copy (Windows/macOS/Linux)
- [x] One shared content width for internal pages; new tab fits 1376×880
- [x] Omnibox: dedupe by normalised URL, favicon fallback, Escape → restore + focus page, inline autocomplete
- [x] Incognito agent runs use the incognito session, never persisted/learned
- [x] Removing a profile deletes its folders (queued if locked)
- [x] Popup downloads from agent pages quarantined; quarantined downloads never open
- [x] PDF viewer in tab (plugins)
- [x] Per-site zoom, remembered
- [x] Site settings page (permissions per origin, zoom, reset/clear data)
- [x] Reopen closed window (Ctrl+Shift+T)
- [x] Media context menu: PiP, loop, controls, mute (any player)
- [x] Tab groups (named, coloured, collapsible; restored with the session)
- [ ] Reader mode
- [ ] Download shelf / bubble with progress per file
- [x] Permission prompt as a non-modal bubble under the address bar, with Chrome's undecided state (`default` / `prompt`)
- [ ] Windows runtime smoke test of this build

### Keyboard shortcut parity (Chrome → OWL)
| Shortcut | Action | OWL |
|---|---|---|
| Ctrl+T / Ctrl+N / Ctrl+Shift+N | new tab / window / incognito | ✅ |
| Ctrl+W, Ctrl+F4 / Ctrl+Shift+W | close tab / window | ✅ |
| Ctrl+Shift+T | reopen closed tab or window | ✅ (window since this build) |
| Ctrl+Tab, Ctrl+PgDn / Ctrl+Shift+Tab, Ctrl+PgUp | next / previous tab | ✅ |
| Ctrl+1…8 / Ctrl+9 | go to tab / last tab | ✅ |
| Ctrl+Shift+PgUp/PgDn | move tab | ✅ |
| Ctrl+L, Alt+D, F6, Ctrl+E | focus address bar | ✅ |
| Esc (address bar) | restore URL, focus page | ✅ (this build) |
| Ctrl+Enter / Alt+Enter (address bar) | www.….com / open in new tab | ✅ |
| Ctrl+R, F5 / Ctrl+Shift+R, Ctrl+F5 | reload / hard reload | ✅ |
| Alt+←/→ | back / forward | ✅ |
| Alt+Home | home | ✅ |
| Ctrl+F, F3, Ctrl+G, Shift+F3 | find / next / previous | ✅ |
| Ctrl+D / Ctrl+Shift+B / Ctrl+Shift+O | bookmark / bookmarks bar / bookmarks | ✅ |
| Ctrl+H / Ctrl+J | history / downloads | ✅ |
| Ctrl+Shift+A | search tabs (palette) | ✅ |
| Ctrl+Shift+Delete | clear browsing data | ✅ |
| Ctrl+= / Ctrl+- / Ctrl+0 | zoom in / out / reset (remembered per site) | ✅ |
| Ctrl+P / Ctrl+S / Ctrl+U | print / save page / view source | ✅ |
| F12, Ctrl+Shift+I, Ctrl+Shift+C | devtools | ✅ |
| F11 | fullscreen | ✅ |
| Alt+F, Alt+E | app menu | ✅ |
| Ctrl+Shift+J (Chrome: devtools console) | OWL: toggle companion | ⚠️ differs on purpose |
| Ctrl+K | OWL: command palette | OWL extra |
| Ctrl+Shift+S / Ctrl+\ | OWL: split view / sidebar | OWL extra |
| Ctrl+Shift+M | switch profile | ❌ not yet |
| Shift+Esc | task manager | ❌ not yet (Settings › Performance shows RAM per tab) |

## v0.2
- [ ] Code signing, auto-update
- [ ] Computer-use polish, extension store install
- [ ] Mobile: device test, signed APK, iOS via EAS
- [x] Mobile Android CI green (APK in `android-nightly` release)
