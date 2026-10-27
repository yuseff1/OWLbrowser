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
- **Icons:** lucide-react-native only, stroke **1.75** everywhere (set once with `LucideProvider`), sizes 18 / 20 / 24. Icon in a 36 pt soft circle (`surface2`) leads list rows; 48 pt circles for the page-menu quick actions.
- **Targets:** ≥ 44 pt (IconButton pads small glyphs with hitSlop).

## Glass (floating chrome only)

Address bar + toolbar, page menu, run sheet, tab-switcher bar. Content (Home, lists, cards, settings) is flat.

```
iOS:     BlurView(intensity 70–80, systemChromeMaterial) + tint rgba(22,21,19,.55) | rgba(252,251,249,.62)
Android: tint rgba(28,26,24,.96) | rgba(252,251,249,.97)   (WebView content can't be sampled)
both:    1px rim rgba(255,248,240,.09) | rgba(20,19,23,.08)
         1px specular line on the top edge, inset by 0.6×radius, rgba(255,248,240,.14) | #FFFFFFE6
         boxShadow 0 1 2 rgba(0,0,0,.25), 0 14 36 -10 rgba(0,0,0,.55)   (light: .06 / .2)
```

## Motion

| What | How |
|---|---|
| Press | press-in 110 ms ease-out to scale 0.97 (buttons/cards), row highlight (lists), opacity 0.5 (bar glyphs); release on `snappy` spring |
| Address bar ↔ keyboard | `smooth` spring (damping 36, stiffness 320 — no overshoot) on `translateY` |
| Page menu | in: `sheet` spring from +40 px / 0.97 scale; out: 160 ms ease-out (exits faster) |
| Run sheet | `sheet` spring (damping 30, stiffness 300) |
| Tab switcher segmented pill | lozenge slides on `snappy` spring, selection haptic |
| Never | animate scrolling, tab switches inside the browser, or anything the user is reading |

Haptics: light on taps, `selection` on segmented / companion change, medium on new-tab long-press and Stop, success on save/approve, warning when a run needs you.

## Component rules

- **Address bar:** floating glass capsule, 8 pt from the edges; row 1 = menu (⋯), lock + host centred, reload/stop; row 2 = back, forward, companion face, share, tab count. While typing, row 2 hides and the bar sits on the keyboard (`useKeyboardLift`). Progress = 2 px amber line on the pill's bottom edge, gone at 100 %.
- **Suggestions:** full-height list above the bar, rows = icon well + title + one muted line.
- **Home:** companion art (no glow, no ring) → one display line → composer → three starting points in one flat card → favourites grid. No tagline, no badges.
- **Lists:** grouped flat card, icon well, inset hairline, 60 pt rows, chevron in `ink3`.
- **Empty states:** one short line in `ink3`, centred. No icon, no explanation.
- **Copy:** labels are nouns or verbs, one per intent ("Save", "Copy", "Block trackers"). No helper paragraphs, no "(e.g. …)", no emoji.

## Removed in the 2026-10-27 pass

Glow circle behind the companion art; tagline under the greeting; sparkle badge on the companion button; tracker-count badge in the address bar; companion-coloured rings/borders/cards (Atlas violet, Hoot blue); the neumorphic composer; uppercase micro-labels; lightbulb "Ideas for …" header; explanatory paragraphs on Memory, Profiles, Models, History, Bookmarks, Ask and the run sheet; icons in empty states; the "✓ / ☰" glyphs in copy.
