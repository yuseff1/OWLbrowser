# OWL design rules

These are the rules Youssef set while reviewing builds. Each one came from a rejection, so treat them as hard constraints.

## Identity
- Ink `#141317` (dark ground and text), amber `#E8A317` (the accent, used sparingly: focus, active state, find highlights, progress).
- Warm neutrals: paper white `rgb(255 253 250)` in light mode, `#141317`, `#1e1c1f`, `#242225` in dark mode.
- Font: Inter Variable (desktop), system font (mobile).
- The logo is a geometric owl mark (`src/renderer/public/art/owl-mark.svg`). The first logo was rejected as slop.
- Companions are original 3D owl characters: Hoot, Pip, Atlas, Nova, Echo and Byte, plus a custom one. The art in `src/renderer/public/art/companions` is approved.

## Never
- Purple, indigo or violet gradients; neon; gloss; "AI startup" gradient blobs.
- **Lighting of any kind** (2026-10-30): specular rims, top highlight lines, sheen overlays, inset white highlights, corner hue glows, radial "spotlight" backgrounds in cards, coloured glow rings on focus, glowing blobs behind content.
- Moving or vibrating characters: no bob, float, wiggle or pulse on companion art.
- Lucide icons (any package). Emoji as UI icons.
- Generic template look: oversized hero gradients, glassmorphism stacked on glassmorphism, drop shadows on everything.

## Do
- Flat surfaces. Separate them with a 1 px hairline (`--glass-edge` / `--line`) and, for floating layers, one soft neutral shadow.
- "Liquid glass" means tint + backdrop blur + hairline + soft shadow, with **no** rim light. Tokens in `src/renderer/app.css`: `--glass-sheen` and `--glass-hue` are `none`, and `--glass-rim` is transparent. Keep them that way.
- Fluent UI System Icons (regular, filled for active state), 16/20 px, stroke weight matched to text.
- Calm motion: short eases (120–220 ms) for UI, springs for gestures (mobile uses Apple's spring formula; see `docs/research-safari.md`). Respect `prefers-reduced-motion`.
- Text contrast of at least 4.5:1 on every surface, including glass.
- Use component primitives (bits-ui on desktop, the shared `ui.tsx` on mobile) rather than inventing widgets.

## Mobile specifics (`docs/mobile-design.md` holds the full spec)
- Floating capsule dock (top or bottom, chosen in settings) with live blur on Android 12+ (`BlurTargetView` + BlurView). BlurView must mount only after the target exists.
- While typing, the dock is a solid one-piece capsule and a solid sheet covers the whole screen down to the keyboard. No page shows through, and no squeeze animation.
- No bright top line on any bar, only a near-invisible hairline.
- Safari-inspired behaviour: the bar shrinks to a domain pill on scroll, swiping the bar moves the page with a live peek at the next tab, and the tab overview zooms the page into its card.

## Reference
- Inspiration: strawberrybrowser.com (light touch), Safari (`docs/research-safari.md`), glassyui.com, liquid-glass.glassapp.dev (blur recipe only, without their highlights).
- Design-quality skills used for UI work (see docs/TOOLS.md): taste-skill, Anthropic frontend-design, ui-ux-pro-max.
