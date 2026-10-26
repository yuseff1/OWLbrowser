# OWL security audit — 2026-10-26

Scope: Electron 45 main process (`src/main/**`), preloads (`src/preload/ui.ts`, `web.ts`), Svelte renderer (`{@html}` sinks, `markdown.ts`, `kit/md.ts`, `Artifact.svelte`, `index.html` CSP), agent runtime (runner, llm, browser tools, computer use, memory, skills, routines, companions), MCP client, Chromium import, packaging (`package.json` / electron-builder 26) and GitHub workflows.

Method: manual review against the official Electron security checklist (electronjs.org/docs/latest/tutorial/security, items 1–20), OWASP-style input/IPC review, an agent prompt-injection threat model (a hostile web page or MCP result steering the agent), `npm audit`, then a headless Electron smoke run of the patched build.

## Summary

| Severity | Found | Fixed | Open |
|---|---|---|---|
| Critical | 1 | 1 | 0 |
| High | 6 | 6 | 0 |
| Medium | 9 | 7 | 2 |
| Low | 11 | 6 | 5 |
| Info | 6 | – | 6 (notes) |

All Critical and High findings are fixed. The worst problem was the privileged UI window. It had no navigation or new-window guard and no IPC sender check, so any link in a companion reply or an artifact popup could open an attacker's page with the full `window.owl` bridge. With that bridge, `saveApp` and `connectApp` configure and spawn an MCP command, which means code execution on the user's machine. Fixing this took three changes:

- The UI is now served from a private `owl-ui://app` origin instead of `file://`.
- Every `owl:*` IPC call is checked against that origin.
- The UI can no longer navigate away or open windows. Links open as normal tabs.

Agents are now confined:

- They can only load or fetch http(s) pages. `file://`, `chrome://`, `owl://`, `data:` and `javascript:` are refused.
- Addresses on the local network need the user's approval.
- Password and card values never reach the model.
- Desktop control, password and payment fields, and app (MCP) tools that change things all go through the approval flow.
- `ask-always` mode is now actually enforced.

API keys are only sent over https, or over http to this machine. Electron fuses are configured, the UI renderer is sandboxed, and CI tokens are least-privilege.

`npm audit` (production and all dependencies): **0 vulnerabilities**.

Verification after the fixes:

- `npx tsc -p tsconfig.main.json --noEmit`: OK.
- `svelte-check --threshold error`: 0 errors, 0 warnings.
- `vite build`: OK.

**Headless Electron 45 smoke test** (arm64 Linux, ozone headless) of the patched build:

- The UI loads from `owl-ui://app/index.html`.
- `window.owl` works and IPC `getState` succeeds.
- `window.open` from the UI creates a tab, not a window.
- `location.href = https://…` in the UI is blocked: the UI keeps its URL and the link opens as a tab.
- A web tab has `typeof window.owl === 'undefined'`.

## Findings

| ID | Severity | Area | File:line (after fix) | Description | Status | Remediation |
|---|---|---|---|---|---|---|
| SEC-01 | Critical | Navigation / windows (UI) | `src/main/window.ts:197` (`lockDownUi`) | The UI `BrowserWindow` (which carries the `ui.js` preload) had no `setWindowOpenHandler`, `will-navigate` or `will-redirect` guard. Some links in companion or LLM markdown use `target=_blank`, the artifact iframe has `allow-popups`, and `kit/md.ts` links are plain `<a>`. Any of these could open or navigate to an attacker page that inherits the preload, getting full `window.owl` access: MCP `saveApp`/`connectApp` command spawn (RCE), provider keys, agent control and the `revealPassword` flow. | Fixed | The UI now denies every window and navigation that is not `owl-ui://app/`. http(s), mailto and owl:// targets open as normal browser tabs. `will-attach-webview` is blocked everywhere (`main.ts` `web-contents-created`). |
| SEC-02 | High | IPC | `src/main/main.ts:67` (`windowFor`), `:585` | `windowFor()` fell back to the focused window for **any** sender and there was no `senderFrame` check. Any frame able to send `owl:*` would act on the user's window. | Fixed | Every `owl:*` handler requires `isTrustedUiFrame(e.senderFrame)`: top frame, scheme `owl-ui:`, host `app`, sender is a known OWL UI `webContents`. Anything else is logged and rejected with `Forbidden`. The renderer's real origin is allowed; the dev mock is unaffected. |
| SEC-03 | High | Protocols / file:// | `src/main/ui-protocol.ts` (new), `window.ts:173`, `package.json:54` | The UI was loaded with `loadFile` (file://). Every local `.html` opened in a tab (OWL is registered as the HTML viewer) shared the `file://` origin. Electron's `grantFileProtocolExtraPrivileges` also lets file pages fetch other local files, so a malicious downloaded .html could read local files. | Fixed | The UI is served by `protocol.handle('owl-ui')` (standard, secure scheme) on the default session only, with a path-traversal guard rooted at `dist/renderer`. The `grantFileProtocolExtraPrivileges` fuse is now off. |
| SEC-04 | High | Agent safety / SSRF | `src/main/agents/browser-tools.ts:68` (`gateUrl`), `main.ts:231` (`fetchText`) | Agent `open_tab`/`navigate`/`fetch_url` accepted `file:`, `chrome:` and `owl:` URLs. `fetch_url` used `session.fetch`, which reads `file://`. A prompt-injected page could make the agent read `C:\Users\…` and exfiltrate it, or reach router, metadata or LAN services. Routine page-change triggers used the same fetcher. | Fixed | Only http(s) and `about:blank` are allowed. Hosts that resolve to loopback, RFC1918, link-local, CGNAT, ULA or `.local` need user approval. `fetchText` refuses non-http(s) URLs and follows redirects manually, blocking redirects from public URLs into the LAN or to non-web schemes. |
| SEC-05 | High | Secrets → LLM | `src/main/agents/page-scripts.ts:40` | `SNAPSHOT_SCRIPT` put `value="…"` for every input, including autofilled **password** fields, into the model prompt sent to cloud providers. Element labels also fell back to `el.value`. | Fixed | Password, `cc-*`, one-time-code and new/current-password fields are reported as `[filled]`, never their value. Labels never use a password value (snapshot and `LOCATE_SCRIPT`). |
| SEC-06 | High | Network / keys | `src/main/agents/llm.ts:34,53`, `settings.ts:71,104`, `agents/memory.ts:393`, `net-guard.ts` | Provider `baseUrl` was unvalidated, and `Authorization` / `x-api-key` was sent to any URL, including plain-http remote hosts. | Fixed | `checkProviderUrl`: https anywhere, http only for loopback or private-network model servers, no credentials in the URL. It is enforced on upsert and on every call. `maySendKey`: keys are only sent over https or http to loopback (also for embeddings and model discovery). |
| SEC-07 | High | Computer use | `src/main/agents/runner.ts:352` | Only `computer_open_app` asked for approval. Mouse and keyboard tools could drive the whole desktop (for example Win+R → command) with no approval, from a prompt-injected run. | Fixed | The first desktop-control action of every run needs user approval (every action in `ask-always` mode). Screenshots and window lists are read-only. `open_app` still always asks. The approval is cleared when the run ends. |
| SEC-08 | Medium | Agent approvals | `runner.ts:366,373`, `browser-tools.ts:183,194` | `approvalMode: 'ask-always'` was never enforced. MCP tool calls were never gated. Typing into password or card fields was ungated. Risky-click detection depended only on page-controlled labels. | Fixed | `ask-always` gates click, type, select and press-key actions plus all MCP calls. MCP tools whose names look like they change something (send, create, delete, pay, deploy…) need approval in `ask-risky` mode. Typing into password, `cc-*` or OTP fields needs approval. Submit buttons inside forms that hold password or card fields need approval. |
| SEC-09 | Medium | Password autofill | `src/preload/web.ts:33`, `main.ts:594` | Autofill filled the first `input[type=password]` even if invisible (a honeypot field could harvest the password), and filled over plain http on the network. | Fixed | Fills only visible, enabled, empty fields in the top frame. Main serves credentials only to the top frame of an https origin (or http on localhost), matched exactly against the sending frame's origin, never a page-supplied value. One credential per origin, never in incognito. |
| SEC-10 | Low | Password capture IPC | `window.ts:441` | `owl-web:password` trusted the origin and payload sent by the renderer. | Fixed | Origin comes from `e.senderFrame` (top frame, http/https only), the payload is type- and length-checked. |
| SEC-11 | Medium | Permissions | `main.ts:111–135` | There was no permission-check handler, device handler, or `select-hid-device` / `select-serial-port` / `select-usb-device` handler, and `window-management` was auto-granted. When `select-hid-device` is unhandled, Electron auto-selects the first device. | Fixed | Device APIs are denied by default (check, device and select handlers). The check handler honours the user's stored per-site choices. `window-management` now prompts. The per-site prompt for camera, mic, geolocation, notifications, clipboard-read and so on is kept. |
| SEC-12 | Medium | IPC input validation / path traversal | `main.ts:381` and around `renameProfile`/`removeProfile`/`openProfile`, `:460` | Profile ids from the renderer flowed into `profiles.dataDir()` (`path.join(userData, 'profiles', id)`), so a crafted id could traverse paths. `importFrom` accepted any source path. | Fixed | `knownProfile()` requires an existing profile id. Names and colours are typed and capped. `importFrom` only accepts a source returned by `detectSources()`. |
| SEC-13 | Medium | Packaging / fuses | `package.json:54` (`build.electronFuses`) | No Electron fuses were set: `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect` could turn OWL.exe into a generic Node runner, and there was no asar integrity check and no cookie encryption. | Fixed | `runAsNode:false`, `enableNodeOptionsEnvironmentVariable:false`, `enableNodeCliInspectArguments:false`, `enableEmbeddedAsarIntegrityValidation:true` (electron-builder 26 writes the Windows integrity resource), `onlyLoadAppFromAsar:true`, `enableCookieEncryption:true`, `grantFileProtocolExtraPrivileges:false`. **Verify on the first packaged CI build.** Cookie encryption is one-way (existing cookies get encrypted on write). |
| SEC-14 | Medium | webPreferences (UI) | `window.ts:164`, `ui-protocol.ts` | The UI renderer ran with `sandbox:false`. | Fixed | The UI is `sandbox:true` (its preload only uses `contextBridge`/`ipcRenderer`) and `app.enableSandbox()` is on for every renderer. `webSecurity`, `allowRunningInsecureContent:false`, `webviewTag:false` and `nodeIntegrationInSubFrames:false` are now explicit on the UI and tabs. contextIsolation was already on and nodeIntegration already off. No `enableBlinkFeatures` or `experimentalFeatures`. |
| SEC-15 | Medium | CI | `.github/workflows/desktop-windows.yml:13` | `permissions: contents: write` for every job, including PR checks. | Fixed | Workflow default is `contents: read`. Only the `windows` release job gets `contents: write`. The check job uses `persist-credentials: false` and runs `npm audit --omit=dev --audit-level=high`. No secrets are echoed. (The mobile workflow's single job needs write to publish the APK and writes signing secrets to `gradle.properties` without printing them. It was left as is.) |
| SEC-16 | Low | CSP | `src/renderer/index.html:5` | The CSP lacked `object-src` and `base-uri`, and `frame-src` allowed `data:` and `blob:`. | Fixed | Added `object-src 'none'; base-uri 'none'`. `frame-src 'self'` (srcdoc frames are unaffected). `script-src 'self'` with no inline code was already strict. |
| SEC-17 | Low | Downloads | `main.ts:147` | The save path used the server-supplied filename unsanitised (Chromium sanitises it, but this adds defence in depth). | Fixed | `basename`, reserved and control characters stripped, leading dots replaced. Files are always saved inside Downloads with a unique name. |
| SEC-18 | Low | Extensions | `main.ts:483`, `import/chromium.ts:712` | Manually loaded and imported extensions got `allowFileAccess: true` (Chrome defaults to off). | Fixed | `allowFileAccess: false`. |
| SEC-19 | Low | MCP env | `src/main/mcp.ts:190` | stdio MCP servers inherited `ELECTRON_*`, `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS` from OWL's environment. | Fixed | These are stripped from the inherited env; the server's configured env still applies. Already good before this audit: user-configured commands only, spawned without a shell, `.cmd` arguments escaped (cross-spawn style), env names validated, https-only remote URLs, tokens kept in safeStorage. |
| SEC-20 | Low | Page script injection | `page-scripts.ts:110` | `OVERLAY_SCRIPT` interpolated the companion colour raw into a script run in web pages. | Fixed | Colour must match `#hex`, otherwise a default is used (the name was already JSON-encoded). |
| SEC-21 | Low | Secrets at rest | `src/main/secrets.ts:11` | When `safeStorage` is unavailable, secrets are stored base64 (`p:`). This never happens on Windows, where DPAPI is always available. | Open (warning added) | A one-time warning is logged (never the value). If Linux or macOS ship, refuse to store secrets or ask the user instead. |
| SEC-R1 | Medium | Agent approvals (residual) | `browser-tools.ts:28,183` | Risky-action detection is heuristic (label regex plus form contents) and page-controlled. `approvalMode: 'autonomous'` turns off every approval, including password typing and LAN access (file:// and similar stay blocked). | Open | Consider always asking for password and payment fields and purchases even in autonomous mode. Detect checkout pages, for example by payment-request or `cc-*` fields on the page. Show the real target URL in the approval card. |
| SEC-R2 | Medium | Agent page scripts | `browser-tools.ts:175` and others | Snapshot, read, locate and click scripts run in the page's **main world** (`executeJavaScript`). A hostile page can monkey-patch DOM APIs to feed the agent false content or refs. | Open | Move to `executeJavaScriptInIsolatedWorld(worldId, …)` (the same DOM, but pristine JS builtins). |
| SEC-R3 | Low | Secrets in logs/memory | `runner.ts` `describe()` | Text the agent types (including a password the user gave it) appears in run steps, `runs.json` and the memory-distill transcript. Memory items themselves are filtered by `SECRET_RE` and `redact()`. | Open | Mask `type` step text when the target field is a password or `cc-*` field (needs the locate result in `describe`). |
| SEC-R4 | Low | Downloads by agents | `main.ts:143` | Downloads triggered by an agent click are saved automatically, like a normal browser. Nothing is executed. | Open | Optionally pause agent-tab downloads until the user confirms. |
| SEC-R11 | Low | Permission checks | `main.ts:111` | For non-device permissions without a stored choice, the check handler returns `true` (Electron's default) so sites keep working. Actual grants still prompt. | Open | Return per-site "ask" semantics once the UI has a site-permissions page. |
| SEC-R12 | Low | IPC argument typing | `main.ts` `api` | Argument validation now covers profiles, providers, import and password IPC. Other handlers rely on lookups by id within the sender's own profile. Only the trusted UI can call them now. | Open | Add a small schema (zod or hand-rolled) per handler. |
| SEC-I1 | Info | Artifacts | `src/renderer/lib/pages/Artifact.svelte:62` | The artifact `iframe srcdoc` is sandboxed **without** `allow-same-origin` (opaque origin, no `window.owl`, no parent access). This is correct. Its popups now open as tabs (SEC-01). Functional note: srcdoc inherits the UI CSP, so inline `<script>` in artifacts does not run (see `docs/ui-requests.md` #7). | Note | Serve artifacts from an `owl-artifact://` origin with its own CSP. |
| SEC-I2 | Info | Markdown / `{@html}` | `markdown.ts`, `kit/md.ts`, CompanionPanel, RunView, Chats, Skills, RunRow | Both renderers HTML-escape all input before adding a fixed tag set. Link schemes are limited to http(s), mailto and owl (`markdown.ts`) or http(s) (`md.ts`). The fence language is `[\w+-]` only. No XSS found. | Note | — |
| SEC-I3 | Info | Popups | `window.ts:430` | Real popups (OAuth or payment sign-in with size features) are allowed as `BrowserWindow`s. They inherit the opener tab's sandboxed web preferences, preload and session (no privileged bridge). | Note | — |
| SEC-I4 | Info | Prompt injection in chat | `main.ts:510` | "Chat with page" adds page text to the prompt, wrapped as data. Chat has no tools, so the impact is limited to misleading answers. | Note | — |
| SEC-I5 | Info | Updates / signing | CI | There is no auto-updater, so no update-channel attack surface. Builds are unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`), so users see SmartScreen warnings and authenticity depends on GitHub Releases. | Note | Add Authenticode signing before public distribution; add a signed update feed if an updater is added. |
| SEC-I6 | Info | Dependencies | — | `npm audit --omit=dev` and `npm audit`: 0 vulnerabilities (Electron 45.0.0, electron-builder 26.18.0, sql.js, ghostery adblocker). Adblock engine cache path is a fixed file in `userData`. | Note | Keep Electron on the latest 45.x patch. |

## Electron checklist status

1. Secure content: https enforced for remote providers and MCP. 2–4. No nodeIntegration, contextIsolation on everywhere, sandbox on everywhere. 5. Permission request, check and device handlers in place. 6, 8–10. webSecurity on, no insecure content, no experimental or Blink features. 11–12. No `<webview>` (attach blocked). 13–14. UI navigation and new windows locked down; tabs open new windows as tabs. 15. `shell.openExternal` is only called with a constant `ms-settings:` URL. 16. Electron 45. 17. IPC senders validated. 18. Custom `owl-ui://` protocol instead of `file://`. 19. Fuses configured. 20. Preloads expose only wrapped calls: `web.ts` exposes nothing to the page; `ui.ts` exposes named invokes and an event callback without the IPC event object.

## Notes for maintainers

- The UI origin is now `owl-ui://app`. Renderer `localStorage` (layout and selected companion) starts empty once after this change.
- `src/main/ui-protocol.ts` must stay imported before app `ready`. It is imported by `window.ts`.
- New shared helpers live in `src/main/net-guard.ts` (`isPrivateHost`, `resolvesToPrivate`, `checkProviderUrl`, `maySendKey`, `isWebUrl`).
- Run a packaged Windows build once to confirm the fuses (asar integrity) and the UI loading over `owl-ui://` on Windows.
