# OWL Mobile — design spec

The mobile app (`mobile/`, Expo SDK 58) follows one rule: **the page is the product, the chrome gets out of the way**.
Warm neutrals carry everything, amber is spent only where it means something, and only floating chrome is glass.
Tokens live in `mobile/src/lib/theme.ts`; primitives in `mobile/src/components/ui.tsx`. Never hard-code a colour,
radius or size in a screen — import it.

## Sources studied

| Source | What we took |
|---|---|
| Revolut app / brand (design-system write-ups: [voltagent DESIGN.md](https://raw.githubusercontent.com/voltagent/awesome-design-md/main/design-md/revolut/DESIGN.md), [getdesign.md analysis](https://getdesign.md/design-md/revolut/preview), [Revolut 2023 rebrand post](https://www.linkedin.com/posts/revolut_explore-our-glow-up-activity-7117841619902488577-3JL6)) | Aeonik-style grotesk at weight 500–600 with tight tracking on large sizes; near-black canvas with exactly two surface steps; no drop shadows on content (depth = surface luminance shift + hairlines); **every action is a pill**; cards 20 px, inputs 12 px; one brand colour used scarcely; icon-in-soft-circle list tiles; pill segmented controls; muted secondary text; 48 px action height. |
| [Appllama app-design skill](https://github.com/Appllama/appllama-skills) | Anti-slop pre-flight (1 accent, one grey family, one radius scale, 0 emoji in chrome, 0 gradients); press feedback on press-in ≤150 ms (scale 0.97 for buttons/cards, highlight for rows, opacity for bar glyphs); springs for anything a finger moved, strong ease-out `bezier(0.23,1,0.32,1)` for the rest; exits faster than entrances; `borderCurve: 'continuous'`; `boxShadow` instead of legacy shadow props; haptics as punctuation (one per action, never in loops); tabular numerals for counts. |
| [react-native-motion / chatgpt-attachments](https://github.com/SchroederNathan/react-native-motion/tree/main/apps/expo/components/animations/chatgpt-attachments) | Measured constants instead of eyeballed ones; spring vocabulary expressed as damping ratio (`smooth` = 1, `snappy` ≈ 0.85, sheets ≈ 0.8); glass fallback: on Android a blur cannot sample content in another surface, so use the measured tint as a flat fill; menus grow from their trigger. |
| [ShipSwift](https://github.com/signerlabs/ShipSwift) | iOS polish defaults: 16 pt gutters, grouped inset lists, 44 pt targets, sentence-case section headers, one-line empty states. |
| [Glassy UI](https://glassyui.com/components) ([RN source](https://github.com/alexburlis/glassyui/tree/main/registry/glassyui-native)) | Glass recipe: blur intensity 70 (standard) / 90 (overlay); thin frost over the blur; 1 px rim (`rgba(255,255,255,.16)` dark / `.55` light); 1 px top specular line (`.34` / `.9`); two-layer shadow `0 1 2 / 0 8 24 -4`; radii 16 / 24 / capsule; Android without a blur target = translucent tint, no blur. |
| [Liquid Glass (glassapp)](https://liquid-glass.glassapp.dev/#examples) | Glass only on floating controls (toolbar, tab bar, menu); specular rim on the top edge; depth from shadow, not from thick borders. Refraction/displacement skipped on purpose (subtle). |

## Colour

Warm neutrals, one accent. No purple / indigo / violet, no neon, no gradients. Companion characters keep their own
art colours, but the **UI never tints with them** (rings, borders, cursors are amber).

| Token | Dark | Light | Use |
|---|---|---|---|
| `ground` | `#0E0D0C` | `#F6F5F2` | screen |
| `surface` | `#1A1917` | `#FFFFFF` | cards, grouped lists |
| `surface2` | `#252320` | `#EDEBE7` | inputs, icon wells, segmented track |
| `ink` | `#F5F2EE` | `#141317` | primary text / glyphs |
| `ink2` | `#A39C94` | `#5E5953` | secondary text (≥ 4.5:1) |
| `ink3` | `#6E6862` | `#9A948D` | placeholders, chevrons, disabled |
| `line` | `rgba(255,248,240,.07)` | `rgba(20,19,23,.07)` | hairlines |
| `accentFill` | `#E8A317` | `#E8A317` | primary button, progress, active, selection |
| `accent` | `#E8A317` | `#9A6400` | accent as text (contrast-safe) |
| `accentInk` | `#141317` | `#141317` | text on amber |
| `danger` | `#F2645A` | `#D93B2E` | destructive only |

Accent budget per screen: one primary action **or** one active state, plus the load progress line.

## Spacing, radius, type, icons

- **Spacing (4 pt grid):** 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48. Gutter 16, card padding 16, section gap 24.
- **Radius:** 8 xs · 12 rows/inputs · 16 tiles · 20 cards · 24 composer · 28 sheets & address bar · pill for every action. Always `borderCurve: 'continuous'`.
- **Type (system grotesk):** display 32/36 600 −0.9 (one per screen) · title 22/28 600 −0.4 · headline 17/22 600 · body 16/22 · callout 15/20 · footnote 13/18 · caption 12/16 500 · section header 13/18 600 sentence case (no uppercase labels).
- **Icons:** Microsoft **Fluent UI System Icons** (MIT, same set as desktop) through `components/Icon.tsx` (`<Icon name="dismiss" size={20} color={t.ink} />`), drawn with react-native-svg so it ships over the air. Only the names in `mobile/scripts/fluent-icons.json` are bundled; add one there and run `node scripts/gen-icons.mjs` from `mobile/`. **Regular** style everywhere; **filled** only for an on/active state (saved star, desktop site on, reader active, stop while running). Fluent draws separate art per size; `Icon` picks 16 / 20 / 24 art for the size it renders at. Sizes 18 / 20 / 24. Icon in a 36 pt soft circle (`surface2`) leads list rows; 48 pt circles for the page-menu quick actions. No lucide (rejected as the generic "AI look").
- **Targets:** ≥ 44 pt (IconButton pads small glyphs with hitSlop).

## Glass (floating chrome only)

Address dock (capsule + toolbar), page menu, run sheet, tab-switcher bar. Content (Home, lists, cards, settings) is flat.
The dock and the page menu are **live liquid glass**: they blur the page behind them. The run sheet keeps the dense
tint on purpose (long secondary text needs a calm surface).

```
iOS:      BlurView(intensity 90, systemChromeMaterial) + tint rgba(24,22,20,.38) | rgba(252,250,246,.40)
Android:  BlurTargetView wraps the page (WebViews + Home + ControlRing) on the browser screen;
          BlurView(blurMethod dimezisBlurViewSdk31Plus, blurTarget, intensity 90, blurReductionFactor 3)
          native overlay systemUltraThinMaterialDark | light, then tint rgba(22,20,18,.42) | rgba(252,250,246,.25)
fallback: rgba(28,26,24,.96) | rgba(252,251,249,.97)   (Android < 12, Live blur off, screens with no blur target)
all:      sheen: linear gradient from the top, rgba(255,248,240,.07) | rgba(255,255,255,.32) → transparent over 55 %
          1px rim rgba(255,248,240,.12) | rgba(20,19,23,.08)
          1px specular line 1px below the top edge, inset by 0.6×radius, rgba(255,248,240,.24) | #FFFFFFE6
          boxShadow 0 1 2 rgba(0,0,0,.25), 0 14 36 -10 rgba(0,0,0,.55)   (light: .06 / .2)
capsule:  well rgba(0,0,0,.24) dark (recessed) | rgba(20,19,23,.05) light; secondary glyphs/placeholder = ink at 78 %
```

**Contrast (measured, worst case = pure white page under dark glass / pure black under light glass, before blur):**
`ink` on Android dark glass 4.9:1, light 10.3:1; capsule secondary (`glass.ink2`) 5.2:1 / 6.0:1. Blur only averages
the page, so real pages are never worse than this. Menu captions use `ink`, not `ink2`, for the same reason.

**Why these choices**
- Android blur is only real and cheap on 12+ (RenderNode). Below 12, expo-blur 58.0.5 still runs the old software
  blur even with `dimezisBlurViewSdk31Plus` (expo/expo#52042, crashes on Android 9), so `LIVE_BLUR` gates it in JS and
  older phones get the dense tint.
- A RN `<Modal>` is its own Android window, so blur can't reach the page from it (expo/expo#44165). The page menu is
  therefore an in-screen overlay (BackHandler closes it).
- To have something to blur, the page runs **under** the dock (Live blur on). iOS keeps content reachable with
  `contentInset`; Android has none, so `lib/insets.ts` injects page insets into the main frame: spacers before/after
  the document, plus fixed/sticky bars pinned to the covered edge (cookie banners, sticky headers, bottom navs) moved
  in by the inset (full scan on load + throttled DOM changes; while scrolling only the edge elements are probed).
  Pages that scroll an inner full-height container can still have their last ~100 px under the dock; Live blur off
  (Settings → Address bar) restores the old layout where the page stops at the dock.
- Performance: one BlurTargetView, RenderNode recording (the page is drawn once and reused for the blur), blur at
  1/3 radius scale. If scrolling ever janks on a device, Live blur off is the escape hatch; it needs no update.

## Address dock geometry

One glass shape, `PAD` 6 on every side, so radii are concentric in every state: **outer 30 = capsule 24 + 6**.
Capsule 48 high; toolbar row 48; dock 108 (editing: 60, toolbar hidden, same insets). 8 pt from the screen sides.

- **Position** (Settings → Address bar position, `settings.barPosition`, default bottom). Bottom: 8 pt above the
  home indicator, rises with the keyboard. Top: 8 pt below the status bar, never moves for the keyboard; suggestions
  open downward from under it to the keyboard; the page menu drops down from the top. The run sheet and tab switcher
  don't change. Switching slides the dock in from its new edge on the `sheet` spring.
- **Progress:** 2 px amber line on the dock edge that faces the page (top edge at the bottom, bottom edge at the top),
  inset by the outer radius, gone at 100 %.

## Motion

| What | How |
|---|---|
| Press | press-in 110 ms ease-out to scale 0.97 (buttons/cards), row highlight (lists), opacity 0.5 (bar glyphs); release on `snappy` spring |
| Address bar ↔ keyboard | `smooth` spring (damping 36, stiffness 320 — no overshoot) on `translateY` |
| Squeeze (dock, page menu) | liquid-glass body: press squashes it (scaleX +2.2 %, scaleY −4.5 %, from the edge it's docked to); dragging stretches along the drag and follows the finger on a soft rubber band (x/(1+\|x\|/k)); release wobbles back on `jelly` (damping 14, stiffness 420, mass 0.9 ≈ ζ 0.36). Raw touch events, so buttons inside keep their own press feedback. Menu at 60 % strength. |
| Dock position switch | slides in from the new edge on `sheet` spring with a fade |
| Page menu | in: `sheet` spring from ±40 px (from the dock's edge) / 0.97 scale; out: 160 ms ease-out (exits faster) |
| Run sheet | `sheet` spring (damping 30, stiffness 300) |
| Tab switcher segmented pill | lozenge slides on `snappy` spring, selection haptic |
| Never | animate scrolling, tab switches inside the browser, or anything the user is reading |

Haptics: light on taps, `selection` on segmented / companion change, medium on new-tab long-press and Stop, success on save/approve, warning when a run needs you.

## Component rules

- **Address dock:** one liquid-glass shape (no slab behind it), 8 pt from the edges, bottom or top; row 1 = capsule with menu (⋯), lock + host centred, reload/stop; row 2 = back, forward, companion face, share, tab count. While typing, row 2 hides; at the bottom the dock sits on the keyboard (`useKeyboardLift`). Geometry and progress: see *Address dock geometry*.
- **Suggestions:** full-height list between the dock and the far edge (bottom dock: above it, inverted; top dock: below it, down to the keyboard), rows = icon well + title + one muted line.
- **Home:** companion art (no glow, no ring) → one display line → composer → three starting points in one flat card → favourites grid. No tagline, no badges.
- **Lists:** grouped flat card, icon well, inset hairline, 60 pt rows, chevron in `ink3`.
- **Empty states:** one short line in `ink3`, centred. No icon, no explanation.
- **Copy:** labels are nouns or verbs, one per intent ("Save", "Copy", "Block trackers"). No helper paragraphs, no "(e.g. …)", no emoji.

## Daily-use browsing (2026-10-28)

- **Dock swipe:** drag the address capsule sideways to move to the neighbouring tab in the same strip (normal or private). The capsule content follows the finger at 0.7×, leaves, and the next tab's slides in from the other side; at either end it rubber-bands. Selection haptic on switch. The toolbar row is not a swipe area.
- **Private tabs:** the address capsule turns ink-dark (`#1E1C1A`, light text) in both themes, with the filled private glyph; tab cards in the Private strip are always dark.
- **Tab switcher:** two-column cards: header (favicon, title, 28 pt close) over a cover — the page's `og:image` when it has one (captured by the page-tools script, https only, persisted with the tab), else the favicon and host on a soft well, the companion for a new tab. Swipe a card sideways to close it; amber 1.5 pt border marks the current tab; opens scrolled to it. Segmented pill shows both counts; Close all asks first.
- **Long-press menu:** long-press a link or image → in-screen glass sheet (same overlay pattern as the page menu): target (thumbnail for images, link text, URL) then Open in new tab / Open in private tab / Copy link / Copy link text / Share link / Download link, and Open image in new tab / Copy image address / Download image. New tabs open in the background with a toast "Opened in new tab · Switch". From a private tab, links only open private.
- **Toast:** one glass pill above the dock (below it in top mode), one line + optional amber action, 3.2 s.
- **Find in page:** page menu → Find in page. The find capsule takes the dock's place (solid capsule while typing, rides the keyboard like the dock); amber highlights in the page, current match solid amber; `n/m` counter (danger colour at 0/0), up/down chevrons, Enter = next. Leaving the page or tab ends it.
- **Text size:** page menu row with − / % / + stepper per site (50–200 %, Android WebView `textZoom`, iOS `-webkit-text-size-adjust`); tap the row to reset to 100 %. Non-default sizes show in amber.
- **Downloads:** WebView downloads and long-press "Download" ask once ("Download file?" + file name) and hand the URL to the system.
- **History / Bookmarks:** search field on top; long-press a row to open it in a background tab.
- **Pull-to-refresh:** deliberately off (a wrapper intercepted vertical drags on pages that scroll an inner container). Reload is in the capsule.

## Removed in the 2026-10-27 pass

Glow circle behind the companion art; tagline under the greeting; sparkle badge on the companion button; tracker-count badge in the address bar; companion-coloured rings/borders/cards (Atlas violet, Hoot blue); the neumorphic composer; uppercase micro-labels; lightbulb "Ideas for …" header; explanatory paragraphs on Memory, Profiles, Models, History, Bookmarks, Ask and the run sheet; icons in empty states; the "✓ / ☰" glyphs in copy.
