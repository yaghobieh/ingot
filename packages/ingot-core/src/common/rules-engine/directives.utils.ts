import {
    DIRECTIVE_ARTICLES, DIRECTIVE_CLAUSE, DIRECTIVE_FILLER, DIRECTIVE_VERBS, EXCLUSIVE_CHOICES, MAX_DIRECTIVE_WORDS,
    MIN_DIRECTIVE_CHARS, NEGATIVE_DIRECTIVE, POSITIVE_DIRECTIVE
} from './rules-engine.consts';
import type { Directive, DirectiveConflict, RuleDoc } from './rules-engine.types';

const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const FENCE = /^\s*(```|~~~)/;
const MARKUP = /[`*_]+/g;
const SENTENCE_END = /(?<=[.!?;])\s+/;
const TRAILING_PUNCTUATION = /[.!?]+$/;
const MIN_PLURAL_WORD = 4;

/** "Never use tabs for indentation." → "tabs". */
export const directiveObject = (rest: string): string => {
    let object = rest.trim().replace(TRAILING_PUNCTUATION, '');
    for (let i = 0; i < 2; i++) {
        object = object.replace(DIRECTIVE_VERBS, '');
    }
    return object.replace(DIRECTIVE_CLAUSE, '').replace(DIRECTIVE_ARTICLES, '').replace(TRAILING_PUNCTUATION, '').replace(/\s+/g, ' ').trim().toLowerCase();
};

/** Comparison key: plural-insensitive ("tabs" = "tab"). */
export const objectKey = (object: string): string =>
    object.split(' ').map(w => w.length >= MIN_PLURAL_WORD && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w).join(' ');

/** Sentences of a rule body that ask for (+1) or forbid (-1) something, with their file line. */
export const extractDirectives = (body: string, bodyLine = 0): Directive[] => {
    const directives: Directive[] = [];
    let fenced = false;
    body.split('\n').forEach((raw, i) => {
        if (FENCE.test(raw)) {
            fenced = !fenced;
            return;
        }
        const line = raw.replace(LIST_MARKER, '').trim();
        if (fenced || !line || line.startsWith('#') || line.startsWith('|') || line.startsWith('>')) {
            return;
        }
        for (const sentence of line.replace(MARKUP, '').split(SENTENCE_END)) {
            let text = sentence.trim();
            while (DIRECTIVE_FILLER.test(text)) {
                text = text.replace(DIRECTIVE_FILLER, '');
            }
            const negative = NEGATIVE_DIRECTIVE.exec(text);
            const positive = negative ? undefined : POSITIVE_DIRECTIVE.exec(text);
            const match = negative ?? positive;
            if (!match) {
                continue;
            }
            const object = directiveObject(match[1]);
            if (object.length >= MIN_DIRECTIVE_CHARS && object.split(' ').length <= MAX_DIRECTIVE_WORDS) {
                directives.push({ polarity: negative ? -1 : 1, object, text: sentence.trim(), line: bodyLine + i });
            }
        }
    });
    return directives;
};

export const docDirectives = (doc: RuleDoc): Directive[] => extractDirectives(doc.body, doc.bodyLine);

/** Which option of an exclusive choice an object names (group, option), when it names exactly one. */
const choiceOf = (object: string): { group: number; option: number } | undefined => {
    for (let group = 0; group < EXCLUSIVE_CHOICES.length; group++) {
        const options = EXCLUSIVE_CHOICES[group].map((o, option) => ({ option, hit: o.test.test(object) })).filter(o => o.hit);
        if (options.length === 1) {
            return { group, option: options[0].option };
        }
    }
    return undefined;
};

/** Contradictions between two directive lists: "use tabs" vs "never use tabs", or "use tabs" vs "use 2 spaces". */
export const findDirectiveConflicts = (left: readonly Directive[], right: readonly Directive[]): DirectiveConflict[] => {
    const conflicts: DirectiveConflict[] = [];
    for (const a of left) {
        for (const b of right) {
            if (a.polarity !== b.polarity && objectKey(a.object) === objectKey(b.object)) {
                conflicts.push({ a, b, reason: 'opposite' });
                continue;
            }
            if (a.polarity === 1 && b.polarity === 1) {
                const ca = choiceOf(a.object);
                const cb = choiceOf(b.object);
                if (ca && cb && ca.group === cb.group && ca.option !== cb.option) {
                    conflicts.push({ a, b, reason: 'exclusive' });
                }
            }
        }
    }
    return conflicts;
};

/** Lines worth comparing for duplicates: list markers and markup stripped, lower-case, one space. */
export const normalizedLines = (body: string, bodyLine = 0): { key: string; line: number; text: string }[] =>
    body.split('\n').map((raw, i) => ({ key: raw.replace(LIST_MARKER, '').replace(MARKUP, '').replace(/\s+/g, ' ').trim().toLowerCase(), line: bodyLine + i, text: raw.trim() }))
        .filter(l => l.key && !l.key.startsWith('#') && !FENCE.test(l.key));
