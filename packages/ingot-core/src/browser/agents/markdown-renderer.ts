import * as markdownit from '@theia/core/shared/markdown-it';
import * as monaco from '@theia/monaco-editor-core';
import { CODE_LANGUAGE_ALIASES, COPY_LABEL } from './markdown.consts';
import { BADGE_PATTERN, flowSteps, normalizeReply } from '../../common/agents/reply-format';

/** The CommonJS export is the factory itself at runtime; typings model it as `default`. */
const createMarkdown = ((markdownit as unknown as { default?: unknown }).default ?? markdownit) as typeof markdownit.default;

type MdTokens = ReturnType<ReturnType<typeof createMarkdown>['parse']>;

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Markdown for agent replies (IDEA-100): headings, emphasis, inline code, fenced code with highlighting and a Copy
 * button, lists, tables, block quotes and links. Raw HTML in replies is never rendered.
 */
export class AgentMarkdownRenderer {

    protected readonly md = createMarkdown({ html: false, linkify: true, breaks: false, typographer: false });
    protected readonly highlighted = new Map<string, string>();
    protected readonly pending = new Set<string>();
    protected readonly cache = new Map<string, string>();

    constructor(protected readonly onHighlighted: () => void) {
        const md = this.md;
        md.renderer.rules.fence = (tokens, idx) => {
            const token = tokens[idx];
            const lang = token.info.trim().split(/\s+/)[0] ?? '';
            const code = token.content.replace(/\n$/, '');
            const body = this.highlight(code, lang) ?? escapeHtml(code);
            return `<div class="ingot-md-code"><div class="ingot-md-code-head"><span class="ingot-md-code-lang">${escapeHtml(lang)}</span>`
                + `<button type="button" class="ingot-md-copy" data-md-copy="1" aria-label="Copy code"><span class="codicon codicon-copy"></span>${COPY_LABEL}</button></div>`
                + `<pre><code class="language-${escapeHtml(lang)}">${body}</code></pre></div>`;
        };
        const codeInline = md.renderer.rules.code_inline!;
        md.renderer.rules.code_inline = (tokens, idx, options, env, self) => tokens[idx].meta?.badge
            ? `<span class="ingot-md-badge ingot-md-badge-${escapeHtml(tokens[idx].content.toLowerCase())}">${escapeHtml(tokens[idx].content)}</span>`
            : codeInline(tokens, idx, options, env, self);
        md.renderer.rules.table_open = () => '<div class="ingot-md-table"><table>';
        md.renderer.rules.table_close = () => '</table></div>';
        const linkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
        md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
            tokens[idx].attrSet('data-md-link', '1');
            return linkOpen(tokens, idx, options, env, self);
        };
    }

    /** HTML for a (possibly still streaming) reply. Finished replies are cached. */
    render(text: string): string {
        const cached = this.cache.get(text);
        if (cached) {
            return cached;
        }
        const env = {};
        const tokens = this.structure(this.md.parse(normalizeReply(text), env));
        const html = this.md.renderer.render(tokens, this.md.options, env);
        if (this.cache.size > 200) {
            this.cache.clear();
        }
        this.cache.set(text, html);
        return html;
    }

    /** IDEA-104: a one-line "A → B → C" paragraph becomes step chips; short upper-case codes in tables become badges. */
    protected structure(tokens: MdTokens): MdTokens {
        const out: typeof tokens = [];
        let inCell = false;
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (token.type === 'td_open' || token.type === 'th_open') {
                inCell = true;
            } else if (token.type === 'td_close' || token.type === 'th_close') {
                inCell = false;
            }
            if (token.type === 'inline' && inCell) {
                for (const child of token.children ?? []) {
                    if (child.type === 'code_inline' && BADGE_PATTERN.test(child.content)) {
                        child.meta = { ...child.meta, badge: true };
                    }
                }
            }
            const steps = token.type === 'paragraph_open' && !token.hidden && tokens[i + 1]?.type === 'inline' && tokens[i + 2]?.type === 'paragraph_close'
                ? flowSteps(tokens[i + 1].content) : undefined;
            if (steps) {
                const Token = token.constructor as new (type: string, tag: string, nesting: number) => typeof token;
                const flow = new Token('html_block', '', 0);
                flow.content = `<div class="ingot-md-flow">${steps.map((step, n) =>
                    `${n ? '<span class="ingot-md-flow-arrow codicon codicon-arrow-right"></span>' : ''}<span class="ingot-md-flow-step">${this.md.renderInline(step)}</span>`).join('')}</div>`;
                out.push(flow);
                i += 2;
                continue;
            }
            out.push(token);
        }
        return out;
    }

    protected highlight(code: string, lang: string): string | undefined {
        const language = CODE_LANGUAGE_ALIASES[lang.toLowerCase()] ?? lang.toLowerCase();
        if (!language) {
            return undefined;
        }
        const key = `${language}\u0000${code}`;
        const done = this.highlighted.get(key);
        if (done !== undefined) {
            return done;
        }
        if (!this.pending.has(key) && monaco.languages.getLanguages().some(l => l.id === language)) {
            this.pending.add(key);
            monaco.editor.colorize(code, language, { tabSize: 4 }).then(html => {
                this.highlighted.set(key, html.replace(/<br\/?>/g, '\n'));
                this.cache.clear();
                this.onHighlighted();
            }, () => undefined).finally(() => this.pending.delete(key));
        }
        return undefined;
    }
}
