# AGENTS.md — instructions for AI agents working on Ingot

Ingot is an open-source AI IDE with a calm, compact desktop-IDE look and feel. Read `README.md`, `CONTRIBUTING.md` and `docs/research.md` first.

## Ground rules

- Follow every rule in `.ingot/rules/`.
- Work only on a `feature/IDEA-<n>` or `bug/IDEA-<n>` branch cut from the current `release/<version>` branch. Commit as `IDEA-<n>: <summary>`. One PR per ticket into `release/<version>`.
- Before pushing: self code review, `npm run gate`, `npm run e2e`, `npm run build`, secret scan. All green or don't push.
- Never commit secrets. Config with secrets lives in gitignored `ingot.config.json`.
- Never touch `master` directly. Never force-push shared branches.
- Types in `*.types.ts`, constants in `*.consts.ts`, path aliases, no magic strings/numbers, named exports.
- UI must match the Ingot UI layout and the Ingot keymap; colors come from design tokens only.

## Product decisions already made

- Base platform: Eclipse Theia (not an editor fork). See `docs/research.md`.
- Extensions: Open VSX only — never the Microsoft Marketplace.
- Native config folder: `.ingot/` (rules, skills, commands, mcp.json); existing rule folders and `AGENTS.md` are read too.
- License: Apache-2.0.
