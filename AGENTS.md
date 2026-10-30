# AGENTS.md — OWL

Read this first, then `docs/HANDOFF.md` (full context), `docs/DESIGN.md` (design rules) and `docs/TOOLS.md` (tools and commands).
`CLAUDE.md` points here. The mobile app also has `mobile/AGENTS.md` (Expo rules); follow both when working in `mobile/`.

## What OWL is
An agentic Chromium browser that Youssef uses daily instead of Chrome.
- **Desktop** (repo root): Windows, Electron 45 + Svelte 5 + Vite + Tailwind 4 + bits-ui, main process in TypeScript (`tsc`), sql.js storage, Ghostery adblock, electron-updater.
- **Mobile** (`mobile/`): Android first, Expo SDK 58 + React Native + expo-router + react-native-webview. Shipped as an APK (EAS build) plus OTA updates (EAS Update, channel `preview`).
- AI companions (original owl characters) that chat or drive tabs, parallel agents, routines with triggers, skills, MCP, a memory layer, any OpenAI-compatible model or a local one (Ollama, LM Studio, llama.cpp).

## How to work here
- The owner delegates: "you take the decisions, don't ask me; just build." Make sensible calls, ship, and say what you changed.
- Keep desktop and mobile changes in separate commits. Don't touch desktop code during a mobile task, or mobile code during a desktop task.
- Before calling anything done, run the checks:
  - Desktop: `npm run typecheck`, `npx vite build`, `npm run test:main` (45 tests).
  - Mobile (in `mobile/`): `npx tsc --noEmit`, `npx expo-doctor`, `npx expo export --platform android`.
- Run heavy commands one at a time (vite build, svelte-check and expo export each use a lot of RAM).
- Commit as `Youssef (OWL) <hello@varsen.tech>`, run `git pull --rebase`, then push to `main`. CI builds the Windows installer into the `nightly` release.
- Mobile: if no native module changed, ship as OTA (see `docs/TOOLS.md`); otherwise start an EAS APK build and note that a reinstall is needed.
- Never say a change was tested on a device unless Youssef tested it. Builds and type checks aren't device tests.
- Log user-visible changes in `docs/CHANGELOG.md` and tick or add items in `ROADMAP.md`.

## Hard design rules (details in docs/DESIGN.md)
- Colours: ink `#141317`, amber `#E8A317`. No purple, indigo or violet gradients, no neon, no gloss.
- **No lighting:** no specular rims, sheens, top highlight lines, inner glows, glow rings or radial "light" gradients inside cards. Flat surfaces, a hairline edge, and a soft shadow at most.
- **Still characters:** companion art doesn't bob, wiggle or pulse.
- Icons: Microsoft Fluent UI System Icons only (desktop `src/renderer/lib/ui/Icon.svelte`, mobile `mobile/src/components/Icon.tsx`). **Never Lucide**; it reads as the "AI look".
- Minimal, calm, Apple-like. No generic AI-template styling or emoji UI.

## Map
- `src/main/` — Electron main: `main.ts` (IPC), `window.ts`, `profiles.ts`, `downloads.ts`, `secrets.ts` (safeStorage), `adblock.ts`, `reader.ts`, `site-prefs.ts`, `session-restore.ts`, `updater.ts`, `mcp.ts`, `import/chromium.ts` (Chrome import), `agents/*` (runner, llm, memory, browser-tools, computer use, skills, routines, companions).
- `src/preload/ui.ts` — the `window.owl` API (contract in `docs/ui-contract.md`).
- `src/renderer/` — Svelte UI: `lib/shell/*` (tab strip, omnibox, toolbar, panels, bubbles), `lib/pages/*` (internal pages), `lib/ui/*` (primitives and Icon), `lib/popup/*` (popup layer above web views), `app.css` (tokens).
- `mobile/src/app/*` routes, `mobile/src/components/*` (BottomBar dock, BrowserWebView, FindBar, LinkMenu, MenuSheet…), `mobile/src/lib/*` (keyboard, insets, crashguard, storage, agent), `mobile/src/state/*`.
- `tests/main`, `tests/agents` — Node harnesses for desktop.
- `.github/workflows/desktop-windows.yml`, `mobile-android.yml`.
