import type { KitMap, KitScalar, KitValue } from './rules-kit.types';

/**
 * The YAML subset rule tests are written in: nested maps and `- ` lists by indentation, `- key: value` list items,
 * `|` / `>` block scalars, quoted strings, `[a, b]` lists, numbers, booleans, null and `#` comments.
 * Anchors, tags, multi-document files and multi-line plain scalars are not supported.
 */
export const parseYaml = (source: string): KitValue => {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    let at = 0;

    const indentOf = (line: string): number => line.length - line.trimStart().length;
    const isBlank = (line: string): boolean => !line.trim() || line.trim().startsWith('#');
    const isItem = (text: string): boolean => text === '-' || text.startsWith('- ');
    const nextContent = (): number => {
        let next = at;
        while (next < lines.length && isBlank(lines[next])) {
            next++;
        }
        return next;
    };
    const fail = (line: number, message: string): never => {
        throw new Error(`line ${line + 1}: ${message}`);
    };

    const stripComment = (value: string): string => {
        const text = value.trim();
        if (text.startsWith('"') || text.startsWith('\'')) {
            const quote = text[0];
            for (let i = 1; i < text.length; i++) {
                if (quote === '"' && text[i] === '\\') {
                    i++;
                } else if (text[i] === quote && quote === '\'' && text[i + 1] === '\'') {
                    i++;
                } else if (text[i] === quote) {
                    return text.slice(0, i + 1);
                }
            }
            return text;
        }
        const hash = text.search(/\s#/);
        return hash < 0 ? text : text.slice(0, hash).trim();
    };

    const scalar = (raw: string): KitScalar => {
        const text = raw.trim();
        if (text.startsWith('"') && text.endsWith('"') && text.length > 1) {
            return text.slice(1, -1).replace(/\\(["\\nt])/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
        }
        if (text.startsWith('\'') && text.endsWith('\'') && text.length > 1) {
            return text.slice(1, -1).replace(/''/g, '\'');
        }
        if (text === 'true' || text === 'false') {
            return text === 'true';
        }
        if (text === 'null' || text === '~' || text === '') {
            return null;
        }
        if (/^-?\d+(\.\d+)?$/.test(text)) {
            return Number(text);
        }
        return text;
    };

    const flowList = (text: string): KitScalar[] => {
        const items: string[] = [];
        let current = '';
        let quote = '';
        for (const c of text.slice(1, -1)) {
            if (quote) {
                quote = c === quote ? '' : quote;
                current += c;
            } else if (c === '"' || c === '\'') {
                quote = c;
                current += c;
            } else if (c === ',') {
                items.push(current);
                current = '';
            } else {
                current += c;
            }
        }
        items.push(current);
        return items.map(item => item.trim()).filter(Boolean).map(scalar);
    };

    /** Reads a `|` / `>` block after the current line: every following line indented deeper than `parent`. */
    const blockScalar = (style: string, parent: number): string => {
        const body: string[] = [];
        let blockIndent = -1;
        while (at < lines.length && (!lines[at].trim() || indentOf(lines[at]) > parent)) {
            if (blockIndent < 0 && lines[at].trim()) {
                blockIndent = indentOf(lines[at]);
            }
            body.push(lines[at]);
            at++;
        }
        while (body.length && !body[body.length - 1].trim()) {
            body.pop();
        }
        const text = body.map(line => line.slice(Math.max(blockIndent, 0)));
        let folded = '';
        let paragraphStart = true;
        for (const line of text) {
            folded += !line ? '\n' : `${paragraphStart ? '' : ' '}${line}`;
            paragraphStart = !line;
        }
        const joined = style.startsWith('>') ? folded : text.join('\n');
        return style.endsWith('-') ? joined : `${joined}\n`;
    };

    const inline = (raw: string, parent: number): KitValue => {
        const text = stripComment(raw);
        if (/^[|>][+-]?$/.test(text)) {
            return blockScalar(text, parent);
        }
        if (text === '[]') {
            return [];
        }
        if (text === '{}') {
            return {};
        }
        if (text.startsWith('[') && text.endsWith(']')) {
            return flowList(text);
        }
        return scalar(text);
    };

    const nested = (parent: number, allowSameIndentList: boolean): KitValue => {
        const next = nextContent();
        if (next >= lines.length) {
            return null;
        }
        const indent = indentOf(lines[next]);
        const text = lines[next].trim();
        if (indent > parent || (allowSameIndentList && indent === parent && isItem(text))) {
            at = next;
            return isItem(text) ? list(indent) : map(indent);
        }
        return null;
    };

    const map = (indent: number): KitMap => {
        const out: KitMap = {};
        for (let next = nextContent(); next < lines.length; next = nextContent()) {
            const line = lines[next];
            const text = line.trim();
            if (indentOf(line) !== indent || isItem(text)) {
                if (indentOf(line) > indent) {
                    fail(next, 'unexpected indentation');
                }
                break;
            }
            const pair = /^(.+?):(?:\s+(.*))?$/.exec(text);
            if (!pair) {
                fail(next, 'expected "key: value"');
            }
            const key = String(scalar(pair![1]));
            at = next + 1;
            const rest = pair![2] === undefined ? '' : stripComment(pair![2]);
            out[key] = rest ? inline(rest, indent) : nested(indent, true);
        }
        return out;
    };

    const list = (indent: number): KitValue[] => {
        const out: KitValue[] = [];
        for (let next = nextContent(); next < lines.length; next = nextContent()) {
            const line = lines[next];
            const text = line.trim();
            if (indentOf(line) !== indent || !isItem(text)) {
                break;
            }
            const rest = text.slice(1).trim();
            if (!rest) {
                at = next + 1;
                out.push(nested(indent, false));
            } else if (/^[^"'[{][^:]*:(\s|$)/.test(rest) || /^["'][^"']*["']:(\s|$)/.test(rest)) {
                const offset = indent + text.indexOf(rest);
                lines[next] = `${' '.repeat(offset)}${rest}`;
                at = next;
                out.push(map(offset));
            } else {
                at = next + 1;
                out.push(inline(rest, indent));
            }
        }
        return out;
    };

    const value = nested(-1, true);
    const rest = nextContent();
    if (rest < lines.length) {
        fail(rest, 'unexpected content');
    }
    return value;
};

export const isMap = (value: KitValue | undefined): value is KitMap => typeof value === 'object' && value !== null && !Array.isArray(value);
