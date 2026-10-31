import type { JsonNode, JsonParse, JsonParseError, JsonProperty, TextRange } from './rules-engine.types';

const WHITESPACE = /\s/;
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const LITERALS: readonly (readonly [string, boolean | null])[] = [['true', true], ['false', false], ['null', null]];

class Parser {
    pos = 0;
    readonly errors: JsonParseError[] = [];

    constructor(readonly text: string) { }

    error(message: string, offset = this.pos, length = 1): void {
        this.errors.push({ message, offset, length });
    }

    skip(): void {
        for (;;) {
            while (this.pos < this.text.length && WHITESPACE.test(this.text[this.pos])) {
                this.pos++;
            }
            if (this.text.startsWith('//', this.pos)) {
                const end = this.text.indexOf('\n', this.pos);
                this.pos = end < 0 ? this.text.length : end;
            } else if (this.text.startsWith('/*', this.pos)) {
                const end = this.text.indexOf('*/', this.pos + 2);
                this.pos = end < 0 ? this.text.length : end + 2;
            } else {
                return;
            }
        }
    }

    string(): { value: string; offset: number; length: number } {
        const offset = this.pos;
        let value = '';
        this.pos++;
        while (this.pos < this.text.length && this.text[this.pos] !== '"') {
            const c = this.text[this.pos];
            if (c === '\n') {
                break;
            }
            if (c === '\\') {
                const next = this.text[this.pos + 1];
                const escapes: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
                if (next === 'u') {
                    value += String.fromCharCode(parseInt(this.text.slice(this.pos + 2, this.pos + 6), 16));
                    this.pos += 6;
                    continue;
                }
                value += escapes[next] ?? next;
                this.pos += 2;
                continue;
            }
            value += c;
            this.pos++;
        }
        if (this.text[this.pos] !== '"') {
            this.error('Unterminated string.', offset, this.pos - offset);
        } else {
            this.pos++;
        }
        return { value, offset, length: this.pos - offset };
    }

    value(): JsonNode | undefined {
        this.skip();
        const c = this.text[this.pos];
        const offset = this.pos;
        if (c === '{') {
            return this.object();
        }
        if (c === '[') {
            return this.array();
        }
        if (c === '"') {
            const s = this.string();
            return { type: 'string', offset, length: s.length, value: s.value };
        }
        const number = NUMBER.exec(this.text.slice(this.pos));
        if (number) {
            this.pos += number[0].length;
            return { type: 'number', offset, length: number[0].length, value: Number(number[0]) };
        }
        for (const [word, literal] of LITERALS) {
            if (this.text.startsWith(word, this.pos)) {
                this.pos += word.length;
                return { type: literal === null ? 'null' : 'boolean', offset, length: word.length, value: literal };
            }
        }
        this.error(this.pos >= this.text.length ? 'Unexpected end of file.' : `Unexpected "${c}".`);
        return undefined;
    }

    object(): JsonNode {
        const offset = this.pos;
        const properties: JsonProperty[] = [];
        this.pos++;
        for (;;) {
            this.skip();
            if (this.text[this.pos] === '}') {
                this.pos++;
                break;
            }
            if (this.text[this.pos] !== '"') {
                this.error(this.pos >= this.text.length ? 'Missing "}".' : 'Expected a property name in double quotes.');
                this.recover('}');
                break;
            }
            const key = this.string();
            this.skip();
            if (this.text[this.pos] !== ':') {
                this.error('Expected ":" after the property name.');
                properties.push({ key: key.value, keyOffset: key.offset, keyLength: key.length });
                this.recover('}');
                break;
            }
            this.pos++;
            const value = this.value();
            properties.push({ key: key.value, keyOffset: key.offset, keyLength: key.length, ...(value ? { value } : {}) });
            if (!value) {
                this.recover('}');
                break;
            }
            this.skip();
            if (this.text[this.pos] === ',') {
                this.pos++;
            } else if (this.text[this.pos] !== '}') {
                this.error('Expected "," or "}".');
                this.recover('}');
                break;
            }
        }
        return { type: 'object', offset, length: this.pos - offset, properties };
    }

    array(): JsonNode {
        const offset = this.pos;
        const items: JsonNode[] = [];
        this.pos++;
        for (;;) {
            this.skip();
            if (this.text[this.pos] === ']') {
                this.pos++;
                break;
            }
            const value = this.value();
            if (!value) {
                this.recover(']');
                break;
            }
            items.push(value);
            this.skip();
            if (this.text[this.pos] === ',') {
                this.pos++;
            } else if (this.text[this.pos] !== ']') {
                this.error('Expected "," or "]".');
                this.recover(']');
                break;
            }
        }
        return { type: 'array', offset, length: this.pos - offset, items };
    }

    /** Skips to the closing bracket so the rest of the file still parses. */
    recover(close: string): void {
        const end = this.text.indexOf(close, this.pos);
        this.pos = end < 0 ? this.text.length : end + 1;
    }
}

/** JSON (with comments and trailing commas, as editors allow) into a tree that keeps every offset. */
export const parseJsonTree = (text: string): JsonParse => {
    const parser = new Parser(text);
    parser.skip();
    if (parser.pos >= text.length) {
        return { errors: [] };
    }
    const root = parser.value();
    parser.skip();
    if (root && parser.pos < text.length) {
        parser.error('Unexpected text after the end of the JSON value.');
    }
    return { ...(root ? { root } : {}), errors: parser.errors };
};

/** Plain value of a node (objects and arrays included). */
export const nodeValue = (node: JsonNode | undefined): unknown => {
    if (!node) {
        return undefined;
    }
    if (node.type === 'object') {
        return Object.fromEntries((node.properties ?? []).map(p => [p.key, nodeValue(p.value)]));
    }
    if (node.type === 'array') {
        return (node.items ?? []).map(nodeValue);
    }
    return node.value;
};

/** Offsets → zero-based line and column ranges. */
export const offsetRange = (text: string, offset: number, length: number): TextRange => {
    const at = (o: number): { line: number; column: number } => {
        const before = text.slice(0, o);
        const line = before.split('\n').length - 1;
        return { line, column: o - (before.lastIndexOf('\n') + 1) };
    };
    const start = at(offset);
    const end = at(offset + Math.max(length, 0));
    return { line: start.line, column: start.column, endLine: end.line, endColumn: end.column };
};

/** Line + column → offset (for completions). */
export const offsetAt = (text: string, line: number, column: number): number => {
    const lines = text.split('\n');
    return lines.slice(0, line).reduce((sum, l) => sum + l.length + 1, 0) + column;
};

/** The key path to the node at `offset` and whether the cursor sits where a property name goes. */
export const locationAt = (root: JsonNode | undefined, offset: number): { path: string[]; inKey: boolean; node?: JsonNode } => {
    const path: string[] = [];
    let node = root;
    let inKey = false;
    while (node) {
        if (node.type === 'object') {
            const property = (node.properties ?? []).find(p => p.value
                ? offset >= p.keyOffset && offset <= p.value.offset + p.value.length
                : offset >= p.keyOffset && offset <= p.keyOffset + p.keyLength);
            if (!property) {
                inKey = offset > node.offset && offset < node.offset + node.length;
                return { path, inKey, node };
            }
            if (offset <= property.keyOffset + property.keyLength) {
                return { path, inKey: true, node };
            }
            path.push(property.key);
            if (!property.value || offset < property.value.offset) {
                return { path, inKey: false, ...(property.value ? { node: property.value } : {}) };
            }
            node = property.value;
        } else if (node.type === 'array') {
            const index = (node.items ?? []).findIndex(i => offset >= i.offset && offset <= i.offset + i.length);
            if (index < 0) {
                return { path, inKey, node };
            }
            path.push(String(index));
            node = node.items![index];
        } else {
            return { path, inKey, node };
        }
    }
    return { path, inKey };
};
