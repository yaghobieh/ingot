import {
    CORRECTION_CUES, CORRECTION_FILLER, CORRECTION_REPEATS, CORRECTION_SIMILARITY, CORRECTION_SOFT, CORRECTION_STRONG, INSTEAD, LEARNED_RULE_EXTENSION, LEARNED_RULE_PREFIX,
    LEARNED_RULES_DIR, LEARNED_STATE_VERSION, NEGATION, MAX_CORRECTIONS, MAX_EVIDENCE, MAX_EVIDENCE_CHARS, MAX_INSTRUCTION_CHARS, MAX_SLUG_CHARS, MAX_TITLE_CHARS,
    MIN_CORRECTION_WORDS, MIN_WORD_CHARS, REJECTION_PATTERNS, STOP_WORDS
} from './learned-rules.consts';
import type { CorrectionRecord, LearnedRuleProposal, LearnedRulesState, LearnResult, RejectedHunk } from './learned-rules.types';

export const emptyLearnedState = (): LearnedRulesState => ({ version: LEARNED_STATE_VERSION, corrections: [], proposals: [] });

export const parseLearnedState = (text: string | undefined): LearnedRulesState => {
    try {
        const raw = JSON.parse(text ?? '') as Partial<LearnedRulesState>;
        return {
            version: LEARNED_STATE_VERSION,
            corrections: Array.isArray(raw.corrections) ? raw.corrections : [],
            proposals: Array.isArray(raw.proposals) ? raw.proposals : []
        };
    } catch {
        return emptyLearnedState();
    }
};

export const serializeLearnedState = (state: LearnedRulesState): string => `${JSON.stringify(state, undefined, 2)}\n`;

export const slugify = (text: string): string =>
    text.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_SLUG_CHARS).replace(/-+$/g, '') || 'rule';

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** `.ingot/rules/learned-<slug>.md`, numbered when that file (or another proposal) already has the name. */
export const learnedRulePath = (title: string, taken: readonly string[]): string => {
    const base = `${LEARNED_RULES_DIR}${LEARNED_RULE_PREFIX}${slugify(title)}`;
    let candidate = `${base}${LEARNED_RULE_EXTENSION}`;
    for (let n = 2; taken.includes(candidate); n++) {
        candidate = `${base}-${n}${LEARNED_RULE_EXTENSION}`;
    }
    return candidate;
};

/** The rule file an accepted proposal writes (same frontmatter as hand-written `.ingot/rules`). */
export const renderLearnedRule = (proposal: Pick<LearnedRuleProposal, 'title' | 'globs' | 'body' | 'source'>, body = proposal.body): string => {
    const scope = proposal.globs.length ? `globs: ${proposal.globs.join(', ')}` : 'alwaysApply: true';
    return `---\ndescription: ${proposal.title.replace(/\n/g, ' ')}\n${scope}\nlearned: ${proposal.source}\n---\n${body.trim()}\n`;
};

const extensionGlob = (path: string): string[] => {
    const match = /\.([a-z0-9]+)$/i.exec(path);
    return match ? [`**/*.${match[1].toLowerCase()}`] : [];
};

const hasProposal = (state: LearnedRulesState, key: string): boolean => state.proposals.some(proposal => proposal.key === key);

const nextId = (state: LearnedRulesState, now: Date): string => `lr-${now.getTime().toString(36)}-${state.proposals.length}`;

/** A rejected hunk whose new lines match a known pattern (and the old lines did not) becomes a proposal, once per pattern. */
export const learnFromRejection = (state: LearnedRulesState, hunks: readonly RejectedHunk[], now: Date, takenPaths: readonly string[] = []): LearnResult => {
    for (const hunk of hunks) {
        const fresh = hunk.added.filter(line => !hunk.removed.includes(line));
        for (const pattern of REJECTION_PATTERNS) {
            const key = `rejection:${pattern.id}`;
            const lines = fresh.filter(line => pattern.test.test(line));
            if (!lines.length || hasProposal(state, key)) {
                continue;
            }
            const proposal: LearnedRuleProposal = {
                id: nextId(state, now), key, source: 'rejection', title: pattern.title,
                path: learnedRulePath(pattern.title, [...takenPaths, ...state.proposals.map(p => p.path)]),
                globs: extensionGlob(hunk.path), body: pattern.body,
                evidence: lines.slice(0, MAX_EVIDENCE).map(line => `${hunk.path}: ${clip(line.trim(), MAX_EVIDENCE_CHARS)}`),
                status: 'pending', createdAt: now.toISOString()
            };
            return { state: { ...state, proposals: [...state.proposals, proposal] }, proposal };
        }
    }
    return { state };
};

/** The instruction in a message that corrects the agent ("No, use pnpm instead of npm."), or `undefined` when it is not a correction. */
export const correctionInstruction = (message: string): string | undefined => {
    const first = message.trim().split(/\n/)[0].trim();
    const cued = CORRECTION_CUES.test(first);
    const stripped = first.replace(CORRECTION_FILLER, '').trim();
    const soft = CORRECTION_SOFT.test(stripped) && (cued || INSTEAD.test(stripped));
    if (!stripped || !(CORRECTION_STRONG.test(stripped) || soft || (cued && INSTEAD.test(stripped)))) {
        return undefined;
    }
    const sentence = (/^(.+?[.!?])(?:\s|$)/.exec(stripped)?.[1] ?? stripped).replace(/[!?]+$/, '.');
    const instruction = clip(sentence.charAt(0).toUpperCase() + sentence.slice(1), MAX_INSTRUCTION_CHARS);
    return /[.…]$/.test(instruction) ? instruction : `${instruction}.`;
};

export const correctionWords = (text: string): string[] =>
    [...new Set(text.toLowerCase().replace(/don't|do not|never|avoid/g, ` ${NEGATION} `).split(/[^a-z0-9_@./-]+/)
        .map(word => word.replace(/^[./-]+|[./-]+$/g, ''))
        .filter(word => word === NEGATION || (word.length >= MIN_WORD_CHARS && !STOP_WORDS.includes(word))))].sort();

export const similarity = (a: readonly string[], b: readonly string[]): number => {
    const union = new Set([...a, ...b]).size;
    return union ? a.filter(word => b.includes(word)).length / union : 0;
};

/** Records a correction; once the same correction was made CORRECTION_REPEATS times it becomes a proposal (never twice for one correction). */
export const learnFromMessage = (state: LearnedRulesState, message: string, now: Date, takenPaths: readonly string[] = []): LearnResult => {
    const instruction = correctionInstruction(message);
    const words = instruction ? correctionWords(instruction) : [];
    if (!instruction || words.filter(word => word !== NEGATION).length < MIN_CORRECTION_WORDS) {
        return { state };
    }
    const record: CorrectionRecord = { text: instruction, words, at: now.toISOString() };
    const corrections = [...state.corrections, record].slice(-MAX_CORRECTIONS);
    const same = corrections.filter(item => similarity(item.words, words) >= CORRECTION_SIMILARITY);
    const known = state.proposals.some(proposal => proposal.source === 'correction' && similarity(proposal.key.split(' '), words) >= CORRECTION_SIMILARITY);
    const next: LearnedRulesState = { ...state, corrections };
    if (same.length < CORRECTION_REPEATS || known) {
        return { state: next };
    }
    const title = clip(instruction.replace(/\.$/, ''), MAX_TITLE_CHARS);
    const proposal: LearnedRuleProposal = {
        id: nextId(state, now), key: words.join(' '), source: 'correction', title,
        path: learnedRulePath(title, [...takenPaths, ...state.proposals.map(p => p.path)]),
        globs: [], body: instruction,
        evidence: same.slice(-MAX_EVIDENCE).map(item => `"${clip(item.text, MAX_EVIDENCE_CHARS)}"`),
        status: 'pending', createdAt: now.toISOString()
    };
    return { state: { ...next, proposals: [...next.proposals, proposal] }, proposal };
};

export const pendingProposals = (state: LearnedRulesState): LearnedRuleProposal[] => state.proposals.filter(proposal => proposal.status === 'pending');

export const decideProposal = (state: LearnedRulesState, id: string, status: Exclude<LearnedRuleProposal['status'], 'pending'>, now: Date, body?: string): LearnedRulesState => ({
    ...state,
    proposals: state.proposals.map(proposal => proposal.id === id && proposal.status === 'pending'
        ? { ...proposal, status, decidedAt: now.toISOString(), ...(body !== undefined ? { body } : {}) }
        : proposal)
});
