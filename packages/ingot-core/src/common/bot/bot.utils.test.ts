import { describe, expect, it } from 'vitest';
import { botErrorText, eventLine, formatMinutes, isActiveRun, isBotRequest, mascotPose, modeNotice, prLinkIn, RECENT_RUN_MS } from './bot.utils';
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

describe('modeNotice', () => {
    it('is test mode only with mock models', () => {
        expect(modeNotice({ runner: 'local', runnerLive: true, modelsLive: false })).toBe('test');
        expect(modeNotice({ runner: 'local', runnerLive: true, modelsLive: true })).toBe('sandbox');
        expect(modeNotice({ runner: 'fly', runnerLive: true, modelsLive: true })).toBeUndefined();
        expect(modeNotice({})).toBeUndefined();
    });

    it('poses the Zaprex mascot from the real run status', () => {
        const now = Date.parse('2026-10-26T12:00:00Z');
        const at = (status: BotRun['status'], msAgo: number, ended = false): BotRun => ({ ...run(status), createdAt: new Date(now - msAgo - 1000).toISOString(), endedAt: ended ? new Date(now - msAgo).toISOString() : null });
        expect(mascotPose([at('running', 0), at('awaiting_approval', 0)], now)).toBe('approval');
        expect(mascotPose([at('queued', 0), at('running', 0)], now)).toBe('working');
        expect(mascotPose([at('starting', 0)], now)).toBe('thinking');
        expect(mascotPose([at('succeeded', 1000, true)], now)).toBe('done');
        expect(mascotPose([at('timed_out', 1000, true), at('succeeded', 50_000, true)], now)).toBe('error');
        expect(mascotPose([at('succeeded', RECENT_RUN_MS + 1, true)], now)).toBe('idle');
        expect(mascotPose([], now)).toBe('idle');
    });
});
