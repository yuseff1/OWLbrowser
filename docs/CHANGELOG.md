# Changelog

## 2026-10-26 (night)
- Security hardening pass (see docs/security-audit.md): UI served from `owl-ui://app`, every `owl:*` IPC checked against it, agent navigation/fetch limited to http(s) with LAN approval, fuses, sandboxed UI renderer, least-privilege CI tokens.
- Main fixes from docs/ui-requests.md: settings hash deep links, `renameBookmark`, agent views parked off-window, Ctrl+Shift+J / Ctrl+Shift+S, zero-rect hides views, `completeOnboarding({ defaultModel })`.
- Chats persisted in main per profile (`chats/saveChat/removeChat`); the panel migrates its localStorage threads once.
- Memory page shows "About you" from the memory profile (`memoryProfile`).
- Artifacts are served from `owl-artifact://a/<id>` with their own CSP, so scripted artifacts (charts, small apps) run inside a sandboxed frame.
