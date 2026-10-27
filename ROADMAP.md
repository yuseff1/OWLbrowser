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

## v0.2
- [ ] Code signing, auto-update
- [ ] Computer-use polish, extension store install
- [ ] Mobile: device test, signed APK, iOS via EAS
- [x] Mobile Android CI green (APK in `android-nightly` release)
