# OWL

An agentic Chromium browser for Windows. Companions that work in your tabs, parallel bots, routines, a memory layer, and everything you expect from Chrome.

## Download
Latest Windows build: [Releases → nightly](https://github.com/yuseff1/OWLbrowser/releases/tag/nightly) (`OWL-Setup-*.exe`). It is unsigned, so SmartScreen asks once: **More info → Run anyway**.

Android APK: Actions → *Mobile (Android)* → artifact `OWL-android-apk`.

## What's inside
- **Browser:** tabs (classic or vertical), profiles with separate logins, incognito, split view, bookmarks, history, downloads, passwords, find, zoom, devtools, sleeping tabs, Ghostery ad and tracker blocking, Chrome import.
- **Companions:** six owls (Hoot, Pip, Atlas, Nova, Echo, Byte) plus your own. Ask mode chats; Do-it mode drives a tab with "Controlled by …", Take over and Stop, and asks before risky actions.
- **Agents:** spin up 1–5 bots in parallel, routines with triggers, skills, MCP servers.
- **Memory:** hybrid keyword + embedding recall, versioned facts, profile, expiry, secret filtering.
- **Models:** any OpenAI-compatible API, plus local Ollama, LM Studio and llama.cpp.

## Develop
```bash
npm ci
npm run dev        # build + launch Electron
npm run typecheck
npm run dist       # Windows installer into release/
```
Stack: Electron 45, Svelte 5, Vite, Tailwind 4, bits-ui, Fluent UI System Icons, sql.js. Mobile app (Expo) lives in `mobile/`.

Start here: `AGENTS.md`, `docs/HANDOFF.md`, `docs/DESIGN.md`, `docs/TOOLS.md`.

Docs: `docs/ui-contract.md` (the `window.owl` API), `docs/ui-requests.md`, `docs/research.md`, `ROADMAP.md`.
