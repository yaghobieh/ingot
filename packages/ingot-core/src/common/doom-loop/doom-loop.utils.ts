import { slugify } from '../project-config/project-config.utils';
import { today } from '../decisions/decisions.utils';
import {
    ANSI, ANTI_HABIT_LINE, ANTI_HABIT_PREFIX, ANTI_HABITS_INTRO, ANTI_HABITS_TITLE, ERROR_LINE, MAX_ACTION_CHARS, MAX_ANTI_HABITS, MAX_FALSE_CLAIMS, MAX_PROMPT_ANTI_HABITS,
    MAX_SIGNATURE_CHARS, MAX_TRIED_LINES, SUCCESS_CLAIM
} from './doom-loop.consts';
import type { AntiHabit, DoomAttempt, DoomResult, DoomState, DoomVerdict } from './doom-loop.types';

const HASH_SEED = 5381;
const HASH_SHIFT = 5;
const HASH_RADIX = 36;
const META_SEPARATOR = ';';
const LIST_SEPARATOR = ',';

const clip = (text: string, max: number): string => {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export const startDoom = (): DoomState => ({ attempts: [], hashes: {}, falseClaims: [] });

/**
 * What an error "is", without the parts that change between tries: the first line that names a failure (or the last
 * line), with paths, numbers and addresses replaced.
 */
export const errorSignature = (output: string): string => {
    const lines = output.replace(ANSI, '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^(?:exit code|exited with code)\b/i.test(l) && !/^error:?$/i.test(l));
    const line = lines.find(l => ERROR_LINE.test(l)) ?? lines[lines.length - 1] ?? '';
    return clip(line
        .replace(/^error:\s*(?=\S)/i, '')
        .replace(/(?:[A-Za-z]:)?(?:[\w.@-]*[\\/])+[\w.@-]+(?::\d+)*/g, '<path>')
        .replace(/0x[0-9a-f]+/gi, 'N')
        .replace(/-?\d+(?:\.\d+)?/g, 'N')
        .toLowerCase(), MAX_SIGNATURE_CHARS);
};

const hash = (text: string): string => {
    let h = HASH_SEED;
    for (let i = 0; i < text.length; i++) {
        h = ((h << HASH_SHIFT) + h + text.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(HASH_RADIX);
};

/** The sentence of a reply that claims success, if any. */
export const successClaim = (reply: string): string | undefined => {
    const sentence = reply.split(/(?<=[.!?])\s+|\n+/).find(s => SUCCESS_CLAIM.test(s));
    return sentence ? clip(sentence, MAX_ACTION_CHARS) : undefined;
};

export const observeReply = (state: DoomState, reply: string): DoomState => ({ ...state, claim: successClaim(reply) });

/** An edit landed; a file put back to an earlier (not the latest) version marks a fix → break cycle. */
export const observeEdit = (state: DoomState, path: string, content: string): DoomState => {
    const seen = state.hashes[path] ?? [];
    const h = hash(content);
    const back = seen.slice(0, -1).includes(h) && seen[seen.length - 1] !== h;
    const attempt: DoomAttempt = { action: `Edited ${path}`, files: [path], failed: false };
    return { ...state, hashes: { ...state.hashes, [path]: [...seen, h] }, attempts: [...state.attempts, attempt], ...(back ? { oscillated: path } : {}) };
};

/** A command, check or tool finished; a failure right after a "fixed" claim disproves the claim. */
export const observeResult = (state: DoomState, result: DoomResult): DoomState => {
    const signature = result.failed ? errorSignature(result.output) : undefined;
    const attempt: DoomAttempt = { action: clip(result.action, MAX_ACTION_CHARS), files: [], failed: result.failed, ...(signature ? { signature } : {}) };
    const disproved = state.claim && result.failed ? [...state.falseClaims, state.claim] : state.falseClaims;
    return { ...state, attempts: [...state.attempts, attempt], claim: undefined, falseClaims: disproved };
};

const collapse = (items: readonly string[]): string[] => items.filter((s, i) => s !== items[i - 1]);

const triedLines = (attempts: readonly DoomAttempt[]): string[] => {
    const lines = collapse(attempts.map(a => a.failed ? `${a.action} → "${a.signature ?? 'failed'}"` : a.files.length ? a.action : `${a.action} → ok`));
    return lines.slice(-MAX_TRIED_LINES);
};

const approachOf = (state: DoomState, signature: string | undefined): { approach: string; files: string[] } => {
    const files = [...new Set(state.attempts.flatMap(a => a.files))];
    const actions = [...new Set(state.attempts.filter(a => !a.files.length).map(a => a.action))];
    const did = [files.length ? `Editing ${files.join(', ')}` : '', actions.length ? `${files.length ? 'then ' : ''}${actions.join(', ')}` : ''].filter(Boolean).join(' ');
    return { approach: clip(`${did || 'Retrying'}${signature ? ` while "${signature}" kept failing` : ''}`, MAX_SIGNATURE_CHARS * 2), files };
};

/** Whether the run is going in circles: the same error `maxRepeats` times, a fix → break cycle, or disproved claims. */
export const detectDoom = (state: DoomState, maxRepeats: number): DoomVerdict | undefined => {
    const failures = state.attempts.filter(a => a.failed && a.signature).map(a => a.signature!);
    const last = failures[failures.length - 1];
    const tried = triedLines(state.attempts);
    const repeats = last ? failures.filter(s => s === last).length : 0;
    if (last && repeats >= maxRepeats) {
        return { kind: 'repeat', reason: `The same error came back ${repeats} times: "${last}".`, signature: last, tried, ...approachOf(state, last) };
    }
    const seq = collapse(failures);
    const n = seq.length;
    if (n >= 3 && seq[n - 1] === seq[n - 3]) {
        return {
            kind: 'cycle', reason: `Fixing one error brought back another that was already fixed ("${seq[n - 3]}" → "${seq[n - 2]}" → "${seq[n - 1]}").`,
            signature: seq[n - 1], tried, ...approachOf(state, seq[n - 1])
        };
    }
    if (state.oscillated) {
        return { kind: 'cycle', reason: `${state.oscillated} was put back to a version that had already been tried.`, ...(last ? { signature: last } : {}), tried, ...approachOf(state, last) };
    }
    if (state.falseClaims.length >= MAX_FALSE_CLAIMS) {
        return {
            kind: 'claims', reason: `The agent said it was fixed ${state.falseClaims.length} times, but the next run failed each time.`,
            ...(last ? { signature: last } : {}), tried, ...approachOf(state, last)
        };
    }
    return undefined;
};

/** The hidden message for "Try a different approach". */
export const differentApproachNudge = (verdict: DoomVerdict): string =>
    `Stop repeating the last approach. ${verdict.reason}\nWhat was tried:\n${verdict.tried.map(t => `- ${t}`).join('\n')}\nDo not do that again. Re-read the error and the code, say in one sentence what you now think the cause is, then try a different fix.`;

const parseMeta = (raw: string | undefined): Record<string, string> => Object.fromEntries((raw ?? '').split(META_SEPARATOR)
    .map(part => part.split('='))
    .filter(pair => pair.length >= 2 && pair[0].trim())
    .map(([key, ...value]) => [key.trim(), value.join('=').trim()]));

export const parseAntiHabits = (text: string | undefined): AntiHabit[] => (text ?? '').split(/\r?\n/).flatMap(line => {
    const match = /^\s*[-*]\s/.test(line) ? ANTI_HABIT_LINE.exec(line) : null;
    if (!match?.[1].trim()) {
        return [];
    }
    const meta = parseMeta(match[2]);
    const count = Number(meta.count);
    const habit: AntiHabit = {
        id: meta.id || slugify(match[1]) || 'anti-habit', text: match[1].trim(), files: (meta.files ?? '').split(LIST_SEPARATOR).map(f => f.trim()).filter(Boolean),
        count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 1, at: meta.at ?? '', ...(meta.signature ? { signature: meta.signature } : {})
    };
    return [habit];
});

export const serializeAntiHabits = (habits: readonly AntiHabit[]): string => {
    const lines = habits.map(h => {
        const meta = [`id=${h.id}`, ...(h.signature ? [`signature=${h.signature.replace(/[;=]|-->/g, ' ')}`] : []), `files=${h.files.join(LIST_SEPARATOR)}`, `count=${h.count}`, ...(h.at ? [`at=${h.at}`] : [])];
        return `- ${ANTI_HABIT_PREFIX}${h.text.replace(/<!--|-->/g, '')} <!-- ${meta.join(`${META_SEPARATOR} `)} -->`;
    });
    return `${ANTI_HABITS_TITLE}\n\n${ANTI_HABITS_INTRO}\n\n${lines.join('\n')}${lines.length ? '\n' : ''}`;
};

const sameKey = (a: Pick<AntiHabit, 'signature' | 'files'>, b: Pick<AntiHabit, 'signature' | 'files'>): boolean =>
    (a.signature ?? '') === (b.signature ?? '') && [...a.files].sort().join(LIST_SEPARATOR) === [...b.files].sort().join(LIST_SEPARATOR);

/** Saves the failed approach; the same error on the same files counts up instead of adding a line. */
export const recordAntiHabit = (habits: readonly AntiHabit[], verdict: DoomVerdict, now: number): { habits: AntiHabit[]; habit: AntiHabit } => {
    const signature = verdict.signature?.replace(/[;=]|-->/g, ' ');
    const probe = { signature, files: verdict.files };
    const existing = habits.find(h => sameKey(h, probe));
    if (existing) {
        const habit = { ...existing, text: verdict.approach, count: existing.count + 1 };
        return { habits: habits.map(h => h === existing ? habit : h), habit };
    }
    const base = slugify(verdict.approach) || 'anti-habit';
    let id = base;
    for (let n = 2; habits.some(h => h.id === id); n++) {
        id = `${base}-${n}`;
    }
    const habit: AntiHabit = { id, text: verdict.approach, files: verdict.files, count: 1, at: today(now), ...(signature ? { signature } : {}) };
    return { habits: [...habits, habit].slice(-MAX_ANTI_HABITS), habit };
};

/** System prompt section: approaches that already failed in this project. */
export const formatAntiHabits = (habits: readonly AntiHabit[]): string => habits.length
    ? `Don't do this here (approaches that already failed in this project, .ingot/anti-habits.md):\n${habits.slice(-MAX_PROMPT_ANTI_HABITS).map(h => `- ${h.text}`).join('\n')}`
    : '';
