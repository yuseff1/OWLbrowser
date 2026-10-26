# OWL Mobile

The agentic browser in your pocket. A real mobile browser (tabs, bottom address bar, private tabs, profiles,
ad/tracker blocking, reader mode, bookmarks & history) with the same six owl companions as OWL desktop.
A companion can drive the page you're on: it reads it, taps, types, scrolls and searches, and asks you before anything risky.

Built with **Expo SDK 58** (React Native 0.88, TypeScript, expo-router) and **react-native-webview**.

```
mobile/
  app.json                 name "OWL", slug owl-browser, bundle id tech.varsen.owl, scheme owl, icon → ../build/icon.png
  assets/companions/       hoot, nova, pip, echo, atlas, byte (+ -face) art, copied from the desktop renderer
  src/app/                 routes (expo-router)
    index.tsx              the browser: WebViews + OWL Home + glass bottom bar + run sheet + "Controlled by" ring
    tabs.tsx               grid tab switcher (Tabs / Private)
    ask.tsx                ask your companion about the current page, recent runs
    bookmarks.tsx history.tsx memory.tsx companions.tsx profiles.tsx reader.tsx
    settings/index.tsx     settings · settings/models.tsx (presets) · settings/provider.tsx (key, discover, test)
  src/components/          BottomBar, BrowserWebView, Home, Composer, RunSheet, MenuSheet, ControlRing, ui
  src/state/               app (profiles, settings, providers, bookmarks, history, memory), browser (tabs + WebView bridge), agent (tool loop)
  src/lib/                 agent/llm.ts (OpenAI-compatible client), agent/tools.ts, agent/page-scripts.ts, blocklist.ts, providers.ts …
```

## Run it

```bash
cd mobile
npm install
npx expo start          # scan the QR code with Expo Go (Android) or the Camera app (iOS)
```

Everything in the app runs inside **Expo Go** (WebView, blur, secure-store, haptics, SVG icons are all bundled in Expo Go).
Then open the ☰ page menu → **Settings → Models** and either:

- paste an API key for **OpenRouter, OpenAI, Anthropic, Google Gemini, xAI, Groq, Mistral, DeepSeek, NVIDIA** or any OpenAI-compatible endpoint, or
- choose **Local on my network** → Ollama / LM Studio / llama.cpp and enter your computer's LAN address, e.g. `http://192.168.1.20:11434/v1`.
  - Ollama: `OLLAMA_HOST=0.0.0.0 ollama serve`
  - LM Studio: Developer → *Serve on Local Network*
  - Your phone must be on the same Wi-Fi. Release builds allow cleartext HTTP (`usesCleartextTraffic`, iOS ATS exceptions) so LAN servers work.

Tap **Discover** to list the server's models, tap one to make it the default, and **Test** to check it replies.
Keys are stored with `expo-secure-store` (iOS Keychain / Android Keystore), never in AsyncStorage.

Checks:

```bash
npx tsc --noEmit
npx expo export --platform android   # bundles the JS exactly as a release build would
npx expo-doctor
```

(On ARM Linux machines the Hermes compiler that ships with React Native is x86-64 only, so use
`npx expo export --platform android --no-bytecode` there; GitHub's x64 runners compile bytecode normally.)

## Build an installable Android APK

**On GitHub (no Expo account):** push to `main` (changes under `mobile/`) or run the *OWL Mobile · Android APK* workflow
manually (`.github/workflows/mobile-android.yml`). Download the **OWL-android-apk** artifact from the run.
Pushing a tag `v*` also attaches the APK to that GitHub release.

Without signing secrets the release APK is signed with the debug keystore that `expo prebuild` generates: it installs on any
phone (enable "Install unknown apps") but can't go to Google Play. To sign for real, add repo secrets
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

**Locally** (Android SDK + JDK 17):

```bash
cd mobile
npm ci
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

`android/` and `ios/` are generated (Continuous Native Generation) and git-ignored: change native config in `app.json`, never by hand.

## iOS

For now use Expo Go on iPhone. For TestFlight/App Store later, use EAS (needs an Apple Developer account):

```bash
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios
```

The bundle id is already `tech.varsen.owl`. Note: `../build/icon.png` is outside `mobile/`; EAS uploads the whole git repo, so the
path resolves there too.

## How the agent works on mobile

Same loop as desktop `src/main/agents/runner.ts` + `llm.ts`: the companion's instructions + on-device memory go in the system
prompt, and the model calls tools until it calls `finish`.

| Tool | Mobile implementation |
| --- | --- |
| `navigate` | sets the tab's WebView source, waits for `onLoadEnd` |
| `snapshot` | desktop SNAPSHOT script via `injectJavaScript`, result returned through `postMessage` (refs = `data-owl-ref`) |
| `click(ref)` | scroll into view, companion cursor, pointer/touch/mouse events + `el.click()` |
| `type(ref, text, submit)` | native value setter + `input`/`change` events (React-safe), `contenteditable` via `insertText`, Enter + `form.requestSubmit()` |
| `scroll`, `read_page`, `select_option`, `back`, `wait` | injected scripts |
| `web_search` | DuckDuckGo HTML endpoint via `fetch` (no key) |
| `fetch_url` | `fetch` + HTML → text |
| `ask_user`, `request_approval` | question / approval cards in the run sheet |
| `remember`, `recall` | on-device memory (Memory screen to view/delete) |

Risky taps (buy, pay, send, post, delete, submit…) pause for approval unless Settings → Approvals is *autonomous*.
While a companion drives a tab, a glowing "Controlled by Hoot" ring is drawn over it; tap the pill to open the run (Stop, answer, approve).

## Privacy & blocking

- **Private tabs** use WebView `incognito`, never write history and aren't restored.
- **Profiles** keep separate tabs, bookmarks, history, memory and settings (model providers/keys are shared across profiles). Mobile WebViews share one cookie jar per app,
  so profiles marked *Isolated* browse with `incognito` (no persistent cookies) to keep sign-ins separate.
- **Ad & tracker blocking**: a compact domain list (`src/lib/blocklist.ts`) applied in `onShouldStartLoadWithRequest`
  (navigations, popups, iOS iframes), plus an injected script that blocks in-page `fetch`/XHR/beacon/script/iframe/img requests to
  those domains and cosmetic CSS that hides common ad slots. The shield badge in the address bar counts blocks.

## Known limits (v1)

- Clicks/typing are synthetic DOM events, not OS-level touches: a few sites that require trusted events (some captchas, some
  canvas apps) won't respond to the agent; the companion should then `ask_user` to tap.
- WebView sub-resource requests can't be intercepted natively, so blocking is script-level (good, not uBlock-grade).
- No per-tab screenshots in the tab grid yet (favicon cards); no find-in-page; no downloads manager (files open in the OS).
- Android has no native WebView blur, so bars use a translucent fill there; iOS gets real `expo-blur` glass.
