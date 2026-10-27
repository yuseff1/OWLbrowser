# Changelog

## 2026-10-28 (night) — tab groups
- Tab groups, Chrome-style: tab menu › *Add tab to new group* / *Add to “…”* / *Remove from group*. The chip before a group collapses / expands it on click; right-click (or Enter / F2) opens the editor: name, nine muted colours (amber `#E8A317` included), new tab in group, collapse, ungroup, close group. A coloured underline runs from the chip under the group's tabs (horizontal strip); vertical tabs show the chip as a header with a colour rail.
- Main keeps groups contiguous: grouping moves tabs next to each other, a tab dropped between two grouped tabs joins the group, one dragged out leaves it, a tab opened from a grouped opener joins it, pinning ungroups, empty groups disappear. Collapsing the active tab's group moves to the nearest tab outside it; activating a hidden tab expands its group.
- Groups (and pinned tabs) are saved with the session and with a closed window, and come back on restore / Ctrl+Shift+T.
- IPC `groupTabs(ids, groupId?, {title,color}) / ungroupTabs(ids) / updateGroup(id, {title,color,collapsed}) / closeGroup(id)`; `WindowState.groups`, `TabState.groupId` (replaces the unused `groupColor`).
- Tests: tab-group test in `test:main`, reopen-window test checks the group comes back.

## 2026-10-27 (night) — bug sweep + daily-browser features
Fixes (from the UI QA and main-process audits):
- Secrets: everything goes through Electron safeStorage (DPAPI / Keychain / libsecret). Values an older build stored as base64 only (`p:`) or as legacy plaintext are re-encrypted at start-up once OS encryption is available; an undecryptable value is kept, never deleted. Linux's `basic_text` backend counts as "not encrypted" and Settings › Privacy says so honestly. `appInfo().secrets = { encrypted, backend }`.
- Settings / pages no longer say "Windows" on macOS and Linux (theme, computer use, MCP, default browser, keychain copy); "this PC" → "this computer".
- Omnibox: rows de-duplicated by normalised URL (scheme, www., trailing slash, #fragment, default port), a typed URL is not repeated by its history row, rows without a favicon borrow the site's favicon, a favicon that fails to load falls back to the row icon instead of a blank slot.
- Omnibox: Escape restores the address; the next Escape (or the first, when nothing was open) gives keyboard focus back to the page (`command('focus-page')`).
- Omnibox: Chrome-style inline autocomplete ("wik" → wiki[pedia.org], selected) from this profile's history; never after a deletion, never in incognito (`suggest(text, { inline: true })`).
- Internal pages share one content column (`--owl-content-w`, Settings included); the new tab fits 1376×880 without a scrollbar (compact rhythm on short panes) and its ideas row never shows a native scrollbar.
- Incognito agent runs: work only in that profile's incognito windows (in-memory session), are shown only there, are never written to runs.json, never distilled into memory, and `remember` is a no-op.
- Removing a profile stops its runs, waits for its windows to close, drops all its `pw:`/`mcp:` secrets and deletes its data folder, extensions folder and Chromium partition (anything still locked is queued and deleted at the next start). Stores of a removed profile can no longer write into the deleted folder.
- Downloads started in a popup opened by an agent-driven page are quarantined like the tab's own; a quarantined / unfinished download can't be opened from the list.
- `history()` IPC validates its arguments (fuzz found a throw on non-string queries).

Features:
- PDFs open in the tab with Chromium's viewer (`plugins: true`) instead of downloading.
- Zoom is remembered per site (Chrome): zoom a page and every tab on that site, now and later, uses it; reset forgets it. Incognito reads but never writes it.
- Site settings (Settings › Privacy): every site with a decided permission or a zoom level; Allow / Block / Ask per permission; Reset forgets permissions, zoom, cookies and site data. IPC `siteSettings / setSitePermission / resetSite`.
- Ctrl+Shift+T reopens a whole closed window when that was the last thing closed (up to 10 per profile, memory only), then tabs as before.
- Video/audio context menu works on any player (blob: sources too): Play/Pause, Mute, Loop, Show controls, Picture in picture.
- Tests: `npm run test:main` grows to cover all of the above.

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
