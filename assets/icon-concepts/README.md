# App icon concepts (IDEA-63)

Three concepts. Each one has full art (`<id>.svg`) and simplified art for 16–32 px (`<id>-small.svg`).
`icon-concepts.png` shows them side by side: large, plus 64, 32 and 16 px on light and dark backgrounds.

| id | Concept |
| --- | --- |
| `c-molten` (default) | A front-facing gold bar with a glowing `</>` cut through it, like freshly poured metal. Navy tile with a forge glow. Still readable at 32 px. |
| `a-stamped-code` | A polished gold bar at a 3/4 angle with `</>` stamped into its top face. |
| `b-prompt` | The same bar with a `›_` prompt stamped into it, on a faint blueprint grid. |

Switch the app icon to another concept:

```sh
node scripts/icon-concepts.mjs --pick a-stamped-code   # or b-prompt / c-molten
npm run brand:app-icon && node scripts/build-icons.mjs
```

## v3 (current default): the standalone `</>` mark

`d-mark.svg` / `d-mark-small.svg` are the master icon: just the `</>` glyph in gold with a navy keyline and a
soft glow, no tile. `scripts/icon-mark.mjs` renders any frame of the motion (brackets open apart, `...` types
in, the slash drops in, a gold shimmer sweeps across); `node scripts/build-icon-v3.mjs` writes the master SVGs,
the 30 Dock launch frames (`packages/ingot-core/resources/dock-anim`) and `v3-preview/icon-v3-preview.png`.
In the app the same motion is CSS (`AnimatedMark`, `style/brand.css`) on Welcome and About, and the Dock plays
the frames once on launch. Both honour Reduce Motion. Concepts A/B/C above stay available via `--pick`.
