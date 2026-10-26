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
- [ ] CI: Windows NSIS + ZIP build green, nightly release published
- [ ] Main ← UI requests (docs/ui-requests.md): overlay layer for popups over native views
- [ ] Hide background agent views when an internal page is active (window.ts layout)
- [ ] Ctrl+Shift+J → downloads (shortcut order)
- [ ] Settings deep link hash (`owl://settings#models`)
- [ ] Chats API in main (replace localStorage)
- [ ] `renameBookmark` IPC
- [ ] Memory profile API for the Memory page
- [ ] Artifact sandbox frame with its own CSP so scripted artifacts run
- [ ] Hide native views when page rect is zero
- [ ] `completeOnboarding` accepts defaultModel
- [ ] Windows runtime smoke test (launch, browse, import Chrome, run Hoot)

## v0.2
- [ ] Code signing, auto-update
- [ ] Computer-use polish, extension store install
- [ ] Mobile: device test, signed APK, iOS via EAS
