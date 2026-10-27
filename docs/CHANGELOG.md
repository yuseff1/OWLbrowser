# Changelog

## 2026-10-27
- Auto-update from GitHub releases (electron-updater). Each CI build is versioned `0.1.<run_number>` and published as release `v0.1.N` with `latest.yml`. The `nightly` prerelease now has the stable names `OWL-Setup.exe` / `OWL-x64.zip`. See docs/auto-update.md. New UI API: `getUpdateStatus/checkForUpdates/installUpdate` and the `update` event.
- Lazy session restore (only the active tab gets a renderer). Sleeping tabs restore their scroll position. The memory saver spares split and audible tabs.
- Agent tabs capped (5 per run, 12 per profile). The permission prompt can no longer crash when its window is gone. Incognito downloads stay out of the profile's download history.

## 2026-10-26 (night)
- Security hardening pass (see docs/security-audit.md): UI served from `owl-ui://app`, every `owl:*` IPC checked against it, agent navigation/fetch limited to http(s) with LAN approval, fuses, sandboxed UI renderer, least-privilege CI tokens.
- Main fixes from docs/ui-requests.md: settings hash deep links, `renameBookmark`, agent views parked off-window, Ctrl+Shift+J / Ctrl+Shift+S, zero-rect hides views, `completeOnboarding({ defaultModel })`.
- Chats persisted in main per profile (`chats/saveChat/removeChat`); the panel migrates its localStorage threads once.
- Memory page shows "About you" from the memory profile (`memoryProfile`).
- Artifacts are served from `owl-artifact://a/<id>` with their own CSP, so scripted artifacts (charts, small apps) run inside a sandboxed frame.
