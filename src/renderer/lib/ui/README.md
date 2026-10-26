# OWL UI primitives (`$lib/ui`)

Shared by the shell and internal pages. APIs are stable: add props, don't rename.

```ts
import { Button, IconButton, Tooltip, Input, Textarea, Switch, Segmented, Select, Card, Popover, Dialog, Menu, ContextMenu, Kbd, Badge, Empty, CompanionAvatar, Spinner, type MenuItem } from '$lib/ui';
```

| Component | Props |
| --- | --- |
| `Button` | `variant` primary \| secondary \| ghost \| danger \| accent · `size` sm \| md \| lg · `pill` (default true) · `icon`, `iconRight` (lucide) · `loading` · `full` · bind:`ref`. Primary = black pill on light, white pill on dark. |
| `IconButton` | `icon`, `label` (aria + tooltip), `kbd`, `size` xs \| sm \| md \| lg, `active`, `side`, `badge` (true = dot, number = count), `variant` ghost \| solid \| glass. Accepts trigger props from Popover/Menu (spread `{...p}`). |
| `Tooltip` | `text`, `side`, `kbd`; `{#snippet children(p)}<button {...p}>…</button>{/snippet}` |
| `Input` | bind:`value`, `icon`, `size` sm \| md \| lg, `pill`, `inset` (neumorphic well), bind:`ref`, `trailing` snippet |
| `Textarea` | bind:`value`, `autosize`, `maxHeight`, `bare`, bind:`ref` |
| `Switch` | bind:`checked`, `label` (aria), `onCheckedChange` |
| `Segmented` | `options=[{value,label,icon?}]`, bind:`value`, `size` sm \| md, `full`, `onValueChange` (neumorphic track) |
| `Select` | `items=[{value,label,hint?}]`, bind:`value`, `placeholder`, `size`, `label` |
| `Card` | `variant` flat \| glass \| neu \| inset, `pad` none \| sm \| md \| lg, `interactive` |
| `Popover` | bind:`open`, `trigger` snippet(props), children snippet(`{ close }`), `side`, `align`, `width`, `overlay` (default true: freezes the web page under glass while open) |
| `Dialog` | bind:`open`, `title`, `description`, `width`, children, `footer` snippet |
| `Menu` | `items: MenuItem[]`, `trigger` snippet(props), `side`, `align`, `width`, `overlay` |
| `ContextMenu` | `items: () => MenuItem[]` (computed on open), children snippet(props) for the target, `overlay` (default true) |
| `Kbd` | `keys="Ctrl+K"` (⌘ on macOS) |
| `Badge` | `variant` neutral \| accent \| ok \| warn \| danger \| outline, `dot`, `pulse` |
| `Empty` | `icon`, `title`, `body`, `actions` snippet, `compact` |
| `CompanionAvatar` | `companion` (Companion or id), `size`, `face` (default true; false = full-body art), `bob`, `ring`, `status` running \| waiting \| idle |
| `Spinner` | `size` |

`MenuItem` = `{ label, icon?, kbd?, danger?, disabled?, onSelect? } | { separator: true } | { heading: string }`.

Global classes (`ui.css`): `.owl-menu`, `.owl-menu-item`, `.owl-menu-sep`, `.owl-menu-label`, `.owl-prose` (rendered markdown from `$lib/markdown`), `.tnum`.
Tokens/utilities (`app.css`): `.glass`, `.glass-strong`, `.glass-sheen`, `.neu`, `.neu-in`, `.halftone`; Tailwind colours `ink / ink-2 / ink-3 / ground / surface / surface-2 / line / accent`.

Anything that floats over the web page must freeze it (`overlay` prop, or `store.pushOverlay()` / `store.popOverlay()`), because native page views draw above the UI.
