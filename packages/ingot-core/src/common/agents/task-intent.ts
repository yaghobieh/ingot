/**
 * IDEA-267: telling a request to do something from a question, and spotting a generic repository overview given
 * in place of doing the task, so the agent loop can send it back to work.
 */
import {
    ACTION_VERB, EXPLAIN_REQUEST, LISTING_LINE, LISTING_MIN_LINES, NAMED_TARGET, REQUEST_LEAD, SUMMARY_MIN_SCORE, SUMMARY_PATTERNS
} from './task-intent.consts';

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

const requestBody = (prompt: string): string => oneLine(prompt).replace(REQUEST_LEAD, '');

/** "Fix the failing test", "can you add a /health endpoint?", "please rename foo to bar". */
export const isActionRequest = (prompt: string): boolean => ACTION_VERB.test(requestBody(prompt));

/** "Explain src/limiter.js", "what does `parseArgs` do?": a question about named code. */
export const isTargetedQuestion = (prompt: string): boolean => {
    const body = requestBody(prompt);
    return EXPLAIN_REQUEST.test(body) && NAMED_TARGET.test(body);
};

/** How strongly a reply reads like an overview of the whole repository. */
export const summaryScore = (reply: string): number => {
    const phrases = SUMMARY_PATTERNS.filter(pattern => pattern.test(reply)).length;
    const listing = reply.split('\n').filter(line => LISTING_LINE.test(line)).length >= LISTING_MIN_LINES ? 1 : 0;
    return phrases + listing;
};

export const looksLikeRepoSummary = (reply: string): boolean => summaryScore(reply) >= SUMMARY_MIN_SCORE;

const targetsOf = (prompt: string): string[] => {
    const found = requestBody(prompt).match(new RegExp(NAMED_TARGET.source, 'g')) ?? [];
    return found.map(target => target.replace(/`/g, '').split('/').pop() ?? target).filter(Boolean);
};

/**
 * Which nudge (if any) a final reply needs: `act` when an action request got an overview and no work,
 * `explain` when a question about named code got an overview that never mentions that code.
 */
export const misreadTask = (prompt: string, reply: string, worked: boolean): 'act' | 'explain' | undefined => {
    if (worked || !looksLikeRepoSummary(reply)) {
        return undefined;
    }
    if (isActionRequest(prompt)) {
        return 'act';
    }
    if (isTargetedQuestion(prompt)) {
        const lower = reply.toLowerCase();
        return targetsOf(prompt).some(target => lower.includes(target.toLowerCase())) ? undefined : 'explain';
    }
    return undefined;
};
