# Safari teardown → OWL mobile

Study of Safari's browsing chrome (iOS 15 → iOS 18 → iOS 26 "Liquid Glass", plus iPadOS/macOS where it informs
gestures) and what OWL's Android app (Expo / RN Animated, OTA-safe) takes from it. Written 2026-10-29.

## Method and evidence levels

Safari's UI layer (MobileSafari / SafariShared) is closed source and ships only inside iOS; there is no IPA or binary
we can legally pull onto a Linux sandbox, so REA (shipped-artifact reverse engineering) has no target here and was not
run. What *is* open is WebKit, which owns the page-level gestures (back/forward swipe with snapshots, magnification,
snapshot lifetime). So the study combines:

| Level | Source | Used for |
| --- | --- | --- |
| **Source** (exact) | WebKit `Source/WebKit/UIProcess/ios/ViewGestureControllerIOS.mm`, `mac/ViewGestureControllerMac.mm` (github.com/WebKit/WebKit, main) | back/forward swipe structure, snapshot rules, dimming/shadow constants, swipe-cancel hysteresis |
| **Apple docs** (exact) | SwiftUI `Spring` / `Animation.spring` docs, WWDC23 *Animate with springs* (10158), WWDC25 *Meet Liquid Glass* (219), *Build a UIKit/SwiftUI app with the new design* (284/323), HIG *Tab bars* / *Materials*, Apple newsroom 2025-06-09 | spring maths and presets, glass behaviour, minimize-on-scroll semantics |
| **Behaviour reports** (qualitative) | 9to5Mac, MacRumors, Ars Technica iOS 26 review, iOS Hacker, TapSmart, How-To Geek, Mozilla Connect thread, Threads post by W. Bremer | which gestures exist and what they do |
| **Estimate** (marked ≈) | frame-by-frame reasoning from those videos/descriptions and UIKit defaults | thresholds and distances Apple does not publish |

Anything marked ≈ is our calibrated estimate, not a published Apple number.

## Key findings

### 1. Address bar states (iOS 26 Compact, the default)
- One floating Liquid Glass row at the bottom, detached from the edges: back · address field · `•••` (9to5Mac,
  iOS Hacker). Bottom and Top layouts remain as options.
- **Scroll to minimize:** scrolling *down* the page shrinks the bar into a small translucent pill that shows only the
  site's domain; scrolling *up* (or tapping the pill, or reaching the top) springs it back to full size (MacRumors,
  Neowin, Apple newsroom: "when users scroll, tab bars shrink … the moment users scroll back up, tab bars fluidly
  expand"). HIG: exit the minimized state by tapping or scrolling to the top.
- What collapses: the buttons and the field chrome; what survives: domain text (smaller), the glass pill.
- Thresholds ≈: collapse after ~20–30 pt of continuous downward travel once the page is past its top ~50 pt; expand
  after ~20 pt of upward travel, at the top, or at the very bottom of the page. Collapse is a morph on a
  no-overshoot spring (≈ duration 0.35–0.4 s, bounce 0); expand has a small bounce (≈ 0.1).

### 2. Swipe on the bar
- Left/right on the address bar moves to the neighbouring tab; the page itself slides with the finger and the
  neighbour's page slides in beside it (iPhoneLife: "your current tab moves to one side … the tab you're swiping to
  begins to appear"). Bar labels of the neighbours peek at the bar's edges (iOS 15+).
- Swiping left past the **last** tab opens a new blank tab (only when the last tab is not already blank).
- Swiping **up** on the bar opens the tab overview (like the Home gesture); up-and-left opens the overview with a new tab.
- Commit ≈: past ~1/3 of the width or a flick (> ~0.3 pt/ms); otherwise spring back. At the ends with no neighbour,
  rubber-band (UIKit-style `x / (1 + |x|/k)`). Selection haptic on commit ≈.

### 3. Tab overview
- Opens by zooming the **live page** down into its card in the grid; the other cards fade/scale in around it; tapping
  a card zooms it back up to full screen. Pinch-out on the page also opens it.
- Grid: two columns on iPhone portrait, portrait cards with the title under/over them, close (×) on each card;
  swipe a card left to close (Apple Support: "swipe left on the tab").
- Tab groups and Private live in the bottom pill of the overview (iOS 26 moved New tab / groups to the top-left).

### 4. Back/forward edge swipe (WebKit, exact)
- iOS: WebKit borrows UIKit's `_UINavigationParallaxTransition` driven by a `_UIParallaxTransitionPanGestureRecognizer`
  (screen-edge pan on the leading edge for back, trailing for forward). The target history item's **snapshot** is laid
  under the live view; the live view slides off; the underlying view moves with UIKit's parallax (≈ 30 % of the
  width behind, i.e. starts at −w/3, per common re-creations of the UIKit transition).
- The snapshot is only used if size, scale and scroll position still match and obscured insets changed by < 100 pt;
  otherwise a flat background colour is shown. It is removed once the new page reaches **50 %** of the snapshot's
  render-tree size, repaints, loads and restores scroll (`swipeSnapshotRemovalRenderTreeSizeTargetFraction = 0.5`).
- macOS constants: dimming over the uncovered page **0.12** black, edge shadow **81 pt** wide at **0.06** opacity,
  a swipe needs **50 pt** horizontal travel, vertical hysteresis 10–25 pt cancels it.
- On iOS OWL already gets this natively (`allowsBackForwardNavigationGestures`). Android has no equivalent API, and
  with gesture navigation both screen edges belong to the system **Back** gesture.

### 5. Liquid Glass (WWDC25 219, exact wording paraphrased)
- Defined by **lensing**, not scattering; objects *materialize* by modulating lensing rather than fading.
- Responds to touch by "instantly flexing and energizing with light", with a gel-like flex that moves with the
  finger; touch illuminates from under the fingertip.
- Small bars adapt to what is behind (and flip light/dark); larger glass gets thicker shadows.
- Separation from content comes from **scroll edge effects** (soft blur/fade where content meets glass) and adaptive
  shadow — not from strokes. There is no bright specular outline on the bars.
- Controls morph between states as one floating plane (bar → menu grows out of its button).

### 6. Springs (Apple maths → RN)
- SwiftUI `Spring(duration:bounce:)`, mass 1: `stiffness = (2π / duration)²`,
  `damping = 4π (1 − bounce) / duration` (bounce ≥ 0). Apple's own example: duration 0.5, bounce 0.3 →
  stiffness 157.9, damping 17.6.
- Presets: `.smooth` = (0.5, 0) · `.snappy` = (0.5, 0.15) · `.bouncy` = (0.5, 0.3) · legacy `.spring()` =
  response 0.55 / dampingFraction 0.825 · `interactiveSpring` = 0.15 / 0.86. `response` maps like duration;
  `dampingFraction = 1 − bounce`.
- RN `Animated.spring({ stiffness, damping, mass: 1 })` uses the same physical model, so these convert 1:1.
  Gesture velocity from PanResponder is px/ms; `Animated.spring`'s `velocity` is per second → ×1000.
- System chrome runs faster than SwiftUI's 0.5 s default; OWL uses Apple's formula at 0.32–0.42 s.

### 7. Haptics
- Selection tick when a swipe commits to another tab ≈; light impact for creating a tab by gesture ≈; none for scroll
  minimize/expand or rubber-banding (Apple keeps haptics as punctuation).

### 8. Editing
- Tapping the field: the bar rises with the keyboard, the page is covered by the suggestions surface (Top Hits,
  history, bookmarks), Cancel/clear in the field. Nothing of the page competes with the field while typing.

## Spec → OWL change

| Safari spec | OWL before | OWL change | Status |
| --- | --- | --- | --- |
| Bar minimizes to a domain pill on scroll down, expands on scroll up / top / bottom / tap | Dock always full (108 pt) | Page script reports scroll direction (24 px hysteresis, past 48 px from top; expand at top/bottom); dock morphs into a 36 pt glass pill with lock + domain (crossfade + scale on native driver, `smooth` collapse, `snappy` expand); tap pill to expand; reset on tab switch, load start, editing, find, menus | Done |
| Swipe on bar: page follows finger, neighbour page peeks, spring commit | Only capsule text moved (0.7×) | Whole page follows the finger 1:1; neighbour tab's live WebView (if mounted) or a cover card (og:image / favicon / title) slides in with a 16 pt gap; neighbour host text peeks inside the capsule; commit at ⅓ width or > 0.3 px/ms flick, spring carries the finger's velocity; rubber-band at ends | Done |
| Swipe past last tab opens a new tab | — | Last (non-blank) tab: swipe left past threshold → new tab, light haptic | Done |
| Swipe up on bar → tab overview | — | Vertical flick up on the capsule (bottom dock) opens the overview | Done |
| Overview zooms from/to live page | Fade modal | Tabs route is a transparent modal; the live page scales into the current tab's card (top-left origin, measured frames) while the grid fades/scales in; tapping a card zooms the page back up from that card's frame; exits are quicker than entrances | Done |
| Close tab by swipe | Swipe sideways | Kept (Chrome/Safari both); fling uses velocity | Kept |
| Edge swipe back/forward with snapshot peek | iOS native; Android system Back | iOS: native WKWebView gesture (real snapshots, exact WebKit behaviour). Android: not re-implemented — both edges are the system Back gesture and RN has no OTA-safe WebView snapshot; system Back keeps calling page back | Deliberately skipped (flag) |
| Springs from Apple formula | Hand-tuned (340/28 …) | `appleSpring(duration, bounce)` helper; snappy (0.38, 0.12), sheet (0.42, 0.1), smooth (0.40, 0), commit (0.34, 0), zoom (0.42, 0.06) | Done |
| Glass: no stroke, separation by shadow | 1 px rim + bright specular top line | Specular line removed, rim → hairline at 5 % | Done (OTA 81a565d2) |
| Editing covers the page | Page visible below the capsule | Full-screen opaque editing sheet from status bar to bottom edge, under the dock and keyboard; fades in (140 ms) | Done |
| Haptics as punctuation | Selection on swipe | + light on new-tab-by-swipe; nothing on minimize | Done |
| Long-press link preview | Link menu (no preview) | Unchanged — a live preview needs a second WebView; candidate for later | Later |
| Reader availability indicator in the bar | Reader in menu | Later: show a small reader glyph in the capsule when the page has an article | Later |
| Pinch out on page → overview | — | Needs a two-finger recogniser over the WebView; conflicts with page zoom on Android. Later | Later |

## Sources
- WebKit iOS swipe: https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/ViewGestureControllerIOS.mm
- WebKit mac swipe constants: https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/mac/ViewGestureControllerMac.mm
- Meet Liquid Glass (WWDC25 219): https://developer.apple.com/videos/play/wwdc2025/219/
- Build a UIKit app with the new design (284): https://developer.apple.com/videos/play/wwdc2025/284
- Build a SwiftUI app with the new design (323): https://developer.apple.com/videos/play/wwdc2025/323
- HIG Tab bars: https://developer.apple.com/design/human-interface-guidelines/tab-bars
- SwiftUI Spring: https://developer.apple.com/documentation/swiftui/spring
- Animation.spring(response:dampingFraction:): https://developer.apple.com/documentation/swiftui/animation/spring(response:dampingfraction:blendduration:)
- Spring formula correction: https://www.kvin.me/posts/effortless-ui-spring-animations
- Apple newsroom (new design): https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/
- 9to5Mac iOS 26 Safari compact: https://9to5mac.com/2025/09/15/iphone-ios-26-safari-new-compact-design/
- MacRumors iOS 26 Safari guide: https://www.macrumors.com/guide/ios-26-safari-features
- Neowin iOS 26 Safari: https://www.neowin.net/guides/here-are-some-of-the-ways-you-can-use-safaris-new-look-on-apple-ios-26/
- iOS Hacker iOS 26 Safari: https://ioshacker.com/iphone/new-safari-experience-in-ios-26
- TapSmart Safari tips: https://www.tapsmart.com/tips-and-tricks/iphone-safari-tips
- How-To Geek Safari gestures: https://www.howtogeek.com/essential-safari-gestures-every-iphone-owner-should-know
- iPhoneLife swipe between tabs: https://www.iphonelife.com/content/learn-how-to-switch-tabs-safari-swipe-ios-15
- Mozilla Connect (Safari bar gestures): https://connect.mozilla.org/t5/ideas/swipe-between-open-tabs-on-ios/idi-p/2088
