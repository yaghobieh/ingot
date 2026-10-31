import { describe, expect, it } from 'vitest';
import {
    commentsAt, isSafeArtifactName, isSafeRunId, markdownLines, parseArtifactArgs, parseComments, parseRunMeta, planMarkdown, runDir, runIdFor, sortArtifacts,
    sortRuns, steeringText, walkthroughMarkdown
} from './artifacts.utils';

describe('IDEA-290 artifacts', () => {
    it('names one folder per chat turn under .ingot/artifacts', () => {
        expect(runIdFor('chat-abc-1', 2)).toBe('chat-abc-1-r2');
        expect(runDir('chat-abc-1-r2')).toBe('.ingot/artifacts/chat-abc-1-r2');
        expect(isSafeRunId('chat-abc-1-r2')).toBe(true);
        expect(isSafeRunId('../etc')).toBe(false);
    });

    it('accepts markdown names and screenshots only, never paths that leave the run folder', () => {
        expect(isSafeArtifactName('plan.md')).toBe(true);
        expect(isSafeArtifactName('screenshots/shot-1.png')).toBe(true);
        expect(isSafeArtifactName('../plan.md')).toBe(false);
        expect(isSafeArtifactName('notes/plan.md')).toBe(false);
        expect(isSafeArtifactName('plan.txt')).toBe(false);
        expect(isSafeArtifactName('screenshots/../x.png')).toBe(false);
    });

    it('validates ingot/artifact arguments and adds .md to a bare name', () => {
        expect(parseArtifactArgs({ name: 'walkthrough', content: '# Done' })).toEqual({ name: 'walkthrough.md', content: '# Done' });
        expect(parseArtifactArgs({ name: 'screenshots/a.png', content: 'x' })).toHaveProperty('error');
        expect(parseArtifactArgs({ name: 'plan.md', content: '  ' })).toEqual({ error: 'An artifact needs content.' });
    });

    it('orders plan, walkthrough, other notes, then screenshots by number', () => {
        expect(sortArtifacts(['screenshots/shot-10.png', 'notes.md', 'walkthrough.md', 'screenshots/shot-2.png', 'plan.md', 'run.json']).map(f => f.name))
            .toEqual(['plan.md', 'walkthrough.md', 'notes.md', 'screenshots/shot-2.png', 'screenshots/shot-10.png']);
        expect(sortArtifacts(['screenshots/shot-1.png'])[0].kind).toBe('image');
    });

    it('writes the plan as a checklist and the walkthrough with changes, screenshots and result', () => {
        expect(planMarkdown('CSV import', ['Parse', 'Export'])).toBe('# Plan: CSV import\n\n- [ ] Parse\n- [ ] Export\n');
        const walk = walkthroughMarkdown({ title: 'CSV import', prompt: 'add CSV import\nplease', reply: 'Added the parser.', files: ['src/csv.ts'], plan: ['Parse'], screenshots: ['screenshots/shot-1.png'] });
        expect(walk).toContain('# Walkthrough: CSV import');
        expect(walk).toContain('> add CSV import\n');
        expect(walk).toContain('- [x] Parse');
        expect(walk).toContain('- `src/csv.ts`');
        expect(walk).toContain('![screenshots/shot-1.png](screenshots/shot-1.png)');
        expect(walk).toContain('## Result\n\nAdded the parser.');
        expect(walkthroughMarkdown({ title: 't', prompt: 'p', reply: '', files: [], plan: [], screenshots: [] })).toContain('- No files changed');
    });

    it('marks lines inside code fences so they render as code', () => {
        const lines = markdownLines('# Title\n```ts\nconst a = 1;\n```\nafter\n');
        expect(lines.map(l => l.code)).toEqual([false, true, true, true, false]);
        expect(lines[2]).toEqual({ line: 3, text: 'const a = 1;', code: true });
    });

    it('turns a comment into a steering message with file, line and quote', () => {
        expect(steeringText({ file: 'plan.md', line: 3, quote: '- [ ] Add the   parser', text: ' use papaparse ' }))
            .toBe('Comment on artifact plan.md line 3 ("- [ ] Add the parser"): use papaparse');
        expect(steeringText({ file: 'screenshots/shot-1.png', quote: 'screenshots/shot-1.png', text: 'button is cut off' }))
            .toBe('Comment on artifact screenshots/shot-1.png ("screenshots/shot-1.png"): button is cut off');
    });

    it('reads comments and run.json defensively', () => {
        const comments = parseComments(JSON.stringify([{ id: 'a', file: 'plan.md', line: 2, quote: 'x', text: 'hi', at: 1, sent: true }, { bad: true }, 'nope']));
        expect(comments).toEqual([{ id: 'a', file: 'plan.md', line: 2, quote: 'x', text: 'hi', at: 1, sent: true }]);
        expect(parseComments('not json')).toEqual([]);
        expect(commentsAt(comments, 'plan.md', 2)).toHaveLength(1);
        expect(commentsAt(comments, 'plan.md')).toHaveLength(0);
        expect(parseRunMeta('{"runId":"r","sessionId":"s","startedAt":5}')).toEqual({ runId: 'r', sessionId: 's', title: 'r', startedAt: 5 });
        expect(parseRunMeta('{}')).toBeUndefined();
        expect(sortRuns([{ runId: 'a', sessionId: 's', title: 'a', startedAt: 1 }, { runId: 'b', sessionId: 's', title: 'b', startedAt: 2 }]).map(r => r.runId)).toEqual(['b', 'a']);
    });
});
