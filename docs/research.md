# Ingot — research and architecture decision (Oct 2026)

Prices and facts were checked on 24 Oct 2026 from the sources listed at the end. Re-verify before any commercial decision.

## 1. How AI editors are built today

| Approach | Base | License of reusable code | Notes |
| --- | --- | --- | --- |
| Closed-source editor forks | Forks of the open-source Code-OSS editor | Closed | Use Open VSX through their own proxies with malware scanning; must rebase on upstream constantly. Jan 2026 research (Koi) showed forks inherit "recommended extensions" that don't exist on Open VSX, so attackers could claim the namespaces. |
| Open-source editor forks | Code-OSS forks | Open source | The best-known open fork is deprecated, but still a useful public reference: React mounted inside the workbench, own provider layer with FIM autocomplete, streaming diff edits, CI for packaging/signing/auto-update. |
| Native editors | Rust, GPU-rendered UI | GPL-3.0 / AGPL with Apache-2.0 parts | Fastest, own WASM extension system. Copyleft blocks an Apache-2.0 product built on top. |
| **Eclipse Theia** | Independent framework (not a fork) reusing Monaco and the extension API | EPL-2.0 (with GPL secondary licence) | Built to make branded IDE products (Arduino IDE 2, many enterprise tools). Desktop (Electron) and browser from one codebase. **Theia AI**: LLM providers, prompts, agents, MCP, Agent Skills, fully customizable chat. Open VSX integration built in. |
| JVM IDE platforms | JVM/Swing | Apache-2.0 for community editions | Mature UX, but a Java/Kotlin stack, heavy, and key JS features are proprietary. Not a fit for a TS team shipping fast. |

## 2. Options for Ingot

| Option | Pros | Cons |
| --- | --- | --- |
| A. Fork Code-OSS | Full extension compatibility; fastest path to a working editor. | Workbench layout is hard to reshape into Ingot's own UI. Monthly rebase pain. The proprietary marketplace is off-limits anyway. You inherit the editor's look, which is what we want to move away from. |
| **B. Build on Eclipse Theia (chosen)** | Not a fork, no rebasing: depend on npm packages. Every UI part is replaceable via dependency injection, so Ingot's own shell (tool window stripes, main toolbar, Search Everywhere) is a supported customization. Runs extensions from Open VSX. Theia AI already has agents, MCP, prompt templates, skills, custom chat. Desktop + browser. Vendor-neutral governance (Eclipse Foundation). | Slightly behind in extension API coverage (most popular extensions work; check per extension). Smaller community. EPL-2.0 is weak copyleft per file: modifications to Theia files must stay EPL, our own files can be Apache-2.0. |
| C. Fork a native editor | Best performance. | GPL/AGPL; Rust; no Open VSX extensions; much slower for us to build the UI. |
| D. JVM IDE platform | Mature IDE features. | JVM stack, heavy, licensing of JS support, different plugin model. |

### Decision

**Option B: Eclipse Theia** for 0.1.0, with these building blocks:

- **Shell:** custom Theia frontend extensions for Ingot's layout (see `docs/design/ide-reference.png`) — main toolbar (project / VCS / run widgets), thin tool window stripes, status bar widgets, Welcome screen. Our own React components styled with Ingot tokens.
- **Editor:** Monaco (Theia's default) + LSP via Open VSX extensions (TypeScript, ESLint, Prettier) and built-in Theia language support.
- **Keymap:** the Ingot keymap is the default (see `docs/keymap.md`): Search Everywhere on double Shift, Find Action, tool window shortcuts. "Alternative" keeps Theia's platform defaults.
- **Search Everywhere & Find in Files:** Theia quick-input framework + ripgrep backend.
- **Look:** Ingot Light / Dark / System themes (our tokens), our own icon set.
- **Extensions:** Open VSX as the default registry. Later: our own curated proxy with malware scanning and a blocklist.
- **AI:** Theia AI as the harness (providers, agents, MCP, prompt templates), with our own UI: agent tool window, `/` command menu fed by `.ingot` rules/skills/commands (plus existing rule folders), `@` context, multiple chats/agents, per-hunk diff review.
- **Autocomplete:** Monaco inline completions (ghost text). Backend: FIM-capable models — local Ollama (`qwen2.5-coder` 1.5B/7B, Apache-2.0), hosted Codestral (check Mistral licence for production) or Qwen coder via Fireworks/Together/our gateway. Context = prefix/suffix + open tabs + recent edits + tree-sitter symbols. Later: next-edit prediction.
- **Desktop packaging:** Theia's Electron app with electron-builder; signing/notarization and auto-update later (IDEA-49).
- **Testing:** Playwright click-through e2e in CI (IDEA-38).

Fallback: if Theia's extension compatibility blocks a must-have extension, evaluate a Code-OSS fork. Keep UI code in our own packages so it is portable.

## 3. Model backend: one API for all models (question #4)

| Gateway | What it is | Cost (Oct 2026) | Pros | Cons |
| --- | --- | --- | --- | --- |
| **OpenRouter** | Hosted aggregator, 500+ models, 80+ providers, OpenAI-compatible | Provider list price + 5.5% fee on credit purchases (Standard), 8% Business; BYOK free up to $25k/month list-price inference then 5% | Zero ops, every model on day one (Claude, GPT, Gemini, DeepSeek, Llama, Qwen, Mistral...), fallbacks/auto-routing | Fee eats margin at scale; data passes a third party; limited per-user controls |
| **LiteLLM (self-hosted proxy)** | Open-source proxy (MIT), 100+ providers, OpenAI- and Anthropic-compatible endpoints | Free; pay server + Postgres/Redis + your time; Enterprise via sales | No markup, data stays with us, virtual keys per user, budgets, rate limits, fallbacks, spend tracking -> perfect for the portal dashboard | We run and scale it; must keep it updated |
| Portkey | Managed (and open-source) gateway + observability | Free 10k logs/month; Production $49/mo incl. 100k logs | Routing + logs + prompt management in one | BYOK only, another vendor, log-based pricing |
| Vercel AI Gateway | Managed gateway on Vercel | Zero token markup, $5/month free credit, pay-as-you-go credits | Zero markup, easy if hosted on Vercel | Fewer per-user controls; not self-hostable; best inside Vercel apps |
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

Public prices seen Oct 2026: Copilot Pro $10/mo, Pro+ $39, Business $19/user; Zed Pro $10/mo incl. $5 tokens, Business $30/seat. Other AI editors' plans to be refreshed from their pricing pages when we draft ours. Our pitch: free forever with BYOK + local models; paid plans charge model usage near cost with a small transparent margin.

## 5. Naming

Checked GitHub (`yaghobieh/<name>` free) and web for existing IDEs/editors:

| Candidate | Result |
| --- | --- |
| **Ingot** (chosen) | No IDE or editor by that name found; only small unrelated crates. Short, brandable, fits the metal theme (`.ingot` config folder). Formal trademark search still recommended before launch. |
| Ferro | A small hobby Rust terminal editor `ferro` exists on crates.io — some confusion risk. |
| Quench | Quench.ai exists (AI search API, not an IDE) — some confusion risk. |
| Rejected | Lathe (Zed fork), Kerf (web editor), Tenon (AI IDE), Anneal (AI editor project), Kiln (repo already exists under yaghobieh), Anvil/Foundry/Crucible (existing products). |

## Sources

- Theia FAQ: https://theia-ide.org/docs/faq/ ; Theia in production (Mar 2026): https://newsroom.eclipse.org/eclipse-newsletter/2026/march/eclipse-theia-eclipse-foundation-tool-platform-production
- Open VSX FAQ: https://www.eclipse.org/legal/open-vsx-registry-faq/
- Editor-fork "recommended extension" attack (Jan 2026 report): https://www.bleepingcomputer.com/news/security/
- OpenRouter pricing: https://openrouter.ai/pricing ; Vercel AI Gateway pricing: https://vercel.com/docs/ai-gateway/pricing ; gateway comparison: https://flatkey.ai/blog/ai-gateway-pricing ; https://llmversus.com/blog/llm-gateway-comparison-2026
