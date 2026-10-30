/** IDEA-267: the model's `NEXT:` line becomes buttons under its reply; a sensible default when it gave none. */
import {
    FALLBACK_FOLLOW_UPS, FOLLOW_UPS_PREFIX, FOLLOW_UPS_SEPARATOR, MAX_FOLLOW_UP_CHARS, MAX_FOLLOW_UPS, MIN_FOLLOW_UP_CHARS
} from './follow-ups.consts';
import type { FollowUpSignals } from './follow-ups.types';

const NEXT_LINE = new RegExp(`^\\s*(?:[*_]{1,2})?${FOLLOW_UPS_PREFIX.slice(0, -1)}(?:[*_]{1,2})?\\s*:(?:[*_]{1,2})?`, 'i');
/** A `NEXT:` line still streaming in (`N`, `NE`, `NEX`, `NEXT`), hidden so it never flashes. */
const PARTIAL_NEXT = /\n\s*[*_]{0,2}N(?:E(?:X(?:T)?)?)?$/i;

const cleanItem = (raw: string): string => raw
    .trim()
    .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/[.;,]+$/, '')
    .replace(/^["'`*_]+|["'`*_]+$/g, '')
    .replace(/[.;,]+$/, '')
    .trim();

export const normalizeFollowUps = (items: readonly string[], max = MAX_FOLLOW_UPS): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items.map(cleanItem)) {
        const key = item.toLowerCase();
        if (item.length < MIN_FOLLOW_UP_CHARS || item.length > MAX_FOLLOW_UP_CHARS || seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(item);
        if (out.length >= max) {
            break;
        }
    }
    return out;
};

/** Removes the `NEXT:` line(s) from a reply and returns the suggestions they held. */
export const extractFollowUps = (text: string): { display: string; followUps: string[] } => {
    const items: string[] = [];
    const kept = text.replace(PARTIAL_NEXT, '').split('\n').filter(line => {
        const match = NEXT_LINE.exec(line);
        if (!match) {
            return true;
        }
        items.push(...line.slice(match[0].length).split(FOLLOW_UPS_SEPARATOR));
        return false;
    });
    return { display: kept.join('\n').trim(), followUps: normalizeFollowUps(items) };
};

export const fallbackFollowUps = (signals: FollowUpSignals): string[] => {
    if (signals.checks === 'failed') {
        return [...FALLBACK_FOLLOW_UPS.checksFailed];
    }
    if (signals.checks === 'passed' && signals.edited) {
        return [...FALLBACK_FOLLOW_UPS.checksPassed];
    }
    return [...(signals.edited ? FALLBACK_FOLLOW_UPS.edited : FALLBACK_FOLLOW_UPS.answered)];
};

/** The model's own suggestions win; the fallback only fills an empty list. */
export const followUpsFor = (fromModel: readonly string[], signals: FollowUpSignals): string[] =>
    fromModel.length ? normalizeFollowUps(fromModel) : fallbackFollowUps(signals);
