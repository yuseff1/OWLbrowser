# Auto-update

OWL updates itself from GitHub releases with `electron-updater` (github provider). Code: `src/main/updater.ts`. CI: `.github/workflows/desktop-windows.yml`.

## Versions
Every Windows CI build gets a unique version that only goes up:
- push to `main` (also PRs and manual runs): `<major>.<minor>` from package.json plus `.<run_number>`, e.g. `0.1.42`
- tag `vX.Y.Z`: `X.Y.Z`

The version is injected at packaging time (`electron-builder -c.extraMetadata.version=…`), so package.json is never rewritten. To start a new line, bump major/minor in package.json (`0.2.0` → builds `0.2.<run_number>`). A hand-made tag must be higher than the current auto versions, or installed copies won't move to it.

## Releases
- **`vX.Y.Z`**: a real release (not a prerelease), marked *latest*, with `OWL-Setup-X.Y.Z.exe`, `OWL-Setup-X.Y.Z.exe.blockmap` (differential downloads), `latest.yml` and the ZIP. It is created as a draft and published only after every file is uploaded. CI keeps the newest 15 automatic ones (marked `<!-- owl-auto-release -->` in the notes); hand-made releases are never pruned.
- **`nightly`**: a prerelease with stable file names for links: `releases/download/nightly/OWL-Setup.exe` and `OWL-x64.zip`. The updater ignores it (`allowPrerelease = false`).
- The updater resolves `github.com/yuseff1/OWLbrowser/releases/latest` → tag → `latest.yml` → installer. **Never publish a non-prerelease release without `latest.yml`** (for example a mobile-only release): it would become "latest" and every desktop update check would fail until the next desktop build.

## Client behaviour
- Off in dev/unpackaged runs (`reason: 'dev'`) and on platforms other than Windows (and Linux AppImage).
- NSIS install (an `Uninstall OWL.exe` sits next to `OWL.exe`): it checks 20 s after start and then every 4 h, downloads in the background, then shows a toast plus a system notification. **Restart to update** (`installUpdate()`) installs silently and relaunches. Otherwise the update installs on the next quit.
- Portable ZIP: check only; the UI offers the download page.
- Unsigned app: `app-update.yml` has no `publisherName`, so Authenticode verification is skipped, and `verifyUpdateCodeSignature` is also replaced with a no-op. `build.win.verifyUpdateCodeSignature` is `false`.
- Logs go to the OWL crash/log file with the `[updater]` prefix.

UI API: see docs/ui-requests.md → "Main replies (auto-update + memory)".
