import * as markdownit from '@theia/core/shared/markdown-it';
import * as monaco from '@theia/monaco-editor-core';
import { CODE_LANGUAGE_ALIASES, COPY_LABEL } from './markdown.consts';

/** The CommonJS export is the factory itself at runtime; typings model it as `default`. */
const createMarkdown = ((markdownit as unknown as { default?: unknown }).default ?? markdownit) as typeof markdownit.default;

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
        const html = this.md.render(text);
        if (this.cache.size > 200) {
            this.cache.clear();
        }
        this.cache.set(text, html);
        return html;
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
