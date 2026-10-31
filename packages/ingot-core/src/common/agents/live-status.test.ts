import { describe, expect, it } from 'vitest';
import type { AgentMessage, AgentSession } from './agents.types';
import { appendStep, commandKind, holdRemaining, liveStatus, nextStep, shortCommand } from './live-status';
import type { LiveStatus, LiveStatusInput, LiveStep } from './live-status.types';
import type { ToolCallInfo } from './tool-cards';

const session = (over: Partial<AgentSession> = {}): LiveStatusInput['session'] => ({ status: 'thinking', messages: [], ...over });
const tool = (name: string, args: Record<string, unknown> = {}, state: ToolCallInfo['state'] = 'running'): AgentMessage =>
    ({ role: 'tool', from: `ingot/${name}`, text: '', tool: { server: 'ingot', tool: name, args, state, startedAt: 0 } });
const user: AgentMessage = { role: 'user', text: 'fix the cart' };
const reply = (text: string): AgentMessage => ({ role: 'agent', text });
const label = (messages: AgentMessage[], over: Partial<LiveStatusInput> = {}): string | undefined =>
    liveStatus({ session: session({ messages }), running: true, streaming: false, ...over })?.label;

describe('live status line', () => {
    it('says "Getting it done…" while a turn gets ready, and nothing when no run is going', () => {
        expect(label([user])).toBe('Getting it done…');
        expect(label([user], { running: false })).toBeUndefined();
    });

    it('shows "Thinking…" with the typing dots before the first token, then "Typing…" while the reply streams', () => {
        expect(liveStatus({ session: session({ messages: [user, reply('')] }), running: true, streaming: true })).toEqual({ kind: 'waiting', label: 'Thinking…' });
        expect(label([user, reply('The total')], { streaming: true })).toBe('Typing…');
        // The stream ended and the store works on the reply (edits, memories): no longer typing.
        expect(label([user, reply('The total rounds once.')])).toBe('Getting it done…');
    });

    it('leaves a streaming thought to its own "Thinking…" row', () => {
        expect(label([user, reply('<think>Look at the cart')], { streaming: true })).toBeUndefined();
        expect(label([user, reply('<think>Done.</think> The cart')], { streaming: true })).toBe('Typing…');
    });

    it('names the file that streams', () => {
        const messages = [user, reply('Changing it.')];
        expect(liveStatus({ session: session({ messages, status: 'editing', activeFile: 'src/App.tsx' }), running: true, streaming: true })?.label).toBe('Editing App.tsx…');
    });

    it('counts the files read in this round', () => {
        const first = tool('read_file', { path: 'src/cart.ts' });
        expect(label([user, reply('On it.'), first])).toBe('Reading cart.ts…');
        const done = (m: AgentMessage): AgentMessage => ({ ...m, tool: { ...m.tool!, state: 'done' } });
        expect(label([user, reply('On it.'), done(first), done(tool('read_file', { path: 'a.ts' })), tool('read_file', { path: 'b.ts' })])).toBe('Reading 3 files…');
        // Reads of an earlier round do not count.
        expect(label([user, reply('On it.'), done(first), reply('More.'), tool('read_file', { path: 'b.ts' })])).toBe('Reading b.ts…');
        expect(label([user, reply('On it.'), done(first)])).toBe('Getting it done…');
        // The round asked for three reads: the first one already says so.
        expect(label([user, reply('On it.'), first], { planned: ['read_file', 'grep', 'read_file', 'read_file'] })).toBe('Reading 3 files…');
    });

    it('describes searches, commands and other tools in plain words', () => {
        const at = (m: AgentMessage): string | undefined => label([user, reply('On it.'), m]);
        expect(at(tool('grep', { pattern: 'useCart' }))).toBe('Searching the codebase…');
        expect(at(tool('codebase_search', { query: 'rounding' }))).toBe('Searching the codebase…');
        expect(at(tool('list_dir', { path: 'src' }))).toBe('Exploring the project…');
        expect(at(tool('run', { command: 'npm test' }))).toBe('Running tests…');
        expect(at(tool('run_tests'))).toBe('Running tests…');
        expect(at(tool('run', { command: 'npx tsc --noEmit' }))).toBe('Running checks…');
        expect(at(tool('run_script', { script: 'build' }))).toBe('Building…');
        expect(at(tool('run', { command: 'npm install zod' }))).toBe('Installing packages…');
        expect(at(tool('run_script', { script: 'dev' }))).toBe('Starting the dev server…');
        expect(at(tool('run_script', { script: 'hello' }))).toBe('Running npm run hello…');
        expect(at(tool('run', { command: 'node -e "console.log(1)"' }))).toBe('Running node…');
        expect(at(tool('rename_symbol', { path: 'src/cart.ts', symbol: 'a', newName: 'b' }))).toBe('Editing cart.ts…');
        expect(at(tool('delete', { path: 'src/old.ts' }))).toBe('Deleting old.ts…');
        expect(at(tool('git', { op: 'commit' }))).toBe('Committing…');
        expect(at(tool('git', { op: 'status' }))).toBe('Checking git…');
        expect(at(tool('browser_open', { url: 'http://localhost:5173' }))).toBe('Checking the browser…');
        expect(at(tool('web_search', { query: 'x' }))).toBe('Searching the web…');
        expect(at(tool('task', { prompt: 'x' }))).toBe('Working with subagents…');
        expect(at(tool('fetch_rule', { name: 'x' }))).toBe('Getting it done…');
    });

    it('names the store phases first: the plan check and the wrap-up, even after the model loop ended', () => {
        expect(label([user, reply('Done.')], { phase: 'checking-plan' })).toBe('Checking the plan…');
        expect(label([user, reply('Done.')], { phase: 'wrapping-up', running: false })).toBe('Almost there…');
    });

    it('hides while the run waits on the user', () => {
        expect(liveStatus({ session: session({ status: 'approval' }), running: true, streaming: false })).toBeUndefined();
        expect(liveStatus({ session: session({ ask: { question: 'Which one?' } }), running: true, streaming: false, phase: 'wrapping-up' })).toBeUndefined();
    });

    it('shortens commands to the program and its plain words', () => {
        expect(shortCommand('npm run hello -- --watch')).toBe('npm run hello');
        expect(shortCommand('ls -la')).toBe('ls');
        expect(shortCommand('python3 scripts/migrate_all_the_things_now.py')).toHaveLength(28);
        expect(commandKind('npm run test:e2e')).toBe('testing');
        expect(commandKind('git add .')).toBeUndefined();
    });

    it('holds a line for the minimum time before the next one', () => {
        expect(holdRemaining(1_000, 1_100, 450)).toBe(350);
        expect(holdRemaining(1_000, 2_000, 450)).toBe(0);
    });
});

describe('live status steps', () => {
    const typing = { kind: 'typing', label: 'Typing…' } as const;
    const search = { kind: 'searching', label: 'Searching the codebase…' } as const;
    const working = { kind: 'working', label: 'Getting it done…' } as const;
    const waiting = { kind: 'waiting', label: 'Thinking…' } as const;
    const build = (...statuses: (LiveStatus | undefined)[]): readonly LiveStep[] => statuses.reduce<readonly LiveStep[]>(appendStep, []);

    it('records each change once, with no empty start', () => {
        expect(build(undefined)).toEqual([]);
        expect(build(typing, typing, search).map(s => s.status?.label)).toEqual(['Typing…', 'Searching the codebase…']);
        expect(build(typing, undefined).map(s => s.seq)).toEqual([1, 2]);
        expect(build(typing, search, working, waiting, typing, search)).toHaveLength(4);
    });

    it('shows a quick step that already ended before catching up, but skips lines that only say the run is going', () => {
        const log = build(typing, search, working, waiting);
        // Typing… was up: the 5 ms search still shows next, then the latest line.
        expect(nextStep(log, 1)?.status).toEqual(search);
        expect(nextStep(log, 2)?.status).toEqual(waiting);
        expect(nextStep(log, 4)).toBeUndefined();
        // The run ended right after its wrap-up: "Almost there…" is still shown, then the line goes.
        const end = build(typing, { kind: 'wrapping-up', label: 'Almost there…' }, undefined);
        expect(nextStep(end, 1)?.status?.label).toBe('Almost there…');
        expect(nextStep(end, 2)?.status).toBeUndefined();
    });
});
