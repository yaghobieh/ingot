import { describe, expect, it } from 'vitest';
import type { AgentSession } from './agents.types';
import { activeAgentCount, agentSubtitle, changesSummary, CHILD_LOOP_GENERATION, editedFilesLabel, fileBadge, formatWorked, relativeTime, resolveLoopGeneration, titleFromPrompt, workingLabel } from './agents.utils';

const session = (over: Partial<AgentSession>): AgentSession => ({
    id: '1', title: 't', status: 'idle', updatedAt: 0, mode: 'agent', model: 'm', messages: [], plan: [], steps: [], changes: [], ...over
});

describe('agents utils', () => {
    it('formats relative times', () => {
        expect(relativeTime(0, 30_000)).toBe('just now');
        expect(relativeTime(0, 2 * 60_000)).toBe('2m');
        expect(relativeTime(0, 18 * 60_000)).toBe('18 min ago');
    });

    it('builds list subtitles like the design', () => {
        expect(agentSubtitle(session({ status: 'editing', activeFile: 'useCart.ts' }), 2 * 60_000)).toBe('Editing useCart.ts · 2m');
        expect(agentSubtitle(session({ status: 'review', changes: [1, 2, 3, 4].map(n => ({ uri: `${n}`, label: `${n}`, added: 1, removed: 0 })) }), 0)).toBe('Ready for review · 4 files');
        expect(agentSubtitle(session({ status: 'review', steps: [{ kind: 'edit', target: 'a.ts', done: false }] }), 0)).toBe('Ready for review · 1 file');
        expect(agentSubtitle(session({ status: 'done' }), 18 * 60_000)).toBe('Done · 18 min ago');
    });

    it('labels the shimmering working line, and hides it while the run waits on the user', () => {
        expect(workingLabel(session({ status: 'thinking' }))).toBe('Getting it done…');
        expect(workingLabel(session({ status: 'editing', activeFile: 'src/cart.ts' }))).toBe('Editing src/cart.ts…');
        expect(workingLabel(session({ status: 'editing' }))).toBe('Getting it done…');
        expect(workingLabel(session({ status: 'approval' }))).toBeUndefined();
        expect(workingLabel(session({ status: 'thinking', ask: { question: 'Which one?' } }))).toBeUndefined();
    });

    it('counts active agents and summarises changes', () => {
        expect(activeAgentCount([session({ status: 'editing' }), session({ status: 'done' }), session({ status: 'review' })])).toBe(2);
        expect(changesSummary(1)).toBe('1 file changed');
    });

    it('keeps a child run on a real generation', () => {
        expect(resolveLoopGeneration(undefined)).toBe(CHILD_LOOP_GENERATION);
        expect(resolveLoopGeneration(2)).toBe(2);
    });

    it('derives titles from prompts', () => {
        expect(titleFromPrompt('  make addItem optimistic ')).toBe('Make addItem optimistic');
        expect(titleFromPrompt('x'.repeat(80))).toHaveLength(48);
    });
});

describe('agent panel labels', () => {
    it('formats how long the agent worked', () => {
        expect(formatWorked(0)).toBe('0s');
        expect(formatWorked(14_000)).toBe('14s');
        expect(formatWorked(134_000)).toBe('2m 14s');
    });

    it('names the edited-files card and the type badge', () => {
        expect(editedFilesLabel(1)).toBe('Edited 1 file');
        expect(editedFilesLabel(16)).toBe('Edited 16 files');
        expect(fileBadge('Books.tsx')).toEqual({ label: 'TSX', tone: 'tsx' });
        expect(fileBadge('package.json')).toEqual({ label: 'JSON', tone: 'json' });
        expect(fileBadge('styles.css')).toEqual({ label: 'CSS', tone: 'css' });
        expect(fileBadge('index.html')).toEqual({ label: 'HTML', tone: 'html' });
        expect(fileBadge('types.ts')).toEqual({ label: 'TS', tone: 'ts' });
        expect(fileBadge('README')).toEqual({ label: 'FILE', tone: 'file' });
    });
});
