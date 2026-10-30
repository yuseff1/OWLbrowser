# OWL handoff (state as of 2026-10-30)

Everything a new session needs to continue building. See also `AGENTS.md`, `docs/DESIGN.md`, `docs/TOOLS.md`, `ROADMAP.md`, `docs/CHANGELOG.md`.

## Goal
A browser Youssef uses every day instead of Chrome, on Windows and Android, with AI built in:
- Chrome parity: tabs, profiles with separate logins, bookmarks, history, downloads, passwords, extensions, incognito, find, zoom, devtools, default browser, full Chrome import.
- AI companions (original owls) in Ask mode (chat) and Do-it mode (drives a tab, showing "Controlled by X" with Take over and Stop, and asks before risky actions); parallel bots; routines and triggers; skills; MCP; memory layer; visual artifacts; computer use (Windows desktop control).
- Low RAM: sleeping tabs, memory saver, adblock, throttling, agent tabs disposed when done.
- Inspired lightly by strawberrybrowser.com; motion and mobile chrome inspired by Safari.

## Desktop — done
- Shell: tab strip (classic or vertical), tab groups (coloured chips, collapse, rename, persistence), omnibox with inline autocomplete and URL dedupe, bookmarks bar, command palette, split view, find bar, profile switcher (`Ctrl+Shift+M`), task manager (`Shift+Esc`), reader mode (`F9`), PDF viewer, per-site zoom, site settings, non-modal permission bubble, download bubble (pause, resume, retry, remove), reopen closed tab or window, media context menu with PiP.
- Data: profiles (with deletion), incognito (agents isolated), history, bookmarks, passwords, secrets in `safeStorage`, Chrome import (`src/main/import/chromium.ts`), session restore, crash handling, auto-update.
- Agents: runner, LLM providers, memory, browser tools, computer use, skills, routines, companions, MCP.
- Startup recovery for a hung single-instance lock (heartbeat in `userData/instance.json`; logs in `%APPDATA%\OWL\logs\main.log`).
- Icons: Lucide fully replaced by Fluent UI System Icons.
- 2026-10-30 (`8f5a3ef`): all lighting removed (rims, sheens, glows, inner highlights); companions no longer bob; flat companion cards.
- Checks: test:main 45/45, svelte-check 0 errors, Windows CI green.

## Desktop — open
- **Not yet tested by hand on real Windows.** If the app won't open, read `main.log` first.
- Drag finished downloads out of the download bubble.
- Persist reader-mode preferences across restarts.
- The camera/mic permission pre-check reports "granted" before the real prompt.
- The reader icon shows on every page; it should only show on detected articles.
- Code signing; extension store install; computer-use polish.
- Security items in `docs/security-audit.md` (autonomous approval bypass, page-world scripts, agent downloads without a prompt).

## Mobile — done (OTA on channel `preview`, runtime 0.1.0)
- Floating capsule dock, top or bottom, with live blur on Android 12+, a squeeze interaction, and a solid capsule while typing. Keyboard lift is confirmed working on Youssef's phone.
- Crash guard, instant tab save, search-reset and external-app link guards.
- Fluent icons (Lucide removed).
- Long-press link and image menu, find in page (amber highlights), per-site text size 50–200%, swipe the bar to switch tabs, tab cards with swipe-to-close and close-all, private tabs, download handoff, history and bookmark actions.
- `e0996b8` (OTA `81a565d2`): the typing sheet covers the whole screen down to the keyboard, and the bright top line on bars is gone.
- `da014ea` (OTA `5cacfcdd`): Safari-style motion. The bar shrinks to a domain pill on scroll (with Live blur on), swiping the bar moves the page with a live peek at the neighbouring tab (swipe past the last tab for a new one, swipe up for the overview), the tab overview zooms the page into its card, Apple spring maths. Research: `docs/research-safari.md`.

## Mobile — open
- Most mobile features haven't been tested on a phone; only the keyboard lift was confirmed.
- Watch: the frame when a swipe commits a tab switch, and the end of the overview zoom (the page briefly overlaps the row below).
- Edge-swipe back/forward with page peek is skipped on Android (the system Back gesture owns both edges; page snapshots would need a native module).
- Ideas: link previews on long-press, a reader icon in the bar, pinch to open the overview, signed release APK, iOS through EAS.
- Lighting cleanup like the desktop one: check mobile cards and sheets for highlights or glows and remove them.

## Owner preferences
- Delegates decisions: "you take the decisions, don't ask me; just build." Ship, then report plainly.
- Very sensitive to "AI slop" visuals. See `docs/DESIGN.md`.
- Reports bugs with phone screenshots; fix exactly what's shown and anything of the same kind nearby.

## Key docs
- `docs/ui-contract.md` — the `window.owl` preload API. `docs/ui-requests.md` — UI→main requests.
- `docs/mobile-design.md` — mobile spec. `docs/research.md` — memory, skills and icons study. `docs/research-safari.md` — Safari teardown.
- `docs/security-audit.md`, `docs/auto-update.md`, `docs/CHANGELOG.md`, `ROADMAP.md`.
