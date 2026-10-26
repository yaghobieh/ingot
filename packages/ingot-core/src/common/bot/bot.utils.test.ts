import { describe, expect, it } from 'vitest';
import { botErrorText, eventLine, formatMinutes, isActiveRun, isBotRequest, prLinkIn } from './bot.utils';
import type { BotRun } from './bot.types';

const run = (status: BotRun['status']): BotRun => ({ id: 'r', status, prompt: '', source: 'ide', repoId: null, repoFullName: null, prNumber: null, prUrl: null, summary: '', computeSeconds: 0, error: null, createdAt: '', startedAt: null, endedAt: null });

describe('bot utils (IDEA-154)', () => {
    it('forwards only /api/bot paths and never the browser-only GitHub connect', () => {
        expect(isBotRequest('GET', '/api/bot/status')).toBe(true);
        expect(isBotRequest('POST', '/api/bot/chat')).toBe(true);
        expect(isBotRequest('GET', '/api/bot/chat?repoId=abc')).toBe(true);
        expect(isBotRequest('POST', '/api/bot/approvals/1')).toBe(true);
        expect(isBotRequest('GET', '/api/bot/github/connect')).toBe(false);
        expect(isBotRequest('GET', '/api/admin/bot/dashboard')).toBe(false);
        expect(isBotRequest('GET', '/api/bot/../me')).toBe(false);
        expect(isBotRequest('GET', '/api/botx')).toBe(false);
        expect(isBotRequest('GET', '/api/bot//x')).toBe(false);
        expect(isBotRequest('PUT', '/api/bot/status')).toBe(false);
    });

    it('maps errors, offline and unknown codes to copy', () => {
        expect(botErrorText({ status: 0, body: {} })).toMatch(/Sign in/);
        expect(botErrorText({ status: 403, body: { error: 'bot_upgrade_required' } })).toMatch(/Pro\+/);
        expect(botErrorText({ status: 500, body: { error: 'weird' } })).toMatch(/went wrong/);
    });

    it('finds PR links, formats events and minutes, and knows active runs', () => {
        expect(prLinkIn('Draft PR: https://github.com/ingot-dev/sample-app/pull/3 done')).toBe('https://github.com/ingot-dev/sample-app/pull/3');
        expect(prLinkIn('no link')).toBeUndefined();
        expect(eventLine('status', { status: 'running' })).toBe('status → running');
        expect(eventLine('tool', { command: 'npm test', exitCode: 1 })).toBe('$ npm test → exit 1');
        expect(eventLine('step', { message: 'Fixing sum.mjs' })).toBe('Fixing sum.mjs');
        expect(formatMinutes(125)).toBe('2m');
        expect(formatMinutes(3900)).toBe('1h 5m');
        expect(isActiveRun(run('running'))).toBe(true);
        expect(isActiveRun(run('awaiting_approval'))).toBe(true);
        expect(isActiveRun(run('succeeded'))).toBe(false);
    });
});
