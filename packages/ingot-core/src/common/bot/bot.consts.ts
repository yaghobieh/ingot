import type { BotRunStatus } from './bot.types';

/** Zaprex API prefix on ingot-server (IDEA-154). The backend only forwards paths under it. */
export const BOT_API_PATH = '/api/bot';
/** Browser-only flows (GitHub OAuth) the IDE must never call with its token; they open on the website instead. */
export const BOT_BLOCKED_PATHS: readonly string[] = ['/api/bot/github/connect'];
export const BOT_METHODS = ['GET', 'POST', 'PATCH', 'DELETE'] as const;
export type BotMethod = typeof BOT_METHODS[number];

export const BOT_TERMINAL: readonly BotRunStatus[] = ['succeeded', 'failed', 'cancelled', 'timed_out'];
/** Poll while a run is active; slow poll otherwise. */
export const BOT_ACTIVE_POLL_MS = 2_500;
export const BOT_IDLE_POLL_MS = 20_000;
export const BOT_MAX_PROMPT = 4_000;

export const BOT_STATUS_LABELS: Record<BotRunStatus, string> = {
    queued: 'Queued', starting: 'Starting', running: 'Running', awaiting_approval: 'Waiting for you', finishing: 'Finishing',
    succeeded: 'Done', failed: 'Failed', cancelled: 'Cancelled', timed_out: 'Timed out'
};

/** Server error codes → panel copy. */
export const BOT_ERROR_TEXT: Record<string, string> = {
    bot_upgrade_required: 'Zaprex is part of Pro+ and Ultra.',
    bot_paused: 'Zaprex is paused right now.',
    bot_limit_minutes: 'You have used all Zaprex minutes for this month.',
    bot_limit_concurrent: 'A run is already in progress. Wait for it to finish.',
    bot_spend_cap: 'The spend cap has been reached.',
    rate_limited: 'Too many runs. Try again later.',
    repo_disabled: 'This repository is turned off for Zaprex.',
    approval_not_pending: 'This approval was already decided.',
    github_not_connected: 'Connect GitHub on the website first.',
    account_blocked: 'Your account is blocked.',
    offline: 'Sign in to Ingot to use Zaprex.',
    generic: 'Something went wrong. Try again.'
};
