import { describe, expect, it } from 'vitest';
import {
    applySyncPlan, conflictText, hashText, isCursorSyncPath, parseSyncFile, planCursorSync, syncFileText, syncSignature, syncSummary
} from './cursor-sync.utils';
import type { CursorSyncItem } from './cursor-sync.types';

const item = (target: string, text: string, source = text): CursorSyncItem => ({ kind: 'rule', from: `.cursor/rules/${target}`, target, text, sourceHash: hashText(source) });
const record = (target: string, text: string, source = text) => ({ from: `.cursor/rules/${target}`, source: hashText(source), target: hashText(text) });

describe('IDEA-287 Convert keeps .ingot in sync with .cursor', () => {
    it('hashes content and spots Cursor paths', () => {
        expect(hashText('a')).toBe(hashText('a'));
        expect(hashText('a')).not.toBe(hashText('b'));
        expect(isCursorSyncPath('.cursor/rules/ts.mdc')).toBe(true);
        expect(isCursorSyncPath('packages/web/.cursor/rules/x.md')).toBe(true);
        expect(isCursorSyncPath('.cursorrules')).toBe(true);
        expect(isCursorSyncPath('packages/api/AGENTS.md')).toBe(true);
        expect(isCursorSyncPath('.ingot/rules/agents.md')).toBe(false);
        expect(isCursorSyncPath('src/cursor.ts')).toBe(false);
    });

    it('adds new files, updates untouched ones, keeps edited ones as conflicts and never revives deleted ones', () => {
        const plan = planCursorSync({
            items: [item('new.md', 'N'), item('same.md', 'S'), item('changed.md', 'C2'), item('edited.md', 'E2'), item('deleted.md', 'D2'), item('theirs.md', 'T')],
            manifest: { 'same.md': record('same.md', 'S'), 'changed.md': record('changed.md', 'C1'), 'edited.md': record('edited.md', 'E1'), 'deleted.md': record('deleted.md', 'D1') },
            targets: { 'new.md': undefined, 'same.md': hashText('S'), 'changed.md': hashText('C1'), 'edited.md': hashText('mine'), 'deleted.md': undefined, 'theirs.md': hashText('own') }
        });
        expect(plan.changes.map(c => `${c.action}:${c.target}`)).toEqual(['add:new.md', 'update:changed.md']);
        expect(plan.changes[1]).toMatchObject({ text: 'C2', record: { source: hashText('C2'), target: hashText('C2') } });
        expect(plan.conflicts).toEqual([{ from: '.cursor/rules/edited.md', target: 'edited.md', reason: 'bothChanged' }]);
        expect(plan.adopted).toEqual({});
    });

    it('removes files whose Cursor source is gone unless edited; forgets records with nothing left', () => {
        const plan = planCursorSync({
            items: [],
            manifest: { 'gone.md': record('gone.md', 'G'), 'kept.md': record('kept.md', 'K'), 'both.md': record('both.md', 'B') },
            targets: { 'gone.md': hashText('G'), 'kept.md': hashText('edited'), 'both.md': undefined }
        });
        expect(plan.changes).toEqual([{ action: 'remove', from: '.cursor/rules/gone.md', target: 'gone.md' }]);
        expect(plan.conflicts).toEqual([{ from: '.cursor/rules/kept.md', target: 'kept.md', reason: 'removedButEdited' }]);
        expect(plan.forgotten).toEqual(['both.md']);
        expect(applySyncPlan({ 'gone.md': record('gone.md', 'G'), 'both.md': record('both.md', 'B') }, plan)).toEqual({});
    });

    it('adopts targets that already match (first sync after an older Convert) and copied files by source hash', () => {
        const copied: CursorSyncItem = { kind: 'skill', from: '.cursor/skills/a/run.sh', target: '.ingot/skills/a/run.sh', sourceHash: hashText('echo') };
        const plan = planCursorSync({ items: [item('r.md', 'R'), copied], manifest: {}, targets: { 'r.md': hashText('R'), '.ingot/skills/a/run.sh': hashText('echo') } });
        expect(plan.changes).toEqual([]);
        expect(Object.keys(plan.adopted)).toEqual(['r.md', '.ingot/skills/a/run.sh']);
        expect(applySyncPlan({}, plan)['r.md']).toEqual(record('r.md', 'R'));
    });

    it('summarizes and signs a pending sync, and stores manifests per workspace', () => {
        const plan = planCursorSync({ items: [item('a.md', 'A')], manifest: {}, targets: {} });
        expect(syncSummary(plan.changes, ['.ingot/mcp.json'])).toBe('1 new and .ingot/mcp.json merged');
        expect(syncSignature(plan, [])).toBe(syncSignature(plan, []));
        expect(syncSignature(plan, [])).not.toBe(syncSignature(plan, ['.ingot/mcp.json']));
        expect(conflictText([{ from: 'x', target: '.ingot/rules/x.md', reason: 'bothChanged' }])).toBe('1 conflict: .ingot/rules/x.md changed in .cursor and edited in .ingot (kept the .ingot version).');
        const text = syncFileText(parseSyncFile(undefined), '/w', { 'a.md': record('a.md', 'A') });
        expect(parseSyncFile(text).workspaces['/w']['a.md']).toEqual(record('a.md', 'A'));
        expect(parseSyncFile(syncFileText(parseSyncFile(text), '/w', {})).workspaces).toEqual({});
        expect(parseSyncFile('{').workspaces).toEqual({});
    });
});
