import { matchGlob } from '../project-config/project-config.utils';
import { MATCH_WEIGHTS, MAX_SIGNAL_FILES, MAX_TERMINAL_ERROR_LINES, MIN_MATCH_SCORE, TERMINAL_ERROR_LINE } from './playbook.consts';
import type { HabitSignals, Playbook, PlaybookMatch } from './playbook.types';

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A keyword as a whole word (or phrase), allowing a plural or verb ending: `payment` matches "payments", not "prepayment". */
export const keywordMatches = (keyword: string, text: string): boolean => {
    const words = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean).map(escapeRegex);
    return words.length > 0 && new RegExp(`(^|[^a-z0-9])${words.join('\\s+')}(s|es|ed|ing)?([^a-z0-9]|$)`, 'i').test(text);
};

const compile = (pattern: string | undefined): RegExp | undefined => {
    if (!pattern) {
        return undefined;
    }
    try {
        return new RegExp(pattern, 'i');
    } catch {
        return undefined;
    }
};

/** Error-looking lines of terminal output (newest last), for errorRegex matching. */
export const terminalErrorLines = (output: string): string[] =>
    output.split(/\r?\n/).map(l => l.trim()).filter(l => l && TERMINAL_ERROR_LINE.test(l)).slice(-MAX_TERMINAL_ERROR_LINES);

/**
 * Scores one habit against a turn: errorRegex against the prompt, attachments, diagnostics and terminal errors
 * (strongest), keywords against the prompt, globs against attached / open files and files with diagnostics.
 */
export const scorePlaybook = (p: Playbook, signals: HabitSignals): PlaybookMatch => {
    const reasons: string[] = [];
    let score = 0;
    const error = compile(p.errorRegex);
    if (error) {
        const where = error.test(signals.prompt) ? 'prompt'
            : signals.attachments && error.test(signals.attachments) ? 'attachment'
                : signals.diagnostics.some(d => error.test(d.message)) ? 'diagnostics'
                    : signals.terminalErrors.some(l => error.test(l)) ? 'terminal' : undefined;
        if (where) {
            score += MATCH_WEIGHTS.error;
            reasons.push(`error in ${where}`);
        }
    }
    const keywords = p.keywords.filter(k => keywordMatches(k, signals.prompt));
    score += keywords.length * MATCH_WEIGHTS.keyword;
    reasons.push(...keywords.map(k => `keyword "${k}"`));
    const files = [...new Set([...signals.files, ...signals.diagnostics.map(d => d.path)])].slice(0, MAX_SIGNAL_FILES);
    const file = p.globs.length ? files.find(f => p.globs.some(g => matchGlob(g, f))) : undefined;
    if (file) {
        score += p.keywords.length || p.errorRegex ? MATCH_WEIGHTS.glob : MATCH_WEIGHTS.globOnly;
        reasons.push(`file ${file}`);
    }
    return { playbook: p, score, reasons };
};

/** Habits that match, best first (ties: more conditions, then name). */
export const matchPlaybooks = (playbooks: readonly Playbook[], signals: HabitSignals): PlaybookMatch[] => {
    const conditions = (p: Playbook): number => p.keywords.length + p.globs.length + (p.errorRegex ? 1 : 0);
    return playbooks.map(p => scorePlaybook(p, signals)).filter(m => m.score >= MIN_MATCH_SCORE)
        .sort((a, b) => b.score - a.score || conditions(b.playbook) - conditions(a.playbook) || a.playbook.name.localeCompare(b.playbook.name));
};

export const bestPlaybook = (playbooks: readonly Playbook[], signals: HabitSignals): PlaybookMatch | undefined => matchPlaybooks(playbooks, signals)[0];

/** "keyword "payments", error in terminal" for the pill's tooltip. */
export const matchReason = (match: PlaybookMatch): string => match.reasons.join(', ');
