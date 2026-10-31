import { slugify } from '../project-config/project-config.utils';
import {
    AVOID_PATTERNS, CONFIRMATION, DECISION_HABIT_THRESHOLD, DECISION_LINE, DECISION_LIST_SEPARATOR, DECISION_MARK, DECISION_META_SEPARATOR, DECISION_RULE_PREFIX,
    DECISION_RULES_DIR, DECISIONS_INTRO, DECISIONS_TITLE, DIRECT_DECISION, MAX_DECISION_CHARS, MAX_DECISIONS, MAX_TERM_WORDS, MIN_TERM_CHARS, REJECTION, TERM_END,
    TERM_LEADING, TERM_SPLIT
} from './decisions.consts';
import type { Decision, DecisionCandidate, DecisionCapture, DecisionConflict, DecisionRuleFile } from './decisions.types';

const DAY_CHARS = 10;

export const today = (now: number): string => new Date(now).toISOString().slice(0, DAY_CHARS);

const clean = (text: string): string => text.replace(/\s+/g, ' ').replace(/^[`"'*\s]+|[`"'*\s.]+$/g, '').trim().slice(0, MAX_DECISION_CHARS);

/** Two phrasings of the same decision compare equal ("Use pnpm, not npm." / "use pnpm not npm"). */
export const decisionKey = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const decisionId = (text: string): string => slugify(text) || 'decision';

/** The terms a decision forbids: "Use Postgres for the order store, not SQLite" → ["sqlite"]. */
export const avoidTerms = (text: string): string[] => {
    const terms = new Set<string>();
    for (const pattern of AVOID_PATTERNS) {
        for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
            for (const raw of match[1].replace(TERM_END, '').split(TERM_SPLIT)) {
                let term = raw.trim().toLowerCase();
                while (TERM_LEADING.test(term)) {
                    term = term.replace(TERM_LEADING, '');
                }
                term = term.replace(/^["'`]+|["'`]+$/g, '').trim();
                if (term.length >= MIN_TERM_CHARS && term.split(/\s+/).length <= MAX_TERM_WORDS && !/^(?:use|using)$/.test(term)) {
                    terms.add(term);
                }
            }
        }
    }
    return [...terms];
};

const parseMeta = (raw: string | undefined): Record<string, string> => Object.fromEntries((raw ?? '').split(DECISION_META_SEPARATOR)
    .map(part => part.split('='))
    .filter(pair => pair.length >= 2 && pair[0].trim())
    .map(([key, ...value]) => [key.trim(), value.join('=').trim()]));

const list = (raw: string | undefined): string[] => (raw ?? '').split(DECISION_LIST_SEPARATOR).map(t => t.trim().toLowerCase()).filter(Boolean);

/** Reads `.ingot/decisions.md`; hand-written `- [x] Never use moment.js` lines work without the metadata comment. */
export const parseDecisions = (text: string | undefined): Decision[] => {
    const seen = new Set<string>();
    return (text ?? '').split(/\r?\n/).flatMap(line => {
        const match = DECISION_LINE.exec(line);
        const body = match ? clean(match[2]) : '';
        if (!match || !body || seen.has(decisionKey(body))) {
            return [];
        }
        seen.add(decisionKey(body));
        const meta = parseMeta(match[3]);
        const confirmed = Number(meta.confirmed);
        const decision: Decision = {
            id: meta.id || decisionId(body), text: body, locked: match[1].toLowerCase() === 'x',
            confirmed: Number.isFinite(confirmed) && confirmed > 0 ? Math.floor(confirmed) : 1,
            avoid: meta.avoid !== undefined ? list(meta.avoid) : avoidTerms(body), at: meta.at || '',
            ...(meta.habit ? { habit: meta.habit } : {})
        };
        return [decision];
    });
};

export const serializeDecisions = (decisions: readonly Decision[]): string => {
    const lines = decisions.map(d => {
        const meta = [`id=${d.id}`, `confirmed=${d.confirmed}`, `avoid=${d.avoid.join(DECISION_LIST_SEPARATOR)}`, ...(d.at ? [`at=${d.at}`] : []), ...(d.habit ? [`habit=${d.habit}`] : [])];
        return `- [${d.locked ? 'x' : ' '}] ${d.text} <!-- ${meta.join(`${DECISION_META_SEPARATOR} `)} -->`;
    });
    return `${DECISIONS_TITLE}\n\n${DECISIONS_INTRO}\n\n${lines.join('\n')}${lines.length ? '\n' : ''}`;
};

/** `DECISION:` lines in an agent reply. */
export const decisionMarks = (reply: string): string[] =>
    [...new Set([...reply.matchAll(new RegExp(DECISION_MARK.source, DECISION_MARK.flags))].map(m => clean(m[1])).filter(Boolean))];

export const stripDecisionMarks = (reply: string): string => reply.replace(new RegExp(DECISION_MARK.source, DECISION_MARK.flags), '').replace(/\n{3,}/g, '\n\n').trim();

export const isConfirmation = (text: string): boolean => CONFIRMATION.test(text) && !REJECTION.test(text);

/** Decisions the user stated outright (`Decision: use pnpm, not npm`). */
export const directDecisions = (text: string): string[] =>
    [...text.matchAll(new RegExp(DIRECT_DECISION.source, DIRECT_DECISION.flags))].map(m => clean(m[1])).filter(Boolean);

/**
 * What a user message locks: decisions they state outright, plus the agent's proposals when the message confirms them.
 * Rejections ("no, …") lock nothing from the proposals.
 */
export const decisionsToCapture = (userText: string, proposals: readonly string[]): string[] => {
    const direct = directDecisions(userText);
    const confirmed = proposals.length && isConfirmation(userText) ? proposals : [];
    return [...new Set([...direct, ...confirmed])];
};

/**
 * Locks each text in the ledger: new decisions start at one confirmation, known ones count up (and lock again if they
 * were unlocked). A decision reaching `threshold` without a habit is returned in `promoted`.
 */
export const captureDecisions = (decisions: readonly Decision[], texts: readonly string[], now: number, threshold = DECISION_HABIT_THRESHOLD): DecisionCapture => {
    let next = [...decisions];
    const captured: Decision[] = [];
    const promoted: Decision[] = [];
    for (const raw of texts) {
        const text = clean(raw);
        if (!text) {
            continue;
        }
        const existing = next.find(d => decisionKey(d.text) === decisionKey(text));
        const decision: Decision = existing
            ? { ...existing, locked: true, confirmed: existing.confirmed + 1 }
            : { id: uniqueId(next, decisionId(text)), text, locked: true, confirmed: 1, avoid: avoidTerms(text), at: today(now) };
        next = existing ? next.map(d => d === existing ? decision : d) : [...next, decision].slice(-MAX_DECISIONS);
        captured.push(decision);
        if (!decision.habit && decision.confirmed >= threshold) {
            promoted.push(decision);
        }
    }
    return { decisions: next, captured, promoted };
};

const uniqueId = (decisions: readonly Decision[], base: string): string => {
    let id = base;
    for (let n = 2; decisions.some(d => d.id === id); n++) {
        id = `${base}-${n}`;
    }
    return id;
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive match (`npm` is not found in `pnpm`). */
export const mentionsTerm = (text: string, term: string): boolean =>
    new RegExp(`(^|[^a-z0-9_])${term.split(/\s+/).map(escapeRegExp).join('\\s+')}($|[^a-z0-9_])`, 'i').test(text);

/** Lines of `after` that are not in `before` (what an edit adds). */
export const addedLines = (before: string, after: string): string[] => {
    const old = new Map<string, number>();
    before.split(/\r?\n/).forEach(line => old.set(line, (old.get(line) ?? 0) + 1));
    return after.split(/\r?\n/).filter(line => {
        const left = old.get(line) ?? 0;
        if (left > 0) {
            old.set(line, left - 1);
            return false;
        }
        return line.trim().length > 0;
    });
};

/** The first place each locked decision would be contradicted by the plan, an edit (path or added lines) or a command. */
export const findConflicts = (decisions: readonly Decision[], candidate: DecisionCandidate): DecisionConflict[] => decisions.filter(d => d.locked).flatMap(decision => {
    for (const term of decision.avoid) {
        const step = candidate.plan.find(s => mentionsTerm(s, term));
        if (step !== undefined) {
            return [{ decision, term, where: 'the plan' }];
        }
        const edit = candidate.edits.find(e => mentionsTerm(e.path, term) || e.added.some(line => mentionsTerm(line, term)));
        if (edit) {
            return [{ decision, term, where: edit.path }];
        }
        const command = candidate.commands.find(c => mentionsTerm(c, term));
        if (command !== undefined) {
            return [{ decision, term, where: `\`${command}\`` }];
        }
    }
    return [];
});

export const conflictQuestion = (conflicts: readonly DecisionConflict[]): string => conflicts.length === 1
    ? `This contradicts a locked decision: "${conflicts[0].decision.text}" (${conflicts[0].where} uses "${conflicts[0].term}"). Go ahead anyway?`
    : `This contradicts ${conflicts.length} locked decisions: ${conflicts.map(c => `"${c.decision.text}" (${c.where} uses "${c.term}")`).join('; ')}. Go ahead anyway?`;

/** The model's note after the user kept a decision. */
export const keptDecisionNote = (conflicts: readonly DecisionConflict[], skipped: readonly string[]): string =>
    `The user kept the locked decision${conflicts.length === 1 ? '' : 's'} ${conflicts.map(c => `"${c.decision.text}"`).join(', ')}.${skipped.length ? ` Skipped: ${skipped.join(', ')}.` : ''} Follow ${conflicts.length === 1 ? 'it' : 'them'} and find another way.`;

/** System prompt section: locked decisions the agent must not contradict. */
export const formatDecisions = (decisions: readonly Decision[], askTool: string): string => {
    const locked = decisions.filter(d => d.locked);
    return locked.length
        ? `Locked decisions (.ingot/decisions.md). Do not contradict them; if the task needs to, ask the user first with ${askTool}:\n${locked.map(d => `- ${d.text}`).join('\n')}`
        : '';
};

/** The always-applied rule a decision becomes once it is a habit. */
export const decisionRuleFile = (decision: Pick<Decision, 'id' | 'text'>): DecisionRuleFile => ({
    path: `${DECISION_RULES_DIR}/${DECISION_RULE_PREFIX}${decision.id}.md`,
    content: `---\ndescription: Decision: ${decision.text}\nalwaysApply: true\n---\n${decision.text.replace(/[.!]*$/, '.')}\n`
});
