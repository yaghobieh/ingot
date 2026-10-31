import { parseFrontmatterBlock } from '../rules-engine/frontmatter.utils';
import { filesMatching, globSyntaxError } from '../rules-engine/glob.utils';
import { locationAt, parseJsonTree } from '../rules-engine/json-tree.utils';
import { schemaAt } from '../rules-engine/schema-validate.utils';
import type { FrontmatterItem, IngotFileSchema, JsonSchema, JsonType, TextRange } from '../rules-engine/rules-engine.types';
import { GLOB_SUGGESTION_LIMIT } from './rules-insight.consts';
import type { GlobAtPosition, SchemaSuggestion } from './rules-insight.types';

const FENCE = '---';
const NO_RANGE: TextRange = { line: 0, column: 0, endLine: 0, endColumn: 0 };

const typesOf = (schema: JsonSchema | undefined): readonly JsonType[] => {
    if (!schema) {
        return [];
    }
    const own = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type as readonly JsonType[] : [schema.type as JsonType];
    return [...own, ...(schema.anyOf ?? []).flatMap(typesOf)];
};

/** True when the value (or its list items) is a glob. */
export const isGlobSchema = (schema: JsonSchema | undefined): boolean =>
    !!schema && (schema.format === 'glob' || isGlobSchema(schema.items) || (schema.anyOf ?? []).some(isGlobSchema));

/** Values worth offering for a key: enum members, booleans, the default. */
export const valueSuggestions = (schema: JsonSchema | undefined): string[] => {
    if (!schema) {
        return [];
    }
    const values = new Set<string>();
    (schema.enum ?? []).forEach(v => values.add(String(v)));
    (schema.anyOf ?? []).forEach(s => (s.enum ?? []).forEach(v => values.add(String(v))));
    if (typesOf(schema).includes('boolean')) {
        values.add('true');
        values.add('false');
    }
    if (schema.default !== undefined && typeof schema.default !== 'object') {
        values.add(String(schema.default));
    }
    return [...values];
};

/** Globs drawn from the project: the most common extensions and the top-level folders. */
export const globSuggestions = (files: readonly string[]): string[] => {
    const extensions = new Map<string, number>();
    const folders = new Map<string, number>();
    for (const file of files.filter(f => !f.startsWith('.'))) {
        const slash = file.indexOf('/');
        if (slash > 0) {
            const folder = file.slice(0, slash);
            folders.set(folder, (folders.get(folder) ?? 0) + 1);
        }
        const dot = file.lastIndexOf('.');
        if (dot > file.lastIndexOf('/') + 1) {
            const ext = file.slice(dot + 1);
            extensions.set(ext, (extensions.get(ext) ?? 0) + 1);
        }
    }
    const top = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
    return [...top(extensions).map(e => `**/*.${e}`), ...top(folders).map(f => `${f}/**`)].slice(0, GLOB_SUGGESTION_LIMIT);
};

const keySuggestion = (key: string, schema: JsonSchema): SchemaSuggestion => ({
    label: key, kind: 'key', detail: typesOf(schema).join(' | ') || undefined, documentation: schema.description, values: valueSuggestions(schema)
});

const lines = (text: string): string[] => text.split(/\r?\n/);

/** Where the cursor sits in a frontmatter file: outside the block, on a key, or after `key:`. */
const frontmatterSpot = (text: string, line: number): 'none' | 'template' | 'inside' => {
    const all = lines(text);
    if (!text.trim() || (line === 0 && !all[0].trim())) {
        return 'template';
    }
    if (all[0].trim() !== FENCE || line === 0) {
        return 'none';
    }
    const close = all.findIndex((l, i) => i > 0 && l.trim() === FENCE);
    return close < 0 || line < close ? 'inside' : 'none';
};

/** Completions in a frontmatter file (rules, commands, skills, subagents, habits) at a zero-based position. */
export const frontmatterCompletions = (text: string, line: number, column: number, file: IngotFileSchema, files: readonly string[] = []): SchemaSuggestion[] => {
    const spot = frontmatterSpot(text, line);
    if (spot === 'template') {
        return [{ label: `${file.title} frontmatter`, kind: 'template', insertText: file.template, documentation: file.schema.description }];
    }
    if (spot === 'none') {
        return [];
    }
    const before = lines(text)[line].slice(0, column);
    const parsed = parseFrontmatterBlock(text);
    const properties = file.schema.properties ?? {};
    const keyMatch = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(before);
    const listItem = /^\s*-\s*\S*$/.test(before);
    if (keyMatch || listItem) {
        const key = keyMatch ? keyMatch[1] : [...parsed.entries].reverse().find(e => e.keyRange.line < line)?.key;
        const schema = key ? properties[key] : undefined;
        const values = isGlobSchema(schema) ? globSuggestions(files) : valueSuggestions(schema);
        return values.map(v => ({ label: v, kind: isGlobSchema(schema) ? 'glob' : 'value', insertText: isGlobSchema(schema) && keyMatch && !keyMatch[2].startsWith('"') ? `"${v}"` : v }));
    }
    if (/^\s/.test(before)) {
        return [];
    }
    const present = new Set(parsed.entries.filter(e => e.keyRange.line !== line).map(e => e.key));
    return Object.entries(properties).filter(([k]) => !present.has(k)).map(([k, s]) => keySuggestion(k, s));
};

/** Completions in a JSON `.ingot` file at a character offset. */
export const jsonCompletions = (text: string, offset: number, file: IngotFileSchema): SchemaSuggestion[] => {
    if (!text.trim()) {
        return [{ label: `${file.title} file`, kind: 'template', insertText: file.template, documentation: file.schema.description }];
    }
    const { root } = parseJsonTree(text);
    const location = locationAt(root, offset);
    const node = location.node;
    if (location.inKey || (node?.type === 'object' && !isValueSpot(text, offset))) {
        const schema = schemaAt(file.schema, location.path);
        const container = node?.type === 'object' ? node : undefined;
        const present = new Set((container?.properties ?? []).filter(p => !(offset >= p.keyOffset && offset <= p.keyOffset + p.keyLength)).map(p => p.key));
        return Object.entries(schema?.properties ?? {}).filter(([k]) => !present.has(k)).map(([k, s]) => keySuggestion(k, s));
    }
    const schema = schemaAt(file.schema, location.path);
    return valueSuggestions(schema).map(v => ({ label: v, kind: 'value', insertText: typesOf(schema).includes('string') && schema?.enum?.includes(v) ? `"${v}"` : v }));
};

/** True when the text right before the offset ends with `"key":` (a value goes here). */
const isValueSpot = (text: string, offset: number): boolean => /:\s*"?[^",{}[\]]*$/.test(text.slice(Math.max(0, offset - 200), offset).split('\n').pop() ?? '');

/** The glob list item under the cursor in a rule or habit frontmatter, with the project files it matches. */
export const globAt = (text: string, line: number, column: number, scope: string, files: readonly string[]): GlobAtPosition | undefined => {
    const parsed = parseFrontmatterBlock(text);
    const entry = parsed.entries.find(e => e.key === 'globs');
    const item = entry?.items.find(i => i.range.line === line && column >= i.range.column && column <= i.range.endColumn);
    return item ? globPreview(item.value, scope, files, item.range) : undefined;
};

/** The project files a glob matches (relative to a nested rule's folder when `scope` is set). */
export const globPreview = (glob: string, scope: string, files: readonly string[], range: TextRange = NO_RANGE): GlobAtPosition => {
    const error = globSyntaxError(glob);
    return { glob, range, matches: error ? [] : filesMatching(glob, files, scope), ...(error ? { error } : {}) };
};

/** Every `globs` item of a frontmatter file, previewed (inlay hints). */
export const globPreviews = (text: string, scope: string, files: readonly string[]): GlobAtPosition[] => {
    const entry = parseFrontmatterBlock(text).entries.find(e => e.key === 'globs');
    return (entry?.items ?? []).filter((i: FrontmatterItem) => i.value).map(i => globPreview(i.value, scope, files, i.range));
};
