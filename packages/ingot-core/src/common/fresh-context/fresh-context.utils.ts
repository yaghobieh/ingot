import { lineDiff } from '../diff/diff.utils';
import { slugify } from '../project-config/project-config.utils';
import {
    BRIEF_INTRO, CONTINUE_PROMPT, FRESH_TITLE_SUFFIX, HANDOFFS_DIR, MAX_BRIEF_FAILURES, MAX_BRIEF_TEXT_CHARS, MAX_DECISIONS_CHARS, MAX_DIFF_CHARS, MAX_SLUG_CHARS, REOFFER_TURNS
} from './fresh-context.consts';
import type { BriefInput, RotLimits, RotReason, RotSignals, RotVerdict } from './fresh-context.types';

interface ChatLine {
    readonly role: string;
    readonly text: string;
    readonly hidden?: boolean;
    readonly tool?: { readonly state: string };
}

const PERCENT = 100;
const FAILED_SYSTEM = /^(The model request failed|The agent stopped|Stopped after \d+ failed)/;

export const clip = (text: string, max: number): string => text.length > max ? `${text.slice(0, max - 1)}…` : text;

export const countTurns = (messages: readonly ChatLine[]): number => messages.filter(m => m.role === 'user' && !m.hidden).length;

const isFailure = (m: ChatLine): boolean =>
    (m.role === 'tool' && (m.tool?.state === 'error' || m.text.startsWith('Error:'))) || (m.role === 'system' && FAILED_SYSTEM.test(m.text));

/** Failures since the user last spoke: failed tool calls and checks, failed model requests. */
export const countFailures = (messages: readonly ChatLine[]): number => {
    const last = messages.map(m => m.role === 'user' && !m.hidden).lastIndexOf(true);
    return messages.slice(last + 1).filter(isFailure).length;
};

/** The first line of each recent failure, newest last. */
export const recentFailures = (messages: readonly ChatLine[], max = MAX_BRIEF_FAILURES): string[] =>
    messages.filter(isFailure).slice(-max).map(m => clip(m.text.replace(/^Error:\s*/, '').split('\n')[0].trim(), MAX_BRIEF_TEXT_CHARS));

export const detectRot = (signals: RotSignals, limits: RotLimits): RotVerdict | undefined => {
    const reasons: RotReason[] = [];
    if (signals.failures >= limits.failures) {
        reasons.push('failures');
    }
    if (signals.turns >= limits.turns) {
        reasons.push('turns');
    }
    if (signals.ratio >= limits.ratio) {
        reasons.push('tokens');
    }
    return reasons.length ? { reasons, signals } : undefined;
};

/** "3 failed attempts · 14 turns · 72% of context" (only the reasons that tripped). */
export const rotSummary = (verdict: RotVerdict): string => verdict.reasons.map(r =>
    r === 'failures' ? `${verdict.signals.failures} failed attempt${verdict.signals.failures === 1 ? '' : 's'}`
        : r === 'turns' ? `${verdict.signals.turns} turns`
            : `${Math.round(verdict.signals.ratio * PERCENT)}% of context`).join(' · ');

/** After "Not now" at `dismissedAt` turns: offer again REOFFER_TURNS later, or at once for a failure streak. */
export const offerAllowed = (verdict: RotVerdict, dismissedAt: number | undefined): boolean =>
    dismissedAt === undefined || verdict.reasons.includes('failures') || verdict.signals.turns >= dismissedAt + REOFFER_TURNS;

/** "Fix the cart (fresh)", also when the chat was a fresh one already. */
export const freshTitle = (title: string): string => `${title.endsWith(FRESH_TITLE_SUFFIX) ? title.slice(0, -FRESH_TITLE_SUFFIX.length) : title}${FRESH_TITLE_SUFFIX}`;

/** `.ingot/handoffs/2026-10-31T06-08-12-fix-the-cart-total.md` */
export const briefPath = (title: string, now: Date): string => {
    const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
    const slug = slugify(title).slice(0, MAX_SLUG_CHARS).replace(/-+$/, '') || 'chat';
    return `${HANDOFFS_DIR}/${stamp}-${slug}.md`;
};

const section = (title: string, body: string): string => `## ${title}\n\n${body.trim()}\n`;

/** The distilled brief: goal, plan, decisions, what changed, what failed and where the old chat stopped. */
export const buildBrief = (input: BriefInput): string => {
    const plan = input.plan.length ? input.plan.map(p => `- [${p.done ? 'x' : ' '}] ${p.text}`).join('\n') : 'No plan was written in the old chat.';
    const decisions = input.decisions?.trim() ? clip(input.decisions.trim(), MAX_DECISIONS_CHARS) : 'No .ingot/decisions.md in this project.';
    const files = input.files.length ? input.files.map(f => `- \`${f}\``).join('\n') : 'No files changed yet.';
    const diff = input.diff.trim() ? `\n\n\`\`\`diff\n${clip(input.diff.trim(), MAX_DIFF_CHARS)}\n\`\`\`` : '';
    const failures = input.failures.length ? input.failures.map(f => `- ${f}`).join('\n') : 'None.';
    return [
        `# Handoff brief: ${input.title}`,
        '',
        `Saved ${input.savedAt} from the chat "${input.title}" (${rotSummary(input.verdict) || 'handed off by hand'}).`,
        '',
        section('Goal', clip(input.goal || input.title, MAX_BRIEF_TEXT_CHARS)),
        ...(input.latest && input.latest !== input.goal ? [section('Latest request', clip(input.latest, MAX_BRIEF_TEXT_CHARS))] : []),
        section('Plan', plan),
        section('Decisions', decisions),
        section('Changes so far', `${files}${diff}`),
        section('Recent failures', failures),
        section('Where it stopped', clip(input.lastReply || 'The old chat had not replied yet.', MAX_BRIEF_TEXT_CHARS)),
        section('Next', 'Pick up from "Where it stopped". Do not repeat what failed; try a different approach and verify it.')
    ].join('\n');
};

/** A compact diff of the chat's changes (no context lines) for the brief. */
export const changesDiff = (changes: readonly { readonly path: string; readonly oldText: string; readonly newText: string }[]): string =>
    changes.map(c => [
        `--- a/${c.path}`, `+++ b/${c.path}`,
        ...lineDiff(c.oldText, c.newText).flatMap(h => [
            `@@ -${h.oldStart + 1},${h.removed.length} +${h.newStart + 1},${h.added.length} @@`, ...h.removed.map(l => `-${l}`), ...h.added.map(l => `+${l}`)
        ])
    ].join('\n')).join('\n');

/** What the fresh chat's model sees as its first user turn. */
export const briefPrompt = (path: string, brief: string): string => `${BRIEF_INTRO}\n\nBrief (${path}):\n\n${brief}\n\n${CONTINUE_PROMPT}`;
