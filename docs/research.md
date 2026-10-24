# Ingot — research and architecture decision (Oct 2026)

Prices and facts were checked on 24 Oct 2026 from the sources listed at the end. Re-verify before any commercial decision.

## 1. How the competition is built

| Product | Base | License of our usable code | Notes |
| --- | --- | --- | --- |
| Cursor | Closed-source fork of VS Code (Code-OSS) | Closed | Uses Open VSX through its own proxy (`marketplace.cursorapi.com`) with malware scanning; replaced Microsoft-only extensions with its own builds. Constant rebasing on upstream VS Code. |
| Windsurf, Trae, Kiro, Antigravity | Closed-source VS Code forks | Closed | Same model as Cursor; Jan 2026 research (Koi) showed forks inherit VS Code "recommended extensions" that don't exist on Open VSX, so attackers could claim the namespaces. |
| Void | Open-source VS Code fork | Open source (see repo licence) | **Deprecated, no longer accepting contributions**, but still the best public reference for forking VS Code: React+Tailwind mounted inside the workbench, own provider layer with FIM autocomplete, streaming diff edit service, CI for packaging/signing/auto-update. |
| VSCodium | Code-OSS build without Microsoft branding/telemetry | MIT | Shows how to build Code-OSS binaries and point them at Open VSX. |
| Zed | Native Rust editor (GPUI, GPU-rendered) | Editor GPL-3.0, server AGPL, GPUI/ACP Apache-2.0 | Fastest editor, own WASM extension system (not VS Code extensions). 1.0 shipped Apr 2026. Edit predictions with Zeta, and Ollama FIM provider merged Feb 2026. Copyleft makes a proprietary-friendly rebrand impossible; Apache-2.0 for us would be blocked. |
| Eclipse Theia | Independent framework (not a fork) reusing Monaco and the VS Code extension API | EPL-2.0 (with GPL secondary licence) | Built to make branded IDE products (Arduino IDE 2, many enterprise tools). Desktop (Electron) and browser from one codebase. **Theia AI**: LLM providers, prompts, agents, MCP, Agent Skills, fully customizable chat. Open VSX integration built in. |
| JetBrains IntelliJ Platform | JVM/Swing (IntelliJ Community is Apache-2.0) | Apache-2.0 for Community | Gives the real WebStorm UX, but Java/Kotlin stack, heavy, and WebStorm-only JS features are proprietary. Not a fit for a TS team shipping fast. |

## 2. Options for Ingot

| Option | Pros | Cons |
| --- | --- | --- |
| **A. Fork Code-OSS (Cursor/Void path)** | 100% VS Code extension compatibility; fastest path to a working editor; huge contributor familiarity. | Workbench layout is hard to reshape into a JetBrains UI (Void had to hack the build to mount React). Monthly rebase pain. Microsoft Marketplace is off-limits anyway. You inherit VS Code's look, which is what we want to move away from. |
| **B. Build on Eclipse Theia (recommended)** | Not a fork, no rebasing: depend on npm packages. Every UI part is replaceable via dependency injection, so a WebStorm-style shell (tool window stripes, main toolbar, Search Everywhere) is a supported customization. Runs VS Code extensions from Open VSX. Theia AI already has agents, MCP, prompt templates, skills, custom chat. Desktop + browser (also good for the portal/cloud later). Vendor-neutral governance (Eclipse Foundation). | Slightly behind VS Code in extension API coverage (most popular extensions work; check per extension). Smaller community than VS Code. EPL-2.0 is weak copyleft per file: modifications to Theia files must stay EPL, our own files can be Apache-2.0. |
| C. Fork Zed | Best performance, native feel. | GPL/AGPL; Rust + GPUI; no VS Code extensions; much slower for us to build the JetBrains UI. |
| D. IntelliJ Platform | Truest WebStorm feel. | JVM stack, heavy, licensing of JS support, plugin model unlike VS Code. |

### Decision

**Option B: Eclipse Theia** for 0.1.0, with these building blocks:

- **Shell:** custom Theia frontend extensions for the IntelliJ New UI layout — main toolbar (project / VCS / run widgets), left/right/bottom tool window stripes, status bar widgets, navigation bar, Welcome screen. Our own React components styled with Ingot tokens.
- **Editor:** Monaco (Theia's default) + LSP via VS Code extensions (TypeScript, ESLint, Prettier) and built-in Theia language support.
- **Keymap:** IntelliJ default keymap as the default keybinding set (start from the MIT-licensed `k--kato/intellij-idea-keybindings` mapping, extend for actions VS Code lacks, e.g. Search Everywhere double-Shift, Refactor This, tool-window shortcuts). Keymap switcher (IntelliJ / VS Code / custom) and IntelliJ XML import.
- **Search Everywhere & Find in Files:** Theia quick-input framework + ripgrep backend (Theia already ships ripgrep search).
- **Look:** Ingot Light/Dark/Darcula themes (our tokens). Reference: `compassak.intellij-idea-new-ui` theme on the VS Code side. Icons: our own set in the New UI style; IntelliJ Community icons are Apache-2.0 if we need to borrow (attribute in NOTICE). Do not copy JetBrains logos or trade dress.
- **Extensions:** Open VSX as default registry (never the Microsoft Marketplace, which is contractually limited to Microsoft products). Later: our own proxy/curated registry with malware scanning and a blocklist (what Cursor does), and remove inherited "recommended extensions" that don't exist on Open VSX.
- **AI:** Theia AI as the harness (providers, agents, MCP, prompt templates), with our own UI: agent tool window, `/` command menu fed by `.alloy` + `.cursor` rules/skills/commands, `@` context, multiple chats/agents, per-hunk diff review. Port the agent loop and RAG learnings from Mission Control.
- **Autocomplete:** Monaco inline completions (ghost text). Backend: FIM-capable models — local Ollama (`qwen2.5-coder` 1.5B/7B, Apache-2.0), hosted Codestral (check Mistral licence for production) or Qwen coder via Fireworks/Together/our gateway. Context = prefix/suffix + open tabs + recent edits + tree-sitter symbols. Later: next-edit prediction (like Zed's Zeta/Cursor Tab).
- **Desktop packaging:** Theia's Electron app with electron-builder; signing/notarization and auto-update later (IDEA-49).
- **Testing:** Playwright `_electron` click-through e2e on macOS/Windows/Linux in CI (IDEA-38).

Fallback: if Theia's extension compatibility blocks a must-have extension, evaluate a Code-OSS fork using Void's codebase as the reference. Keep UI code in our own packages so it is portable.

## 3. Model backend: one API for all models (question #4)

| Gateway | What it is | Cost (Oct 2026) | Pros | Cons |
| --- | --- | --- | --- | --- |
| **OpenRouter** | Hosted aggregator, 500+ models, 80+ providers, OpenAI-compatible | Provider list price + 5.5% fee on credit purchases (Standard), 8% Business; BYOK free up to $25k/month list-price inference then 5% | Zero ops, every model on day one (Claude, GPT, Gemini, DeepSeek, Llama, Qwen, Mistral...), fallbacks/auto-routing | Fee eats margin at scale; data passes a third party; limited per-user controls |
| **LiteLLM (self-hosted proxy)** | Open-source proxy (MIT), 100+ providers, OpenAI- and Anthropic-compatible endpoints | Free; pay server + Postgres/Redis + your time; Enterprise via sales | No markup, data stays with us, virtual keys per user, budgets, rate limits, fallbacks, spend tracking -> perfect for the portal dashboard | We run and scale it; must keep it updated |
| Portkey | Managed (and open-source) gateway + observability | Free 10k logs/month; Production $49/mo incl. 100k logs | Routing + logs + prompt management in one | BYOK only, another vendor, log-based pricing |
| Vercel AI Gateway | Managed gateway on Vercel | Zero token markup, $5/month free credit, pay-as-you-go credits | Zero markup, easy if hosted on Vercel (Alloy already is) | Fewer per-user controls; not self-hostable; best inside Vercel apps |
| Cloudflare AI Gateway | Managed gateway | Core free, 5% on unified billing credits | Caching, logs, global edge | Fewer models than OpenRouter in unified billing |
| Together / Fireworks | Hosted inference for open-source models | Per-token, usually well below proprietary models | Fast, cheap Llama/Qwen/DeepSeek/Mistral incl. coder models for autocomplete | OSS models only |
| Ollama | Local runtime | Free (user's hardware) | Private, offline, free autocomplete with small coder models | Depends on user's machine |

### Recommendation

1. **Free tier / power users: BYOK + local.** The IDE talks directly to Anthropic, OpenAI, Google, DeepSeek, OpenRouter, any OpenAI-compatible URL, and Ollama, with keys in the OS keychain. No server cost for us.
2. **Ingot paid plans: self-hosted LiteLLM proxy as the "Ingot gateway"**, with upstreams:
   - direct provider accounts for the big four (Anthropic, OpenAI, Google, DeepSeek) — best price and rate limits;
   - **Fireworks or Together** for open-source models and the autocomplete model;
   - **OpenRouter as the long-tail/fallback upstream** (any model we don't contract directly).
   LiteLLM gives per-user virtual keys, budgets and spend logs, which feed the portal dashboard and Lemon Squeezy usage billing.
3. Start fast: for the first beta, OpenRouter alone (5.5% fee) is acceptable; move volume to direct providers behind LiteLLM once usage justifies it. Vercel AI Gateway (zero markup) is a good alternative upstream if we host the portal on Vercel.

## 4. Pricing context (for IDEA-45)

Public prices seen Oct 2026: Copilot Pro $10/mo, Pro+ $39, Business $19/user; Zed Pro $10/mo incl. $5 tokens, Business $30/seat. Cursor/Windsurf plans to be refreshed from their pricing pages when we draft ours. Our pitch: free forever with BYOK + local models; paid plans charge model usage near cost with a small transparent margin.

## 5. Naming

Checked GitHub (`yaghobieh/<name>` free) and web for existing IDEs/editors:

| Candidate | Result |
| --- | --- |
| **Ingot** (chosen) | No IDE or editor by that name found; only small unrelated crates. Fits the Forge family (Alloy, Mission Control, Forge). Short, brandable, `.alloy` config fits the metal theme. Formal trademark search still recommended before launch. |
| Ferro | A small hobby Rust terminal editor `ferro` exists on crates.io — some confusion risk. |
| Quench | Quench.ai exists (AI search API, not an IDE) — some confusion risk. |
| Rejected | Lathe (Zed fork), Kerf (web editor), Tenon (AI IDE), Anneal (AI editor project), Kiln (repo already exists under yaghobieh), Anvil/Foundry/Crucible (existing products). |

## Sources

- Eclipse Foundation blog, "Why Cursor, Windsurf and co fork VS Code, but shouldn't": https://blogs.eclipse.org/post/thomas-froment/why-cursor-windsurf-and-co-fork-vs-code-shouldnt
- Theia FAQ: https://theia-ide.org/docs/faq/ ; Theia in production (Mar 2026): https://newsroom.eclipse.org/eclipse-newsletter/2026/march/eclipse-theia-eclipse-foundation-tool-platform-production
- Void (deprecated): https://github.com/voideditor/void
- Zed licensing: https://zed.dev/blog/zed-is-now-open-source ; Ollama edit predictions PR: https://github.com/zed-industries/zed/pull/33616
- Microsoft Marketplace terms for forks: https://github.com/microsoft/vscode/issues/31168
- Open VSX FAQ: https://www.eclipse.org/legal/open-vsx-registry-faq/ ; Cursor extensions: https://cursor.com/help/customization/extensions
- Fork "recommended extension" attack: https://www.bleepingcomputer.com/news/security/vscode-ide-forks-expose-users-to-recommended-extension-attacks/
- IntelliJ keybindings for VS Code (MIT): https://github.com/kasecato/vscode-intellij-idea-keybindings ; IntelliJ New UI theme: https://marketplace.visualstudio.com/items?itemName=compassak.intellij-idea-new-ui
- OpenRouter pricing: https://openrouter.ai/pricing ; Vercel AI Gateway pricing: https://vercel.com/docs/ai-gateway/pricing ; gateway comparison: https://flatkey.ai/blog/ai-gateway-pricing ; https://llmversus.com/blog/llm-gateway-comparison-2026
