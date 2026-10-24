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
