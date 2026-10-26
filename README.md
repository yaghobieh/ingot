<p align="center">
  <img src="assets/brand/wordmark-light.svg" alt="Ingot" width="360">
</p>

<p align="center"><b>The open-source AI IDE.</b><br>
Bring any model. Keep your shortcuts. Own your tools.</p>

---

> **Status:** 0.1.0 in development — UI-first. Nothing to download yet. Tracked in Jira project **IDEA** (board 236).

## Why Ingot

An IDE built around AI beats an AI bolted onto an IDE. Most AI editors today are closed source and tied to one vendor's model routing and pricing. Ingot is:

- **Open source (Apache-2.0)** — inspect it, fork it, extend it.
- **A calm, compact desktop IDE** — main toolbar, tool windows, Search Everywhere (double Shift) and a complete IDE-style keymap out of the box.
- **Every model** — Claude, GPT, Gemini, DeepSeek, open-source models via Ollama or hosted providers. Bring your own key or use the Ingot gateway at fair prices.
- **Agent-native** — multiple agents and chats in parallel, `/` commands for your rules, skills and commands, per-hunk review of every edit.
- **Compatible** — reads existing rule folders and `mcp.json` in your projects, and installs extensions from [Open VSX](https://open-vsx.org).
- **Extensible** — plugin store, themes, color schemes, keymaps; publish your own.

## Vision (0.1.0 → 1.0)

| Area | 0.1.0 (UI-first) | Later |
| --- | --- | --- |
| Shell | Main toolbar, tool windows, status bar, welcome screen | Signed installers, auto-update |
| Editor | Tabs, splits, Ingot keymap, Search Everywhere, Find/Replace in Files, Rename, Run/Debug, Terminal | Full LSP suite, inspections |
| AI | Ghost-text autocomplete UI, model picker, agent chat with `/` and `@`, multiple agents, diff review | Ingot model gateway, FIM backend, codebase index |
| Config | `.ingot/` rules, skills, commands, MCP + existing rule folders | Cloud sync |
| Git | Branches, commit, diff, log, 3-way merge | PRs and code review |
| Customize | Settings dialog, themes, color schemes, icons, plugin store (Open VSX) | Plugin SDK and publishing |
| Business | — | Portal dashboard, pricing, Lemon Squeezy billing, team roles |

## Project config: `.ingot/`

```
.ingot/
  rules/      # *.md / *.mdc rules (frontmatter: description, globs, alwaysApply)
  skills/     # <name>/SKILL.md
  commands/   # *.md slash commands, invoked as /<name>
  mcp.json    # MCP servers
```

Ingot also reads existing rule folders in the project (for example `.cursor/rules` and `mcp.json`), the legacy `.alloy/` folder and `AGENTS.md`. When names collide, `.ingot` wins.

## Keymap

See [`docs/keymap.md`](docs/keymap.md) for every default shortcut (macOS and Windows/Linux). Switch to the platform defaults with **Settings › Keymap › Alternative**.

## Brand

| Asset | File |
| --- | --- |
| Mark | [`assets/brand/mark.svg`](assets/brand/mark.svg) |
| Wordmark (light / dark) | [`wordmark-light.svg`](assets/brand/wordmark-light.svg) / [`wordmark-dark.svg`](assets/brand/wordmark-dark.svg) |
| App icon | [`app-icon.svg`](assets/brand/app-icon.svg), `app-icon-1024.png`, `app-icon.icns`, `app-icon.ico` |
| Palette | [`palette.json`](assets/brand/palette.json), [`tokens.css`](assets/brand/tokens.css) |

**Ingot gold** `#D9A04E` · **Forge blue** `#3B6FD9` · **Forge navy** `#1B2647` · Light bg `#F7F8FA` · Dark bg `#1C1E24`.
The mark is an ingot with a text caret: raw material, ready to be shaped into code.

## Run it locally

Requirements: Node 22 (`nvm use`), Xcode CLT on macOS / build-essential + libsecret + libxkbfile on Linux.

```bash
npm install            # builds the Ingot extensions, downloads builtin language plugins into plugins/,
                       # and (macOS) renames the dev Electron.app to Ingot with the Ingot icon
npm run build:browser  # bundle the browser app
npm run start:browser  # http://127.0.0.1:3100
npm run build:electron # bundle the desktop app
npm run start:electron # opens the Ingot desktop window
npm run package:electron -- --mac --arm64   # installers in applications/electron/dist (see docs/release.md)
npm run gate           # lint + typecheck + unit tests
npm run e2e            # Playwright click-through tests (starts the browser app)
```

Installers for macOS, Windows and Linux are built by the Release workflow when a `v*` tag is pushed; see [`docs/release.md`](docs/release.md).

Re-download language plugins with `npm run download:plugins` (syntax highlighting needs them). Electron and browser builds swap native modules in the shared `node_modules`; run `npm run build:browser` again before `npm run e2e` if you built Electron last.

The UI follows [`docs/design/ide-reference.png`](docs/design/ide-reference.png) (compact density, Ingot gold/blue accent, Light / Dark / System).

Layout: `packages/*` are Ingot Theia extensions, `applications/browser` and `applications/electron` are the two app targets, `e2e/` holds Playwright tests and fixture workspaces.

## Architecture

See [`docs/research.md`](docs/research.md). In short: an **Eclipse Theia**-based application (Electron desktop + browser), Monaco editor, extension compatibility via Open VSX, the Ingot keymap and shell as Theia extensions, Theia AI for agents/MCP, and a separate model gateway service.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md).

## License

[Apache-2.0](LICENSE) © 2026 John Yaghobieh and Ingot contributors.
