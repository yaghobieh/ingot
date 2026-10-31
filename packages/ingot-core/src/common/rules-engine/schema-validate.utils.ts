import { asList, entryOf, parseFrontmatterBlock, range } from './frontmatter.utils';
import { globSyntaxError } from './glob.utils';
import { offsetRange, parseJsonTree } from './json-tree.utils';
import { INGOT_FILE_SCHEMAS } from './schemas.consts';
import type { FrontmatterEntry, IngotFileSchema, JsonLiteral, JsonNode, JsonSchema, JsonType, SchemaDiagnostic, Severity, TextRange } from './rules-engine.types';

const MAX_SUGGESTION_DISTANCE = 2;
const NUMERIC = /^-?\d+(?:\.\d+)?$/;

/** The schema for a `.ingot` file path, or undefined when Ingot does not validate it. */
export const schemaForPath = (path: string): IngotFileSchema | undefined => {
    const clean = path.replace(/\\/g, '/');
    return INGOT_FILE_SCHEMAS.find(s => s.pattern.test(clean));
};

export const schemaById = (id: string): IngotFileSchema | undefined => INGOT_FILE_SCHEMAS.find(s => s.id === id);

const typesOf = (schema: JsonSchema): readonly JsonType[] => schema.type === undefined ? [] : typeof schema.type === 'string' ? [schema.type] : schema.type;

const distance = (a: string, b: string): number => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const current = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
            previous = current;
        }
    }
    return row[b.length];
};

/** `alwaysAplly` → `alwaysApply`. */
export const suggestKey = (key: string, known: readonly string[]): string | undefined =>
    known.map(k => ({ k, d: distance(key, k) })).filter(x => x.d <= MAX_SUGGESTION_DISTANCE).sort((a, b) => a.d - b.d)[0]?.k;

const unknownKeyMessage = (key: string, known: readonly string[]): string => {
    const suggestion = suggestKey(key, known);
    return suggestion ? `Unknown key "${key}". Did you mean "${suggestion}"?` : `Unknown key "${key}". Known keys: ${known.join(', ')}.`;
};

const typeLabel = (types: readonly JsonType[]): string => types.map(t => t === 'array' ? 'a list' : t === 'object' ? 'an object' : t === 'boolean' ? 'true or false' : t === 'integer' ? 'a whole number' : t === 'null' ? 'null' : `a ${t}`).join(' or ');

/** Checks of a single string / number value shared by JSON and frontmatter. */
const checkScalar = (value: JsonLiteral | null, schema: JsonSchema): string | undefined => {
    if (schema.enum && !schema.enum.includes(value as JsonLiteral)) {
        return `Expected one of: ${schema.enum.map(v => JSON.stringify(v)).join(', ')}.`;
    }
    if (typeof value === 'string') {
        if (schema.minLength !== undefined && value.trim().length < schema.minLength) {
            return 'Must not be empty.';
        }
        if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
            return `Does not match the expected format (${schema.pattern}).`;
        }
        if (schema.format === 'glob') {
            return globSyntaxError(value);
        }
        if (schema.format === 'regex') {
            try {
                new RegExp(value);
            } catch (error) {
                return `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`;
            }
        }
    }
    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) {
            return `Must be at least ${schema.minimum}.`;
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
            return `Must be at most ${schema.maximum}.`;
        }
    }
    return undefined;
};

const jsonTypeOf = (node: JsonNode): JsonType => node.type === 'number' && Number.isInteger(node.value) ? 'integer' : node.type;

const typeMatches = (actual: JsonType, expected: readonly JsonType[]): boolean =>
    !expected.length || expected.includes(actual) || (actual === 'integer' && expected.includes('number'));

const requiredLabel = (schema: JsonSchema): string => (schema.required ?? []).map(k => `"${k}"`).join(' and ');

/** Validates a JSON `.ingot` file against its schema; parse errors come first. */
export const validateJson = (text: string, schema: JsonSchema): SchemaDiagnostic[] => {
    const parsed = parseJsonTree(text);
    const diagnostics: SchemaDiagnostic[] = parsed.errors.map(e => ({ severity: 'error', message: e.message, range: offsetRange(text, e.offset, e.length), path: '' }));
    if (!parsed.root) {
        return diagnostics;
    }
    const at = (node: { offset: number; length: number }): TextRange => offsetRange(text, node.offset, node.length);
    const push = (severity: Severity, message: string, where: TextRange, path: readonly string[]): void => {
        diagnostics.push({ severity, message, range: where, path: path.join('.') });
    };
    const walk = (node: JsonNode, s: JsonSchema, path: string[], keyRange: TextRange | undefined, out: (sev: Severity, msg: string, r: TextRange, p: readonly string[]) => void): void => {
        const expected = typesOf(s);
        const actual = jsonTypeOf(node);
        if (!typeMatches(actual, expected)) {
            out('error', `Expected ${typeLabel(expected)}.`, at(node), path);
            return;
        }
        if (node.type === 'object') {
            const properties = node.properties ?? [];
            for (const key of s.required ?? []) {
                if (!properties.some(p => p.key === key)) {
                    out('error', `Missing required property "${key}".`, keyRange ?? offsetRange(text, node.offset, 1), path);
                }
            }
            if (s.anyOf && !s.anyOf.some(option => (option.required ?? []).every(key => properties.some(p => p.key === key)))) {
                out('error', `Needs ${s.anyOf.map(requiredLabel).join(' or ')}.`, keyRange ?? offsetRange(text, node.offset, 1), path);
            }
            const known = Object.keys(s.properties ?? {});
            for (const property of properties) {
                const propertyRange = offsetRange(text, property.keyOffset, property.keyLength);
                const child = s.properties?.[property.key] ?? (typeof s.additionalProperties === 'object' ? s.additionalProperties : undefined);
                if (!child) {
                    if (s.additionalProperties === false) {
                        out('warning', unknownKeyMessage(property.key, known), propertyRange, [...path, property.key]);
                    }
                    continue;
                }
                if (property.value) {
                    walk(property.value, child, [...path, property.key], propertyRange, out);
                }
            }
            return;
        }
        if (node.type === 'array') {
            if (s.minItems !== undefined && (node.items ?? []).length < s.minItems) {
                out('error', `Needs at least ${s.minItems} item(s).`, at(node), path);
            }
            if (s.items) {
                (node.items ?? []).forEach((item, i) => walk(item, s.items!, [...path, String(i)], undefined, out));
            }
            return;
        }
        const problem = checkScalar(node.value ?? null, s);
        if (problem) {
            out('error', problem, at(node), path);
        }
    };
    walk(parsed.root, schema, [], undefined, push);
    return diagnostics;
};

const entryProblem = (entry: FrontmatterEntry, schema: JsonSchema): { message: string; range: TextRange } | undefined => {
    const expected = typesOf(schema);
    const value = entry.value;
    if (typeof value === 'boolean') {
        return expected.includes('boolean') ? undefined : { message: `Expected ${typeLabel(expected)}, not true/false.`, range: entry.valueRange };
    }
    if (expected.includes('boolean')) {
        return value === '' ? undefined : { message: 'Use true or false.', range: entry.valueRange };
    }
    if (Array.isArray(value)) {
        if (!expected.includes('array')) {
            return { message: `Expected ${typeLabel(expected)}, not a list.`, range: entry.valueRange };
        }
    } else if (typeof value === 'string' && (expected.includes('number') || expected.includes('integer')) && !expected.includes('string')) {
        if (!NUMERIC.test(value)) {
            return { message: `Expected ${typeLabel(expected)}.`, range: entry.valueRange };
        }
        const problem = checkScalar(Number(value), schema);
        return problem ? { message: problem, range: entry.valueRange } : undefined;
    }
    const isList = expected.includes('array');
    if (isList && schema.items) {
        for (const item of entry.items) {
            const problem = checkScalar(item.value, schema.items);
            if (problem) {
                return { message: problem, range: item.range };
            }
        }
        return undefined;
    }
    if (typeof value === 'string' && value !== '') {
        const problem = checkScalar(value, schema);
        return problem ? { message: problem, range: entry.valueRange } : undefined;
    }
    return undefined;
};

/** Validates the frontmatter of a rule, command, skill, subagent or habit file. */
export const validateFrontmatter = (text: string, schema: JsonSchema, schemaId?: string): SchemaDiagnostic[] => {
    const parsed = parseFrontmatterBlock(text);
    const diagnostics: SchemaDiagnostic[] = parsed.problems.map(p => ({ severity: 'error', message: p.message, range: p.range, path: '' }));
    const top = range(0, 0, parsed.present ? text.split(/\r?\n/)[0].length : 0);
    if (!parsed.present) {
        for (const key of schema.required ?? []) {
            diagnostics.push({ severity: 'error', message: `Add frontmatter with "${key}" (--- ${key}: … ---) at the top.`, range: top, path: key });
        }
        return diagnostics;
    }
    const known = Object.keys(schema.properties ?? {});
    for (const entry of parsed.entries) {
        const property = schema.properties?.[entry.key];
        if (!property) {
            if (schema.additionalProperties === false) {
                diagnostics.push({ severity: 'warning', message: unknownKeyMessage(entry.key, known), range: entry.keyRange, path: entry.key });
            }
            continue;
        }
        const problem = entryProblem(entry, property);
        if (problem) {
            diagnostics.push({ severity: 'error', message: problem.message, range: problem.range, path: entry.key });
        }
    }
    for (const key of schema.required ?? []) {
        const entry = entryOf(parsed, key);
        if (!entry || entry.value === '') {
            diagnostics.push({ severity: 'error', message: `Missing required key "${key}".`, range: entry?.keyRange ?? top, path: key });
        }
    }
    if (schemaId === 'rule') {
        const always = entryOf(parsed, 'alwaysApply');
        const globs = entryOf(parsed, 'globs');
        if (always?.value === true && globs && asList(globs.value).length) {
            diagnostics.push({ severity: 'warning', message: 'globs are ignored while alwaysApply is true; set alwaysApply: false to attach by globs.', range: globs.keyRange, path: 'globs' });
        }
    }
    return diagnostics;
};

/** Validates any `.ingot` file by its path; files Ingot has no schema for return no diagnostics. */
export const validateIngotFile = (path: string, text: string): { schema?: IngotFileSchema; diagnostics: SchemaDiagnostic[] } => {
    const schema = schemaForPath(path);
    if (!schema) {
        return { diagnostics: [] };
    }
    const diagnostics = schema.format === 'json' ? validateJson(text, schema.schema) : validateFrontmatter(text, schema.schema, schema.id);
    return { schema, diagnostics };
};

/** The sub-schema at a key path (`mcpServers.db.env`), following properties, additionalProperties and items. */
export const schemaAt = (schema: JsonSchema, path: readonly string[]): JsonSchema | undefined => {
    let current: JsonSchema | undefined = schema;
    for (const key of path) {
        if (!current) {
            return undefined;
        }
        if (typesOf(current).includes('array') && current.items && /^\d+$/.test(key)) {
            current = current.items;
            continue;
        }
        current = current.properties?.[key] ?? (typeof current.additionalProperties === 'object' ? current.additionalProperties : undefined);
    }
    return current;
};

/** Draft-07 documents of every `.ingot` schema (for `ingot schemas` and `$schema` in editors). */
export const exportSchemas = (baseUrl: string, draft: string, suffix: string): { file: string; json: JsonSchema }[] =>
    INGOT_FILE_SCHEMAS.map(s => ({ file: `${s.id}${suffix}`, json: { $schema: draft, $id: `${baseUrl}${s.id}${suffix}`, ...s.schema } }));
