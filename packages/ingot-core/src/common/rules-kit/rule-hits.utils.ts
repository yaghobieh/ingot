import { RULE_HITS_VERSION } from './rules-kit.consts';
import type { RuleHitEntry, RuleHitLog } from './rules-kit.types';

export const emptyHitLog = (now: Date): RuleHitLog => ({ version: RULE_HITS_VERSION, since: now.toISOString(), rules: {} });

export const parseHitLog = (text: string | undefined): RuleHitLog | undefined => {
    if (!text) {
        return undefined;
    }
    try {
        const json = JSON.parse(text) as Partial<RuleHitLog>;
        if (typeof json.since !== 'string' || typeof json.rules !== 'object' || json.rules === null) {
            return undefined;
        }
        const rules: Record<string, RuleHitEntry> = {};
        for (const [path, entry] of Object.entries(json.rules)) {
            if (entry && typeof entry.lastHit === 'string' && typeof entry.hits === 'number') {
                rules[path] = { hits: entry.hits, lastHit: entry.lastHit };
            }
        }
        return { version: RULE_HITS_VERSION, since: json.since, rules };
    } catch {
        return undefined;
    }
};

/** Counts one hit for every rule path (project-relative) put in an agent's context at `now`. */
export const recordHits = (log: RuleHitLog | undefined, paths: readonly string[], now: Date): RuleHitLog => {
    const base = log ?? emptyHitLog(now);
    const rules: Record<string, RuleHitEntry> = { ...base.rules };
    for (const path of new Set(paths)) {
        rules[path] = { hits: (rules[path]?.hits ?? 0) + 1, lastHit: now.toISOString() };
    }
    return { ...base, rules };
};

export const serializeHitLog = (log: RuleHitLog): string => `${JSON.stringify(log, undefined, 2)}\n`;
