import { describe, expect, it } from 'vitest';
import { locationAt, nodeValue, offsetAt, offsetRange, parseJsonTree } from './json-tree.utils';

describe('parseJsonTree', () => {
    it('parses JSON with comments and trailing commas, keeping offsets', () => {
        const text = '{\n  // servers\n  "mcpServers": { "db": { "command": "npx", "args": ["-y", 1,], }, },\n}';
        const { root, errors } = parseJsonTree(text);
        expect(errors).toEqual([]);
        expect(nodeValue(root)).toEqual({ mcpServers: { db: { command: 'npx', args: ['-y', 1] } } });
        const db = root!.properties![0].value!.properties![0];
        expect(text.slice(db.keyOffset, db.keyOffset + db.keyLength)).toBe('"db"');
    });

    it('reports errors with offsets and still returns what it could read', () => {
        const { root, errors } = parseJsonTree('{ "a": 1 "b": 2 }');
        expect(errors[0].message).toBe('Expected "," or "}".');
        expect(nodeValue(root)).toEqual({ a: 1 });
        expect(parseJsonTree('{ "a": tru }').errors[0].message).toBe('Unexpected "t".');
        expect(parseJsonTree('').root).toBeUndefined();
    });

    it('maps offsets to lines and columns and back', () => {
        const text = 'ab\ncde\nf';
        expect(offsetRange(text, 4, 2)).toEqual({ line: 1, column: 1, endLine: 1, endColumn: 3 });
        expect(offsetAt(text, 2, 0)).toBe(7);
    });

    it('finds the key path at a cursor position', () => {
        const text = '{ "mcpServers": { "db": { "command": "npx",  } } }';
        const { root } = parseJsonTree(text);
        expect(locationAt(root, text.indexOf('npx') + 1)).toMatchObject({ path: ['mcpServers', 'db', 'command'], inKey: false });
        expect(locationAt(root, text.indexOf(',') + 2)).toMatchObject({ path: ['mcpServers', 'db'], inKey: true });
        expect(locationAt(root, text.indexOf('"db"') + 1)).toMatchObject({ path: ['mcpServers'], inKey: true });
    });
});
