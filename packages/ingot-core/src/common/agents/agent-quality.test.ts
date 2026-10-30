import { describe, expect, it } from 'vitest';
import { builtinToolEnabled, builtinToolProtocol } from './agent-actions';
import { cutEditNudge, wantsCommit, wantsE2e, wantsWorkLoop } from './work-loop';
import { parseAgentOutput } from './agent-protocol';

const LIBRARY_PROMPT = 'Create a new React (Vite+TS, feature folders) and Node.js (Express+TS, routes/controllers/services) project with full CRUD APIs for a library (books, authors, loans) at path /tmp/ingot-e2e-lib';

describe('IDEA-282 agent quality loop', () => {
    it('does not read "feature folders" as a feature to ship and commit', () => {
        expect(wantsCommit(LIBRARY_PROMPT)).toBe(false);
        expect(wantsWorkLoop(LIBRARY_PROMPT)).toBe(false);
        expect(wantsE2e(LIBRARY_PROMPT)).toBe(false);
        expect(wantsCommit('Implement the feature folder layout and commit')).toBe(true);
        expect(wantsE2e('Add a feature to the books page')).toBe(true);
        expect(wantsWorkLoop('Add a playwright e2e test for /tmp/app')).toBe(true);
    });

    it('asks for a cut-off file again', () => {
        const parsed = parseAgentOutput('PLAN:\n- server\n\n<<<EDIT server/src/app.ts\nimport express from "express";\nconst app = ex');
        expect(parsed.editing).toBe('server/src/app.ts');
        expect(parsed.edits).toHaveLength(0);
        const nudge = cutEditNudge(parsed.editing ?? '');
        expect(nudge).toContain('server/src/app.ts was NOT saved');
        expect(nudge).toContain('complete block');
    });

    it('hides the library template when it is turned off', () => {
        const off = { terminal: true, browser: true, template: false };
        expect(builtinToolEnabled('create_library', off)).toBe(false);
        expect(builtinToolEnabled('create_library', { terminal: true, browser: true })).toBe(true);
        expect(builtinToolEnabled('run', off)).toBe(true);
        const protocol = builtinToolProtocol(off);
        expect(protocol).not.toContain('ingot/create_library');
        expect(protocol).toContain('New project from scratch');
        expect(builtinToolProtocol()).toContain('ingot/create_library');
    });
});
