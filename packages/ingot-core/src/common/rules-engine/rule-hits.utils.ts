import { asList, asText } from './frontmatter.utils';
import { matchGlob } from './glob.utils';
import { matchingGlob } from './rule-docs.utils';
import { HABIT_WEIGHTS, MIN_HABIT_SCORE, RULE_HIT_LABELS } from './rules-engine.consts';
import type { HabitMatch, RuleDoc, RuleHit, RuleHitCode, RuleHitInput, RuleHitReason } from './rules-engine.types';

const reason = (code: RuleHitCode, detail: string, extra: Partial<RuleHitReason> = {}): RuleHitReason => ({ code, label: RULE_HIT_LABELS[code], detail, ...extra });

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A keyword as a whole word or phrase, allowing a plural or verb ending (as the habit matcher). */
export const keywordMatches = (keyword: string, text: string): boolean => {
    const words = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean).map(escapeRegex);
    return words.length > 0 && new RegExp(`(^|[^a-z0-9])${words.join('\\s+')}(s|es|ed|ing)?([^a-z0-9]|$)`, 'i').test(text);
};

/** `@name`, `@rule:name` or `@scope/name` in the prompt. */
export const isMentioned = (doc: RuleDoc, prompt: string): boolean => {
    const names = [doc.name, doc.baseName].map(n => escapeRegex(n.toLowerCase()));
    return names.some(n => new RegExp(`@(?:rule:)?${n}(?![\\w-])`, 'i').test(prompt));
};

/** Why a rule that went into a turn was loaded. */
export const explainRuleHit = (doc: RuleDoc, files: readonly string[], prompt = ''): RuleHitReason => {
    if (doc.source === 'agents') {
        if (!doc.scope) {
            return reason('agents-file', `${doc.name} at the project root loads in every turn.`);
        }
        const file = files.find(f => f.startsWith(`${doc.scope}/`));
        return reason('nested-agents', file ? `Closest ${doc.baseName} to ${file}.` : `${doc.baseName} for files under ${doc.scope}/.`, file ? { file } : {});
    }
    if (isMentioned(doc, prompt)) {
        return reason('mention', `@-mentioned in the prompt.`);
    }
    if (doc.kind === 'always') {
        const why = doc.source === 'global' && !doc.path.includes('/rules/') ? 'Your global instructions load in every turn.'
            : doc.frontmatter.data.alwaysApply === true ? 'alwaysApply: true loads it in every turn.' : 'No globs or description, so it loads in every turn.';
        return reason('always', doc.scope ? `${why} (files under ${doc.scope}/)` : why);
    }
    if (doc.kind === 'auto') {
        for (const file of files) {
            const glob = matchingGlob(doc, file);
            if (glob) {
                return reason('glob', `${glob} matched ${file}.`, { glob, file });
            }
        }
        return reason('loaded', 'Loaded for this turn; no file in context matches its globs now.');
    }
    if (doc.kind === 'agent') {
        return reason('agent-requested', `The agent asked for it by its description${doc.description ? `: "${doc.description}"` : ''}.`);
    }
    return reason('loaded', 'Loaded for this turn.');
};

const toHit = (doc: RuleDoc, why: RuleHitReason): RuleHit => ({
    id: doc.id, name: doc.name, path: doc.path, source: doc.source, kind: doc.kind, scope: doc.scope, tokens: doc.tokens, reason: why
});

/** Every rule, AGENTS.md and habit of one agent turn, with why it loaded and what it cost. */
export const explainRuleHits = (input: RuleHitInput): RuleHit[] => [
    ...input.applied.map(doc => toHit(doc, explainRuleHit(doc, input.files, input.prompt))),
    ...(input.habits ?? []).map(m => toHit(m.doc, reason('habit', m.detail)))
];

/** Habit files (playbooks) that match a turn, best first: errorRegex 3, each keyword 2, a file 1 (2 when globs are its only signal). */
export const matchHabits = (habits: readonly RuleDoc[], prompt: string, files: readonly string[], errors: readonly string[] = []): HabitMatch[] =>
    habits.map(doc => {
        const data = doc.frontmatter.data;
        const keywords = asList(data.keywords);
        const globs = asList(data.globs);
        const errorRegex = asText(data.errorRegex);
        const reasons: string[] = [];
        let score = 0;
        if (errorRegex) {
            try {
                const re = new RegExp(errorRegex, 'i');
                if (re.test(prompt) || errors.some(e => re.test(e))) {
                    score += HABIT_WEIGHTS.error;
                    reasons.push('error matched errorRegex');
                }
            } catch {
                // an invalid errorRegex is a schema problem, not a match
            }
        }
        const hits = keywords.filter(k => keywordMatches(k, prompt));
        score += hits.length * HABIT_WEIGHTS.keyword;
        reasons.push(...hits.map(k => `keyword "${k}"`));
        const file = globs.length ? files.find(f => globs.some(g => matchGlob(g, f))) : undefined;
        if (file) {
            score += keywords.length || errorRegex ? HABIT_WEIGHTS.glob : HABIT_WEIGHTS.globOnly;
            reasons.push(`file ${file}`);
        }
        return { doc, score, detail: reasons.join(', ') };
    }).filter(m => m.score >= MIN_HABIT_SCORE).sort((a, b) => b.score - a.score || a.doc.name.localeCompare(b.doc.name));

export const hitTokens = (hits: readonly RuleHit[]): number => hits.reduce((sum, h) => sum + h.tokens, 0);
