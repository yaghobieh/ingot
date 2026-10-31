import { describe, expect, it } from 'vitest';
import {
    addedLines, avoidTerms, captureDecisions, conflictQuestion, decisionMarks, decisionRuleFile, decisionsToCapture, findConflicts, formatDecisions, isConfirmation,
    mentionsTerm, parseDecisions, serializeDecisions, stripDecisionMarks
} from './decisions.utils';

const NOW = Date.UTC(2026, 9, 31, 12);

describe('IDEA-302 decision ledger', () => {
    it('finds what a decision forbids', () => {
        expect(avoidTerms('Use Postgres for the order store, not SQLite')).toEqual(['sqlite']);
        expect(avoidTerms('Use pnpm instead of npm or yarn')).toEqual(['npm', 'yarn']);
        expect(avoidTerms('Never add console.log calls')).toEqual(['console.log calls']);
        expect(avoidTerms("Don't use moment.js")).toEqual(['moment.js']);
        expect(avoidTerms('Keep the REST API under /api/v2')).toEqual([]);
    });

    it('reads and writes .ingot/decisions.md, including hand-written lines', () => {
        const text = '# Decisions\n\n- [x] Use pnpm, not npm <!-- id=use-pnpm; confirmed=2; avoid=npm; at=2026-10-30 -->\n- [ ] Never use moment.js\n- not a decision\n- [x] use pnpm not npm\n';
        const decisions = parseDecisions(text);
        expect(decisions).toEqual([
            { id: 'use-pnpm', text: 'Use pnpm, not npm', locked: true, confirmed: 2, avoid: ['npm'], at: '2026-10-30' },
            { id: 'never-use-moment-js', text: 'Never use moment.js', locked: false, confirmed: 1, avoid: ['moment.js'], at: '' }
        ]);
        expect(parseDecisions(serializeDecisions(decisions))).toEqual(decisions);
        expect(serializeDecisions(decisions)).toContain('- [ ] Never use moment.js <!-- id=never-use-moment-js; confirmed=1; avoid=moment.js -->');
    });

    it('captures proposals the user confirms and decisions they state outright', () => {
        const reply = 'Two options.\nDECISION: Use Postgres for the order store, not SQLite\n- **DECISION:** Keep the API under /api/v2.';
        expect(decisionMarks(reply)).toEqual(['Use Postgres for the order store, not SQLite', 'Keep the API under /api/v2']);
        expect(stripDecisionMarks(reply)).toBe('Two options.');
        expect(isConfirmation('Yes, go with that')).toBe(true);
        expect(isConfirmation('ok but no, use MySQL')).toBe(false);
        expect(isConfirmation('no')).toBe(false);
        expect(decisionsToCapture('sounds good', decisionMarks(reply))).toHaveLength(2);
        expect(decisionsToCapture('nope, MySQL', decisionMarks(reply))).toEqual([]);
        expect(decisionsToCapture('Decision: use pnpm, not npm', [])).toEqual(['use pnpm, not npm']);
    });

    it('counts confirmations, re-locks and promotes at the threshold', () => {
        let { decisions, captured, promoted } = captureDecisions([], ['Use pnpm, not npm.'], NOW, 3);
        expect(captured[0]).toMatchObject({ id: 'use-pnpm-not-npm', locked: true, confirmed: 1, avoid: ['npm'], at: '2026-10-31' });
        expect(promoted).toEqual([]);
        decisions = decisions.map(d => ({ ...d, locked: false }));
        ({ decisions, captured } = captureDecisions(decisions, ['use pnpm not npm'], NOW, 3));
        expect(captured[0]).toMatchObject({ locked: true, confirmed: 2 });
        ({ decisions, promoted } = captureDecisions(decisions, ['Use pnpm, not npm'], NOW, 3));
        expect(decisions).toHaveLength(1);
        expect(promoted.map(d => d.confirmed)).toEqual([3]);
        expect(captureDecisions([{ ...decisions[0], habit: '.ingot/rules/x.md' }], ['Use pnpm, not npm'], NOW, 3).promoted).toEqual([]);
    });

    it('flags plans, edits and commands that contradict a locked decision', () => {
        const [pnpm, postgres] = captureDecisions([], ['Use pnpm, not npm', 'Use Postgres, not SQLite'], NOW).decisions;
        expect(mentionsTerm('pnpm install', 'npm')).toBe(false);
        expect(mentionsTerm('run npm install', 'npm')).toBe(true);
        expect(addedLines('a\nb\n', 'a\nb\nimport sqlite from "sqlite3";\n')).toEqual(['import sqlite from "sqlite3";']);
        const conflicts = findConflicts([pnpm, postgres], {
            plan: ['Create the schema'], commands: ['npm install sqlite3'],
            edits: [{ path: 'src/db.ts', added: ['import Database from "better-sqlite3";', 'const db = new SQLite();'] }]
        });
        expect(conflicts.map(c => [c.decision.id, c.term, c.where])).toEqual([['use-pnpm-not-npm', 'npm', '`npm install sqlite3`'], ['use-postgres-not-sqlite', 'sqlite', 'src/db.ts']]);
        expect(findConflicts([{ ...postgres, locked: false }], { plan: ['Switch to SQLite'], commands: [], edits: [] })).toEqual([]);
        expect(findConflicts([postgres], { plan: ['Switch to SQLite'], commands: [], edits: [] })[0].where).toBe('the plan');
        expect(conflictQuestion(conflicts.slice(1))).toBe('This contradicts a locked decision: "Use Postgres, not SQLite" (src/db.ts uses "sqlite"). Go ahead anyway?');
    });

    it('formats locked decisions for the agent and the rule a promoted one becomes', () => {
        const [a, b] = captureDecisions([], ['Use pnpm, not npm', 'Keep the API under /api/v2'], NOW).decisions;
        expect(formatDecisions([a, { ...b, locked: false }], 'ingot/ask_user')).toBe('Locked decisions (.ingot/decisions.md). Do not contradict them; if the task needs to, ask the user first with ingot/ask_user:\n- Use pnpm, not npm');
        expect(formatDecisions([{ ...a, locked: false }], 'ingot/ask_user')).toBe('');
        expect(decisionRuleFile(a)).toEqual({ path: '.ingot/rules/decision-use-pnpm-not-npm.md', content: '---\ndescription: Decision: Use pnpm, not npm\nalwaysApply: true\n---\nUse pnpm, not npm.\n' });
    });
});
