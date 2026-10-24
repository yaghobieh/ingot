# Contributing to Ingot

Thanks for helping build Ingot. These rules apply to humans and AI agents alike.

## Branches

- `master` — production / released code.
- `release/0.1.0` — integration branch for the current version (**default branch**). Next versions get `release/<version>`.
- Work branches come off the current release branch:
  - `feature/IDEA-<n>` for features and tasks
  - `bug/IDEA-<n>` for fixes
- One Jira ticket → one branch → one PR into `release/<version>`.
- When a release is ready and tested, merge `release/<version>` → `master` and tag `v<version>`.

## Commits

- Every commit message starts with the ticket key: `IDEA-<n>: <imperative summary>`
  (e.g. `IDEA-19: add Search Everywhere popup`).
- Small, focused commits. No unrelated changes in a PR.

## Gate before every push

1. **Code review** — self-review `git diff --staged` against every rule in `.ingot/rules`. Fix findings and list them in the PR body.
2. **Gate** — `npm run gate` (lint + typecheck + unit tests) is green.
3. **E2E** — `npm run e2e` (Playwright for Electron, real clicks and shortcuts against fixture repos with mock AI). Add or extend specs for every user-facing change.
4. **Build** — `npm run build` is green for desktop and browser targets.
5. **Secret scan** — run `npm run secret-scan` (and `gitleaks protect --staged` if installed). Staged files must never contain keys, tokens, passwords or values from `ingot.config.json`.

PR body: summary, ticket link, review notes, e2e results, screenshots/GIFs for UI.

## Secrets

- Secrets live **only** in `ingot.config.json` (gitignored) or the OS keychain / CI secrets. Commit `ingot.config.example.json` with empty values.
- Never put secrets in code, tests, fixtures, logs, screenshots or issues.

## Code structure

- TypeScript strict everywhere. Named exports only (no `export default`, except tool configs).
- **Types** go in `*.types.ts` files and are imported with `import type`.
- **Constants** go in `*.consts.ts` files (per unit) or `src/constants/`. No magic strings or numbers in logic (`0`, `1`, `-1`, `''`, `[]`, `{}` allowed). Group related values in `as const` objects and derive union types from them.
- Each unit (component, widget, service) gets its own folder: `<Name>.tsx|ts`, `<Name>.utils.ts`, `<Name>.consts.ts`, `<Name>.types.ts`, `index.ts`.
- **Path aliases** (`@ingot/core`, `@ingot/ui`, `@constants`, `@utils`, `@typings`, ...) defined in `tsconfig` paths. No `../` imports across units.
- UI colors only from design tokens (`assets/brand/tokens.css` / theme service). No hard-coded colors.
- Every user-visible string goes through i18n (en first; he and es later).

## Jira workflow (project IDEA)

`To Do` → `In Progress` (branch created) → `In testing` (PR merged into `release/<version>`) → `Done` (tester verified the acceptance criteria by clicking through the build).

## License

By contributing you agree your contributions are licensed under Apache-2.0.
