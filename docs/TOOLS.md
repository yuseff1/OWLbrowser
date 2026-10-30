# Tools and commands

## Stack
| Area | Tools |
|---|---|
| Desktop shell | Electron 45, TypeScript (`tsc -p tsconfig.main.json`) |
| Desktop UI | Svelte 5 (runes), Vite (rolldown), Tailwind 4, bits-ui, `@fluentui/svg-icons` → `npm run icons` generates `src/renderer/lib/ui/icons.generated.ts` |
| Storage | sql.js (history, etc.), JSON stores, Electron `safeStorage` (DPAPI) for secrets |
| Blocking | `@ghostery/adblocker-electron` |
| Updates | electron-updater (GitHub releases) |
| Installer | electron-builder NSIS, built by GitHub Actions (`desktop-windows.yml`) → `nightly` release `OWL-Setup.exe` |
| Mobile | Expo SDK 58, expo-router, react-native-webview, expo-blur, expo-haptics, react-native-svg, AsyncStorage, expo-updates |
| Mobile build | EAS Build (cloud keystore), EAS Update (OTA). Project `@yusef_ef08/owl-browser`, ID `e2a75a9e-8c48-461c-bce8-49fe00aa4006`, channels `preview` and `production`. GitHub APK workflow kept as a fallback. |
| AI | Any OpenAI-compatible API, plus Ollama, LM Studio and llama.cpp; MCP servers (`src/main/mcp.ts`) |

## Desktop
```bash
npm ci
npm run dev            # build + launch
npm run typecheck      # tsc main + svelte-check
npx vite build
npm run test:main      # 45 tests; on Linux without a display it may need extra libs on LD_LIBRARY_PATH
npm run test:agents
npm run dist           # Windows installer (normally done by CI)
```
Push to `main`, and CI builds the installer and runs a Windows install smoke test.

## Mobile (`cd mobile`)
```bash
npm ci
npx tsc --noEmit
npx expo-doctor        # one known mismatch: Expo patch versions left behind on purpose for OTA runtime 0.1.0
npx expo export --platform android
# OTA (JS-only changes):
npx -y eas-cli@latest update --channel preview --environment preview --platform android \
  --skip-bundler --input-dir dist --message "…" --non-interactive
# New APK (native module changed):
npx -y eas-cli@latest build -p android --profile preview --non-interactive --no-wait
```
- Needs an `EXPO_TOKEN`. In some proxied sandboxes, `export NODE_USE_ENV_PROXY=1` is required or EAS auth fails.
- Always add packages with `npx expo install`. A new native module breaks OTA compatibility and means a new APK and a reinstall.

## Agent skills used for development
Clone locations are from the original build machine (`/workspace/skills-lib`, catalog in `INDEX.md`). Re-clone them if you want the same guidance:
- Design: `Leonxlnx/taste-skill` (taste-skill), `anthropics/skills` (frontend-design), `nextlevelbuilder/ui-ux-pro-max-skill`, `wshobson/agents` (design-system-patterns, responsive-design).
- Code: `vercel-labs/agent-skills` (react-best-practices), wshobson TypeScript/JS skills, `Jeffallan/claude-skills` (typescript-pro, react-expert, code-reviewer, security-reviewer, debugging-wizard, test-master).
- Quality: `addyosmani/web-quality-skills`.
- Reverse engineering: `morluto/rea` (reverse-engineer-anything; `rea` CLI).
- Browser automation and QA: `vercel-labs/agent-browser` (dogfood), `SawyerHood/dev-browser`.
- Research: Agent-Reach (`Panniantong/Agent-Reach`) for web, YouTube, GitHub and Reddit reading.

## Repo
- GitHub `yuseff1/OWLbrowser`, branch `main`.
- Commit identity: `Youssef (OWL) <hello@varsen.tech>`.
