<p align="center">
  <img src="assets/brand/wordmark-light.svg" alt="Ingot" width="360">
</p>

<p align="center"><b>The open-source AI IDE with the soul of WebStorm.</b><br>
Bring any model. Keep your shortcuts. Own your tools.</p>

---

> **Status:** 0.1.0 in development — UI-first. Nothing to download yet. Tracked in Jira project **IDEA** (board 236).

## Why Ingot

Cursor and Windsurf proved that an IDE built around AI beats an AI bolted onto an IDE. But they are closed-source VS Code forks, tied to their vendor's model routing and pricing. Ingot is:

- **Open source (Apache-2.0)** — inspect it, fork it, extend it.
- **JetBrains look and feel** — IntelliJ New UI layout, tool windows, Search Everywhere (double Shift) and the full IntelliJ keymap out of the box.
- **Every model** — Claude, GPT, Gemini, DeepSeek, open-source models via Ollama or hosted providers. Bring your own key or use the Ingot gateway at fair prices.
- **Agent-native** — multiple agents and chats in parallel, `/` commands for your rules, skills and commands, per-hunk review of every edit.
- **Compatible** — reads your existing `.cursor/` rules and `mcp.json`, and VS Code extensions from [Open VSX](https://open-vsx.org).
- **Extensible** — plugin store, themes, color schemes, keymaps; publish your own.

## Vision (0.1.0 → 1.0)

| Area | 0.1.0 (UI-first) | Later |
| --- | --- | --- |
| Shell | WebStorm-style toolbar, tool windows, status bar, welcome screen | Signed installers, auto-update |
| Editor | Tabs, splits, IntelliJ keymap, Search Everywhere, Find/Replace in Files, Rename, Run/Debug, Terminal | Full LSP suite, inspections |
| AI | Ghost-text autocomplete UI, model picker, agent chat with `/` and `@`, multiple agents, diff review | Ingot model gateway, FIM backend, codebase index |
| Config | `.alloy/` rules, skills, commands, MCP + `.cursor/` compatibility | Cloud sync |
| Git | Branches, commit, diff, log, 3-way merge | PRs and code review |
| Customize | Settings dialog, themes, color schemes, icons, plugin store (Open VSX) | Plugin SDK and publishing |
| Business | — | Portal dashboard, pricing, Lemon Squeezy billing, team roles |

## Project config: `.alloy/`

```
.alloy/
  rules/      # *.md / *.mdc rules (frontmatter: description, globs, alwaysApply)
  skills/     # <name>/SKILL.md
  commands/   # *.md slash commands, invoked as /<name>
  mcp.json    # MCP servers
```

Ingot also reads `.cursor/rules`, `.cursor/mcp.json`, `.cursorrules` and `AGENTS.md`. When names collide, `.alloy` wins.

## Brand

| Asset | File |
| --- | --- |
| Mark | [`assets/brand/mark.svg`](assets/brand/mark.svg) |
| Wordmark (light / dark) | [`wordmark-light.svg`](assets/brand/wordmark-light.svg) / [`wordmark-dark.svg`](assets/brand/wordmark-dark.svg) |
| App icon | [`app-icon.svg`](assets/brand/app-icon.svg), `app-icon-1024.png`, `app-icon.icns`, `app-icon.ico` |
| Palette | [`palette.json`](assets/brand/palette.json), [`tokens.css`](assets/brand/tokens.css) |

**Ingot gold** `#D9A04E` · **Forge blue** `#3B6FD9` · **Forge navy** `#1B2647` · Light bg `#F7F8FA` · Dark bg `#1C1E24`.
The mark is an ingot with a text caret: raw material, ready to be shaped into code. Ingot is part of the Forge family alongside Alloy and Mission Control.

## Run it locally

Requirements: Node 22 (`nvm use`), Xcode CLT on macOS / build-essential + libsecret + libxkbfile on Linux.

```bash
npm install            # installs and builds the Ingot extensions
npm run build:browser  # bundle the browser app
npm run start:browser  # http://127.0.0.1:3100
npm run build:electron # bundle the desktop app
npm run start:electron # opens the Ingot desktop window
npm run gate           # lint + typecheck + unit tests
npm run e2e            # Playwright click-through tests (starts the browser app)
```

Layout: `packages/*` are Ingot Theia extensions, `applications/browser` and `applications/electron` are the two app targets, `e2e/` holds Playwright tests and fixture workspaces.

## Architecture

See [`docs/research.md`](docs/research.md). In short: an **Eclipse Theia**-based application (Electron desktop + browser), Monaco editor, VS Code extension compatibility via Open VSX, IntelliJ keymap and New UI-style shell as Theia extensions, Theia AI for agents/MCP, and a separate model gateway service.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md).

## License

[Apache-2.0](LICENSE) © 2026 John Yaghobieh and Ingot contributors.
