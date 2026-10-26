import { BOT_API_PATH, BOT_BLOCKED_PATHS, BOT_ERROR_TEXT, BOT_METHODS, BOT_TERMINAL } from './bot.consts';
import type { BotMethod } from './bot.consts';
import type { BotResponse, BotRun } from './bot.types';

/** Only `/api/bot…` paths, no traversal, no browser-only flows (IDEA-154). */
export function isBotRequest(method: string, path: string): method is BotMethod {
    if (!(BOT_METHODS as readonly string[]).includes(method)) { return false; }
    if (path.includes('..') || path.includes('//') || /[\s\\]/.test(path)) { return false; }
    if (!(path === BOT_API_PATH || path.startsWith(`${BOT_API_PATH}/`) || path.startsWith(`${BOT_API_PATH}?`))) { return false; }
    return !BOT_BLOCKED_PATHS.some(blocked => path === blocked || path.startsWith(`${blocked}?`));
}

export const isActiveRun = (run: BotRun): boolean => !BOT_TERMINAL.includes(run.status);

/** Panel copy for a failed response. */
export function botErrorText(response: BotResponse): string {
    if (response.status === 0) { return BOT_ERROR_TEXT.offline; }
    const code = typeof response.body.error === 'string' ? response.body.error : 'generic';
    return BOT_ERROR_TEXT[code] ?? BOT_ERROR_TEXT.generic;
}

const PR_URL = /(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+)/;

/** The draft PR link in a bot message, if any. */
export const prLinkIn = (text: string): string | undefined => PR_URL.exec(text)?.[1];

/** One readable line per run event (the log under a run row). */
export function eventLine(type: string, payload: Record<string, unknown>): string {
    const text = (key: string): string => (typeof payload[key] === 'string' ? payload[key] as string : '');
    switch (type) {
        case 'status': return `status → ${text('status')}${text('error') ? ` (${text('error')})` : ''}`;
        case 'tool': return `$ ${text('command')} → exit ${String(payload.exitCode ?? '')}`;
        case 'diff': return `changed ${text('file')}`;
        case 'pull_request': return `draft PR #${String(payload.number ?? '')}`;
        case 'approval': return `approval: ${text('title')}`;
        case 'approval_decision': return `decision: ${text('decision')}`;
        default: return text('message') || text('text') || type;
    }
}

/** "3m", "1h 4m" for a run's elapsed compute time. */
export function formatMinutes(seconds: number): string {
    const minutes = Math.round(seconds / 60);
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/** Header badge: mock models = test mode; live models on a local runner = scratch sandbox; all live = none. */
export function modeNotice(state: { runner?: string; runnerLive?: boolean; modelsLive?: boolean }): 'test' | 'sandbox' | undefined {
    if (!state.runner) { return undefined; }
    if (!state.modelsLive) { return 'test'; }
    return state.runner !== 'fly' || !state.runnerLive ? 'sandbox' : undefined;
}

/** Zaprex mascot pose (matches the animated asset's states). */
export type ZaprexPose = 'idle' | 'thinking' | 'working' | 'approval' | 'done' | 'error';

/** How long a finished run keeps the mascot in its done / error pose. */
export const RECENT_RUN_MS = 15 * 60 * 1000;

const ACTIVE_POSE: Partial<Record<BotRun['status'], ZaprexPose>> = { queued: 'thinking', starting: 'thinking', running: 'working', finishing: 'working', awaiting_approval: 'approval' };
const FINISHED_POSE: Partial<Record<BotRun['status'], ZaprexPose>> = { succeeded: 'done', failed: 'error', cancelled: 'error', timed_out: 'error' };
const POSE_PRIORITY: ZaprexPose[] = ['approval', 'working', 'thinking'];

/** Mascot pose from the real runs: an active run wins (approval > working > thinking); else the latest run if recent; else idle. */
export function mascotPose(runs: readonly BotRun[], now = Date.now()): ZaprexPose {
    const active = runs.map(run => ACTIVE_POSE[run.status]).filter(Boolean);
    for (const pose of POSE_PRIORITY) { if (active.includes(pose)) { return pose; } }
    const time = (run: BotRun) => Date.parse(run.endedAt ?? run.createdAt);
    const latest = [...runs].sort((a, b) => time(b) - time(a))[0];
    const pose = latest && FINISHED_POSE[latest.status];
    return pose && now - time(latest) <= RECENT_RUN_MS ? pose : 'idle';
}
