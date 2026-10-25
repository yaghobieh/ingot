import { describe, expect, it } from 'vitest';
import {
    chatMetaOf, conflictCopyName, emptySyncState, hashData, itemId, parsePull, planPush, recordItem, ruleKey, ruleName, stableJson, syncableSettings, textOf
} from './sync.utils';

describe('settings sync (IDEA-126)', () => {
    it('hashes data independent of key order', () => {
        expect(stableJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
        expect(hashData({ a: 1, b: 2 })).toBe(hashData({ b: 2, a: 1 }));
        expect(hashData({ a: 1 })).not.toBe(hashData({ a: 2 }));
    });

    it('never syncs account URLs or credential-like settings', () => {
        expect(syncableSettings({
            'editor.fontSize': 14, 'ingot.account.serverUrl': 'x', 'ingot.account.syncSettings': false, 'foo.apiKey': 'k', 'x.authToken': 't', 'bad key': 1, 'ingot.models.byok': true
        })).toEqual({ 'editor.fontSize': 14, 'ingot.models.byok': true });
    });

    it('maps rule files and conflict copies', () => {
        expect(ruleKey('team.md')).toBe('rules/team.md');
        expect(ruleKey('.hidden.md')).toBeUndefined();
        expect(ruleKey('a b.md')).toBeUndefined();
        expect(ruleName('rules/team.md')).toBe('team.md');
        expect(ruleName('rules/../x')).toBeUndefined();
        expect(conflictCopyName('team.md')).toBe('team.conflict.md');
        expect(conflictCopyName('README')).toBe('README.conflict');
        expect(textOf({ text: 'hi' })).toBe('hi');
        expect(textOf('hi')).toBeUndefined();
    });

    it('keeps chat metadata only', () => {
        const meta = chatMetaOf([{ id: 'c1', title: 'Fix cart', pinned: true, updatedAt: 5, messages: ['secret body'] } as never]);
        expect([...meta]).toEqual([['chat/c1', { title: 'Fix cart', pinned: true, order: 0, updatedAt: 5 }]]);
    });

    it('plans pushes with baseVersion and deletions, then records results', () => {
        const state = emptySyncState();
        recordItem(state, { kind: 'settings', key: 'editor.fontSize', data: { value: 14 }, version: 3, deleted: false });
        recordItem(state, { kind: 'rules', key: 'rules/old.md', data: { text: 'x' }, version: 1, deleted: false });
        const local = new Map<string, unknown>([
            [itemId('settings', 'editor.fontSize'), { value: 16 }],
            [itemId('settings', 'editor.tabSize'), { value: 2 }]
        ]);
        const plan = planPush(local, state, ['settings', 'rules']);
        expect(plan.puts).toEqual([
            { kind: 'settings', key: 'editor.fontSize', data: { value: 16 }, baseVersion: 3 },
            { kind: 'settings', key: 'editor.tabSize', data: { value: 2 } }
        ]);
        expect(plan.deletes).toEqual([{ kind: 'rules', key: 'rules/old.md', baseVersion: 1 }]);
        expect(planPush(local, state, ['settings']).deletes).toEqual([]);
        recordItem(state, { kind: 'rules', key: 'rules/old.md', data: null, version: 2, deleted: true });
        expect(state.hashes[itemId('rules', 'rules/old.md')]).toBeUndefined();
        expect(state.versions[itemId('rules', 'rules/old.md')]).toBe(2);
        recordItem(state, { kind: 'settings', key: 'editor.fontSize', data: { value: 16 }, version: 4, deleted: false });
        expect(planPush(local, state, ['settings']).puts.map(p => p.key)).toEqual(['editor.tabSize']);
    });

    it('parses pull pages', () => {
        expect(parsePull({ items: [{ kind: 'settings', key: 'a', data: {}, version: 1, deleted: false }, { bad: true }], cursor: 9, hasMore: true }))
            .toEqual({ items: [{ kind: 'settings', key: 'a', data: {}, version: 1, deleted: false }], cursor: 9, hasMore: true });
        expect(parsePull(null)).toEqual({ items: [], cursor: 0, hasMore: false });
    });
});
