import { describe, expect, it } from 'vitest';
import {
    declarationName, dismissSuggestion, emptyFrozen, enclosingSymbol, formatFrozen, freezeZone, frozenQuestion, frozenTouches, inferFrozen, isTestCommand, parseFrozen,
    recordRevert, revertSuggestions, serializeFrozen, symbolRange, symbolText, testSource, unfreezeZone, zoneLabel
} from './frozen.utils';
import { DAY_MS } from './frozen.consts';

const SOURCE = `import { rate } from './rate';

export function charge(amount: number, opts: { currency: string }): number {
    if (amount < 0) {
        throw new Error('negative');
    }
    return amount * rate(opts.currency);
}

export const refund = (amount: number) => {
    return -amount;
};

export const double = (n: number) => n * 2;

class Wallet {
    private balance = 0;
    deposit(n: number): void {
        this.balance += n;
    }
}
`;

const PY = 'def total(items):\n    s = 0\n    for i in items:\n        s += i\n\n    return s\n\ndef other():\n    pass\n';

describe('IDEA-303 frozen zones', () => {
    it('finds declarations and their blocks', () => {
        expect(declarationName('export async function load(a) {')).toBe('load');
        expect(declarationName('    if (x) {')).toBeUndefined();
        expect(declarationName("describe('x', () => {")).toBeUndefined();
        expect(symbolRange(SOURCE, 'charge')).toEqual({ start: 2, end: 7 });
        expect(symbolRange(SOURCE, 'refund')).toEqual({ start: 9, end: 11 });
        expect(symbolRange(SOURCE, 'double')).toEqual({ start: 13, end: 13 });
        expect(symbolRange(SOURCE, 'deposit')).toEqual({ start: 17, end: 19 });
        expect(symbolRange(SOURCE, 'Wallet')).toEqual({ start: 15, end: 20 });
        expect(symbolRange(PY, 'total')).toEqual({ start: 0, end: 5 });
        expect(symbolRange(SOURCE, 'missing')).toBeUndefined();
    });

    it('names the function under the cursor', () => {
        expect(enclosingSymbol(SOURCE, 5)).toBe('charge');
        expect(enclosingSymbol(SOURCE, 18)).toBe('deposit');
        expect(enclosingSymbol(SOURCE, 16)).toBe('Wallet');
        expect(enclosingSymbol(SOURCE, 0)).toBeUndefined();
        expect(enclosingSymbol(PY, 3)).toBe('total');
    });

    it('freezes, unfreezes and round-trips .ingot/frozen.json', () => {
        let state = freezeZone(emptyFrozen(), { path: './src/pay.ts', source: 'user' }, 1);
        state = freezeZone(state, { path: 'src/pay.ts', symbol: 'charge', source: 'user' }, 2);
        state = freezeZone(state, { path: 'src/pay.ts', source: 'user' }, 3);
        expect(state.zones.map(z => z.id)).toEqual(['src/pay.ts', 'src/pay.ts#charge']);
        expect(zoneLabel(state.zones[1])).toBe('src/pay.ts › charge');
        expect(parseFrozen(serializeFrozen(state))).toEqual(state);
        expect(unfreezeZone(state, 'src/pay.ts').zones.map(z => z.id)).toEqual(['src/pay.ts#charge']);
        expect(parseFrozen('{"zones":[{"path":"a.ts"},{"nope":1}],"reverts":{"a.ts":2,"b":"x"}}')).toEqual({
            version: 1, zones: [{ id: 'a.ts', path: 'a.ts', source: 'user', at: 0 }], reverts: { 'a.ts': 2 }, dismissed: []
        });
        expect(parseFrozen('not json')).toEqual(emptyFrozen());
    });

    it('flags edits that change a frozen file or function, not the rest of the file', () => {
        const zones = freezeZone(emptyFrozen(), { path: 'src/pay.ts', symbol: 'charge', source: 'user' }, 1).zones;
        const otherEdit = SOURCE.replace('return -amount;', 'return -Math.abs(amount);');
        expect(frozenTouches(zones, 'src/pay.ts', SOURCE, otherEdit)).toEqual([]);
        const chargeEdit = SOURCE.replace("throw new Error('negative');", 'return 0;');
        expect(frozenTouches(zones, './src/pay.ts', SOURCE, chargeEdit).map(t => t.label)).toEqual(['src/pay.ts › charge']);
        expect(frozenTouches(zones, 'src/pay.ts', SOURCE, SOURCE.replace(symbolText(SOURCE, 'charge')!, ''))).toHaveLength(1);
        expect(frozenTouches(zones, 'src/pay.ts', SOURCE, SOURCE.replace('    if (amount < 0) {', '  if (amount < 0) {'))).toEqual([]);
        const fileZones = freezeZone(emptyFrozen(), { path: 'src/pay.ts', source: 'user' }, 1).zones;
        expect(frozenTouches(fileZones, 'src/pay.ts', SOURCE, otherEdit).map(t => t.label)).toEqual(['src/pay.ts']);
        expect(frozenTouches(fileZones, 'src/other.ts', '', 'x')).toEqual([]);
        expect(frozenQuestion(frozenTouches(fileZones, 'src/pay.ts', SOURCE, otherEdit))).toBe('src/pay.ts is frozen. Allow this edit?');
        const folderZones = freezeZone(emptyFrozen(), { path: 'src/legacy', source: 'user' }, 1).zones;
        expect(frozenTouches(folderZones, 'src/legacy/old.ts', '', 'x').map(t => t.label)).toEqual(['src/legacy']);
        expect(frozenTouches(folderZones, 'src/legacy-new.ts', '', 'x')).toEqual([]);
    });

    it('learns "you always revert edits to X" and suggests a freeze once', () => {
        let state = emptyFrozen();
        let suggest = false;
        for (let i = 0; i < 3; i++) {
            ({ state, suggest } = recordRevert(state, './src/legacy.ts', 3));
        }
        expect(suggest).toBe(true);
        expect(revertSuggestions(state, 3)).toEqual(['src/legacy.ts']);
        expect(revertSuggestions(dismissSuggestion(state, 'src/legacy.ts'), 3)).toEqual([]);
        expect(revertSuggestions(freezeZone(state, { path: 'src/legacy.ts', source: 'learned' }, 1), 3)).toEqual([]);
    });

    it('infers stable files from tests and age', () => {
        expect(testSource('src/math.test.ts')).toBe('src/math.ts');
        expect(testSource('src/__tests__/math.spec.js')).toBe('src/math.js');
        expect(testSource('README.md')).toBeUndefined();
        expect(isTestCommand('npm test')).toBe(true);
        expect(isTestCommand('npm run build')).toBe(false);
        const now = 100 * DAY_MS;
        const zones = freezeZone(emptyFrozen(), { path: 'src/c.ts', source: 'user' }, 1).zones;
        expect(inferFrozen([
            { path: 'src/a.ts', test: 'src/a.test.ts', lastCommit: now - 40 * DAY_MS },
            { path: 'src/b.ts', test: 'src/b.test.ts', lastCommit: now - 5 * DAY_MS },
            { path: 'src/c.ts', test: 'src/c.test.ts', lastCommit: now - 90 * DAY_MS },
            { path: 'src/d.ts', test: 'src/d.test.ts', lastCommit: now - 60 * DAY_MS },
            { path: 'src/e.ts', test: 'src/e.test.ts' }
        ], zones, now, 30)).toEqual([{ path: 'src/d.ts', test: 'src/d.test.ts', ageDays: 60 }, { path: 'src/a.ts', test: 'src/a.test.ts', ageDays: 40 }]);
    });

    it('tells the agent what is frozen', () => {
        const zones = freezeZone(freezeZone(emptyFrozen(), { path: 'a.ts', source: 'user' }, 1), { path: 'b.ts', symbol: 'run', source: 'user' }, 2).zones;
        expect(formatFrozen(zones)).toContain('- a.ts\n- b.ts › run');
        expect(formatFrozen([])).toBe('');
    });
});
