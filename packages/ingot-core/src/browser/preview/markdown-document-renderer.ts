import * as markdownit from '@theia/core/shared/markdown-it';
import * as DOMPurify from '@theia/core/shared/dompurify';
import * as monaco from '@theia/monaco-editor-core';
import { CODE_LANGUAGE_ALIASES } from '../agents/markdown.consts';
import { isWorkspaceTarget } from '../../common/preview/document-preview.utils';

/** The CommonJS export is the factory itself at runtime; typings model it as `default`. */
const createMarkdown = ((markdownit as unknown as { default?: unknown }).default ?? markdownit) as typeof markdownit.default;

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Element ids from the document are prefixed so a README can never clash with ids the IDE uses. */
export const DOC_ID_PREFIX = 'ingot-md-';
/** Tags that could restyle or take over the whole window, or submit anything. */
const FORBIDDEN_TAGS = ['style', 'link', 'meta', 'base', 'iframe', 'frame', 'frameset', 'form', 'input', 'button', 'select', 'textarea', 'object', 'embed', 'script'];

const slugify = (text: string): string => text.trim().toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');

/**
 * IDEA-146: Markdown files for the document preview - GitHub-style blocks, raw HTML (sanitized), tables, task lists,
 * syntax-highlighted code, mermaid diagrams (rendered later by the widget) and `data-line` anchors for scroll sync.
 */
export class MarkdownDocumentRenderer {

    protected readonly md = createMarkdown({ html: true, linkify: true, breaks: false, typographer: false });
    protected readonly highlighted = new Map<string, string>();
    protected readonly pending = new Set<string>();

    constructor(protected readonly onHighlighted: () => void) {
        const md = this.md;
        md.core.ruler.push('ingot_source_lines', state => {
            for (const token of state.tokens) {
                if (token.map && token.nesting >= 0 && token.type !== 'inline') {
                    token.attrSet('data-line', String(token.map[0]));
                }
            }
            return true;
        });
        md.renderer.rules.fence = (tokens, idx) => {
            const token = tokens[idx];
            const lang = token.info.trim().split(/\s+/)[0] ?? '';
            const line = token.attrGet('data-line') ?? '';
            const code = token.content.replace(/\n$/, '');
            if (lang.toLowerCase() === 'mermaid') {
                return `<div class="ingot-mdp-mermaid" data-line="${line}" data-source="${escapeHtml(code)}"><pre>${escapeHtml(code)}</pre></div>`;
            }
            const body = this.highlight(code, lang) ?? escapeHtml(code);
            const label = lang ? `<span class="ingot-mdp-code-lang">${escapeHtml(lang)}</span>` : '';
            return `<div class="ingot-mdp-code" data-line="${line}">${label}<pre><code class="language-${escapeHtml(lang)}">${body}</code></pre></div>`;
        };
        md.renderer.rules.heading_open = (tokens, idx, options, env: { slugs?: Map<string, number> }, self) => {
            const slugs = env.slugs ??= new Map<string, number>();
            const base = slugify(tokens[idx + 1]?.content ?? '') || 'section';
            const count = slugs.get(base) ?? 0;
            slugs.set(base, count + 1);
            tokens[idx].attrSet('id', count ? `${base}-${count}` : base);
            return self.renderToken(tokens, idx, options);
        };
        md.renderer.rules.table_open = (tokens, idx, options, _env, self) => `<div class="ingot-mdp-table">${self.renderToken(tokens, idx, options)}`;
        md.renderer.rules.table_close = (tokens, idx, options, _env, self) => `${self.renderToken(tokens, idx, options)}</div>`;
        // GitHub task lists: "- [ ] todo" and "- [x] done".
        md.core.ruler.push('ingot_task_lists', state => {
            for (const token of state.tokens) {
                if (token.type === 'inline' && /^\[[ xX]\]\s/.test(token.content) && token.children?.[0]?.type === 'text') {
                    const done = token.content[1] !== ' ';
                    token.children[0].content = token.children[0].content.slice(4);
                    const Token = token.constructor as new (type: string, tag: string, nesting: number) => typeof token;
                    const box = new Token('html_inline', '', 0);
                    box.content = `<span class="ingot-mdp-task codicon ${done ? 'codicon-pass-filled done' : 'codicon-circle-large'}"></span>`;
                    token.children.unshift(box);
                }
            }
            return true;
        });
    }

    /**
     * Sanitized nodes for a document. Workspace images keep their target in `data-ingot-src` (the widget loads them
     * from the file system), so nothing is fetched relative to the IDE's own address.
     */
    render(text: string): Node[] {
        const html = this.md.render(text, {});
        const body = DOMPurify.sanitize(html, { RETURN_DOM: true, FORBID_TAGS: FORBIDDEN_TAGS, ADD_ATTR: ['target'] }) as HTMLElement;
        for (const element of Array.from(body.querySelectorAll<HTMLElement>('[id], [name]'))) {
            for (const attr of ['id', 'name']) {
                const value = element.getAttribute(attr);
                if (value && attr === 'id') {
                    element.setAttribute('id', DOC_ID_PREFIX + value);
                } else if (value) {
                    element.removeAttribute(attr);
                }
            }
        }
        for (const img of Array.from(body.querySelectorAll('img'))) {
            const src = img.getAttribute('src') ?? '';
            if (isWorkspaceTarget(src)) {
                img.removeAttribute('src');
                img.dataset.ingotSrc = src;
            }
            img.loading = 'lazy';
        }
        return Array.from(body.childNodes).map(node => document.importNode(node, true));
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
                if (this.highlighted.size > 500) {
                    this.highlighted.clear();
                }
                this.highlighted.set(key, html.replace(/<br\/?>/g, '\n'));
                this.onHighlighted();
            }, () => undefined).finally(() => this.pending.delete(key));
        }
        return undefined;
    }
}
