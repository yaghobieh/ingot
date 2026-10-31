import { DAY_MS, DECLARATIONS, FROZEN_FILE_VERSION, MAX_INFER_CANDIDATES, NOT_DECLARATIONS, SYMBOL_SEPARATOR, TEST_COMMAND } from './frozen.consts';
import type { FrozenState, FrozenTouch, FrozenZone, InferCandidate, InferInput, LineRange, NewZone, TestRun } from './frozen.types';

/** Lines scanned after a declaration for its opening brace. */
const HEADER_LINES = 6;

export const emptyFrozen = (): FrozenState => ({ version: FROZEN_FILE_VERSION, zones: [], reverts: {}, dismissed: [] });

export const normalizePath = (path: string): string => path.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');

export const zoneId = (path: string, symbol?: string): string => symbol ? `${normalizePath(path)}#${symbol}` : normalizePath(path);

export const zoneLabel = (zone: Pick<FrozenZone, 'path' | 'symbol'>): string => zone.symbol ? `${zone.path}${SYMBOL_SEPARATOR}${zone.symbol}` : zone.path;

const isZone = (z: unknown): z is FrozenZone => !!z && typeof (z as FrozenZone).path === 'string' && !!(z as FrozenZone).path.trim()
    && ((z as FrozenZone).symbol === undefined || typeof (z as FrozenZone).symbol === 'string');

const isTestRun = (t: unknown): t is TestRun => !!t && typeof (t as TestRun).command === 'string' && typeof (t as TestRun).passed === 'boolean' && typeof (t as TestRun).at === 'number';

export const parseFrozen = (text: string | undefined): FrozenState => {
    if (!text?.trim()) {
        return emptyFrozen();
    }
    try {
        const json = JSON.parse(text) as Partial<FrozenState>;
        const zones = (Array.isArray(json.zones) ? json.zones.filter(isZone) : []).map(z => ({
            ...z, path: normalizePath(z.path), id: zoneId(z.path, z.symbol), source: z.source ?? 'user', at: typeof z.at === 'number' ? z.at : 0
        }));
        const reverts = json.reverts && typeof json.reverts === 'object' && !Array.isArray(json.reverts)
            ? Object.fromEntries(Object.entries(json.reverts).filter(([, n]) => typeof n === 'number')) : {};
        const dismissed = Array.isArray(json.dismissed) ? json.dismissed.filter((p): p is string => typeof p === 'string') : [];
        return { version: FROZEN_FILE_VERSION, zones, reverts, dismissed, ...(isTestRun(json.tests) ? { tests: json.tests } : {}) };
    } catch {
        return emptyFrozen();
    }
};

export const serializeFrozen = (state: FrozenState): string => `${JSON.stringify(state, undefined, 2)}\n`;

export const freezeZone = (state: FrozenState, zone: NewZone, now: number): FrozenState => {
    const path = normalizePath(zone.path);
    const id = zoneId(path, zone.symbol);
    if (!path || state.zones.some(z => z.id === id)) {
        return state;
    }
    const next: FrozenZone = { id, path, ...(zone.symbol ? { symbol: zone.symbol } : {}), source: zone.source, ...(zone.reason ? { reason: zone.reason } : {}), at: now };
    return { ...state, zones: [...state.zones, next], dismissed: state.dismissed.filter(p => p !== path) };
};

export const unfreezeZone = (state: FrozenState, id: string): FrozenState => ({ ...state, zones: state.zones.filter(z => z.id !== id) });

export const zonesFor = (zones: readonly FrozenZone[], path: string): FrozenZone[] => {
    const clean = normalizePath(path);
    return zones.filter(z => z.path === clean || (!z.symbol && clean.startsWith(`${z.path}/`)));
};

/** The name a line declares (function, arrow const, class, method, def, fn, func), if any. */
export const declarationName = (line: string): string | undefined => {
    for (const pattern of DECLARATIONS) {
        const name = pattern.exec(line)?.groups?.name;
        if (name && !NOT_DECLARATIONS.has(name)) {
            return name;
        }
    }
    return undefined;
};

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** The lines of the declaration starting at `start`: braces (outside parentheses and strings), or indentation for `def`. */
export const blockRange = (lines: readonly string[], start: number): LineRange => {
    if (/:\s*(#.*)?$/.test(lines[start]) && /^\s*(?:async\s+)?def\s/.test(lines[start])) {
        const indent = indentOf(lines[start]);
        let end = start;
        for (let i = start + 1; i < lines.length; i++) {
            if (lines[i].trim() && indentOf(lines[i]) <= indent) {
                break;
            }
            if (lines[i].trim()) {
                end = i;
            }
        }
        return { start, end };
    }
    let depth = 0;
    let parens = 0;
    let opened = false;
    let quote: string | undefined;
    for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        for (let c = 0; c < line.length; c++) {
            const ch = line[c];
            if (quote) {
                if (ch === '\\') {
                    c++;
                } else if (ch === quote) {
                    quote = undefined;
                }
                continue;
            }
            if (ch === '/' && line[c + 1] === '/') {
                break;
            }
            if (ch === '"' || ch === "'" || ch === '`') {
                quote = ch;
            } else if (ch === '(') {
                parens++;
            } else if (ch === ')') {
                parens = Math.max(0, parens - 1);
            } else if (ch === '{' && parens === 0) {
                depth++;
                opened = true;
            } else if (ch === '}' && parens === 0 && opened) {
                depth--;
                if (depth === 0) {
                    return { start, end: i };
                }
            } else if (ch === ';' && !opened && parens === 0) {
                return { start, end: i };
            }
        }
        if (quote !== '`') {
            quote = undefined;
        }
        if (!opened && i - start >= HEADER_LINES) {
            return { start, end: start };
        }
    }
    return { start, end: opened ? lines.length - 1 : start };
};

/** The line range of `symbol`'s first declaration in `text`. */
export const symbolRange = (text: string, symbol: string): LineRange | undefined => {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex(line => declarationName(line) === symbol);
    return start < 0 ? undefined : blockRange(lines, start);
};

export const symbolText = (text: string, symbol: string): string | undefined => {
    const range = symbolRange(text, symbol);
    return range && text.split(/\r?\n/).slice(range.start, range.end + 1).join('\n');
};

/** The innermost declaration whose block contains the 0-based `line` (the function under the cursor). */
export const enclosingSymbol = (text: string, line: number): string | undefined => {
    const lines = text.split(/\r?\n/);
    for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
        const name = declarationName(lines[i]);
        if (name && blockRange(lines, i).end >= line) {
            return name;
        }
    }
    return undefined;
};

const comparable = (text: string): string => text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('\n');

/** Frozen zones an edit of `path` from `before` to `after` would change (a removed function counts as changed). */
export const frozenTouches = (zones: readonly FrozenZone[], path: string, before: string, after: string): FrozenTouch[] => zonesFor(zones, path).flatMap(zone => {
    if (!zone.symbol) {
        return before === after ? [] : [{ zone, label: zoneLabel(zone) }];
    }
    const old = symbolText(before, zone.symbol);
    if (old === undefined) {
        return [];
    }
    const next = symbolText(after, zone.symbol);
    return next !== undefined && comparable(next) === comparable(old) ? [] : [{ zone, label: zoneLabel(zone) }];
});

export const frozenQuestion = (touches: readonly FrozenTouch[]): string =>
    `${touches.map(t => t.label).join(', ')} ${touches.length === 1 ? 'is' : 'are'} frozen. Allow this edit?`;

export const keptFrozenNote = (labels: readonly string[]): string =>
    `The user kept ${labels.join(', ')} frozen, so that edit was not applied. Leave ${labels.length === 1 ? 'it' : 'them'} unchanged and find another way.`;

/** Whether any zone covers the whole file (live edit views skip such files). */
export const fileFrozen = (zones: readonly FrozenZone[], path: string): boolean => zonesFor(zones, path).some(z => !z.symbol);

/** Counts a rejected agent edit; `suggest` once the file reaches the threshold and is neither frozen nor dismissed. */
export const recordRevert = (state: FrozenState, path: string, threshold: number): { state: FrozenState; suggest: boolean } => {
    const clean = normalizePath(path);
    const count = (state.reverts[clean] ?? 0) + 1;
    const next = { ...state, reverts: { ...state.reverts, [clean]: count } };
    return { state: next, suggest: count >= threshold && !fileFrozen(next.zones, clean) && !next.dismissed.includes(clean) };
};

/** Files Ingot suggests freezing because the user keeps rejecting agent edits to them. */
export const revertSuggestions = (state: FrozenState, threshold: number): string[] =>
    Object.entries(state.reverts).filter(([path, n]) => n >= threshold && !fileFrozen(state.zones, path) && !state.dismissed.includes(path)).map(([path]) => path);

export const dismissSuggestion = (state: FrozenState, path: string): FrozenState =>
    ({ ...state, dismissed: [...new Set([...state.dismissed, normalizePath(path)])] });

export const isTestCommand = (command: string): boolean => TEST_COMMAND.test(command);

/** The source a test covers: `src/a.test.ts` and `src/__tests__/a.spec.ts` → `src/a.ts`. */
export const testSource = (testPath: string): string | undefined => {
    const clean = normalizePath(testPath);
    const slash = clean.lastIndexOf('/');
    const dir = clean.slice(0, slash + 1).replace(/(^|\/)__tests__\/$/, '$1');
    const base = clean.slice(slash + 1);
    const match = /^(.+)\.(?:test|spec)\.(\w+)$/.exec(base);
    return match ? `${dir}${match[1]}.${match[2]}` : undefined;
};

/** Stable files: tested, unchanged for `minAgeDays`, not frozen yet; oldest first. */
export const inferFrozen = (inputs: readonly InferInput[], zones: readonly FrozenZone[], now: number, minAgeDays: number): InferCandidate[] => inputs
    .filter((i): i is InferInput & { lastCommit: number } => i.lastCommit !== undefined && !fileFrozen(zones, i.path))
    .map(i => ({ path: normalizePath(i.path), test: i.test, ageDays: Math.floor((now - i.lastCommit) / DAY_MS) }))
    .filter(c => c.ageDays >= minAgeDays)
    .sort((a, b) => b.ageDays - a.ageDays || a.path.localeCompare(b.path))
    .slice(0, MAX_INFER_CANDIDATES);

/** System prompt section: what the agent must leave alone. */
export const formatFrozen = (zones: readonly FrozenZone[]): string => zones.length
    ? `Frozen zones (.ingot/frozen.json). Do not change them; an edit to one waits for the user's approval in the chat:\n${zones.map(z => `- ${zoneLabel(z)}`).join('\n')}`
    : '';
