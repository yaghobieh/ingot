import { slugify } from '../project-config/project-config.utils';
import { TASK_TYPE_LABELS } from '../router/router.consts';
import type { TaskType } from '../router/router.types';
import {
    MAX_PLAN_SLUG_CHARS, MIN_KEYWORD_CHARS, PATH_TOKEN, PLAN_TEMPLATES_DIR, PLANS_DIR, RUN_STEP, STOPWORDS, TEMPLATE_FILE_PLACEHOLDER, TEMPLATE_NAME_PLACEHOLDER,
    URL_TOKEN
} from './plan-review.consts';
import type { ApprovedPlan, PlanReview, PlanStepReview, RunDiff } from './plan-review.types';

const MAX_EVIDENCE = 3;

/** `.ingot/plans/2026-10-31T06-08-12-fix-the-cart-total.md` */
export const planPath = (title: string, now: Date): string => {
    const stamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
    return `${PLANS_DIR}/${stamp}-${slugify(title).slice(0, MAX_PLAN_SLUG_CHARS).replace(/-+$/, '') || 'plan'}.md`;
};

export const planTemplatePath = (type: TaskType): string => `${PLAN_TEMPLATES_DIR}/${type}.md`;

export const planFileText = (plan: ApprovedPlan): string => [
    '---',
    `title: ${JSON.stringify(plan.title)}`,
    `taskType: ${plan.taskType}`,
    `approvedAt: ${plan.approvedAt}`,
    '---',
    `# Plan: ${plan.title}`,
    '',
    `Request: ${plan.prompt.replace(/\s+/g, ' ').trim()}`,
    '',
    '## Steps',
    '',
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
    ''
].join('\n');

const normalize = (path: string): string => path.trim().replace(/^[`'"(]+|[`'".,:;)]+$/g, '').replace(/^\.\/+/, '');
const baseName = (path: string): string => path.split('/').pop() ?? path;

/** Paths a step names (`src/cart.ts`, cart.test.ts, src/payments/). */
export const stepFiles = (step: string): string[] =>
    [...new Set((step.replace(URL_TOKEN, ' ').match(PATH_TOKEN) ?? []).map(normalize).filter(Boolean))];

/** Words of a step that can describe a file without naming it ("cart", "checkout"). */
export const stepKeywords = (step: string): string[] => {
    const withoutPaths = step.replace(PATH_TOKEN, ' ');
    return [...new Set(withoutPaths.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= MIN_KEYWORD_CHARS && !STOPWORDS.has(w)))];
};

/** Path segments and camelCase words of a file: src/useCart.test.ts → src, use, cart, test, ts. */
const pathWords = (path: string): string[] =>
    path.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const singular = (word: string): string => word.endsWith('s') && word.length > MIN_KEYWORD_CHARS ? word.slice(0, -1) : word;

const fileMatches = (named: string, changed: string): boolean => {
    const a = named.replace(/\/+$/, '');
    return changed === a || changed.endsWith(`/${a}`) || changed.startsWith(`${a}/`) || (!a.includes('/') && baseName(changed) === a);
};

const keywordMatches = (keywords: readonly string[], changed: string): boolean => {
    const words = new Set(pathWords(changed).map(singular));
    return keywords.some(k => words.has(singular(k)));
};

/**
 * Lines the run's diff up with the approved plan: a step is matched when a changed file is one it names (or, for steps
 * that name no file, one its words describe; for "run the tests" steps, a command the run executed). Changed files no
 * step accounts for are out of scope.
 */
export const reviewPlan = (path: string, steps: readonly string[], diff: RunDiff): PlanReview => {
    const files = [...new Set(diff.files.map(normalize).filter(Boolean))];
    const covered = new Set<string>();
    const reviewed: PlanStepReview[] = steps.map(text => {
        const named = stepFiles(text);
        const keywords = stepKeywords(text);
        const byName = files.filter(f => named.some(n => fileMatches(n, f)));
        const byWords = named.length ? [] : files.filter(f => keywordMatches(keywords, f));
        const matchedFiles = [...byName, ...byWords];
        matchedFiles.forEach(f => covered.add(f));
        const ran = !matchedFiles.length && RUN_STEP.test(text) ? diff.commands : [];
        const evidence = [...matchedFiles, ...ran.map(c => `ran ${c}`)].slice(0, MAX_EVIDENCE);
        return { text, state: evidence.length ? 'matched' : 'missing', evidence };
    });
    const outOfScope = files.filter(f => !covered.has(f));
    return { path, steps: reviewed, outOfScope, matched: reviewed.filter(s => s.state === 'matched').length, total: reviewed.length };
};

export const reviewHeadline = (review: Pick<PlanReview, 'matched' | 'total' | 'outOfScope'>): string =>
    `${review.matched} of ${review.total} step${review.total === 1 ? '' : 's'} matched${review.outOfScope.length ? ` · ${review.outOfScope.length} out-of-scope file${review.outOfScope.length === 1 ? '' : 's'}` : ''}`;

/** The review appended to the plan file. */
export const reviewMarkdown = (review: PlanReview, at: string): string => [
    '',
    `## Review (${at})`,
    '',
    reviewHeadline(review),
    '',
    ...review.steps.map(s => `- [${s.state === 'matched' ? 'x' : ' '}] ${s.text}${s.evidence.length ? ` (${s.evidence.join(', ')})` : ' (missing)'}`),
    ...(review.outOfScope.length ? ['', 'Out of scope:', ...review.outOfScope.map(f => `- \`${f}\``)] : []),
    ''
].join('\n');

/** A step with its files and identifiers swapped for placeholders: "Add a test in `src/cart.test.ts`" → "Add a test in <file>". */
export const generalizeStep = (step: string): string =>
    step.replace(/`([^`]+)`/g, (_m, inner: string) => stepFiles(inner).length ? TEMPLATE_FILE_PLACEHOLDER : TEMPLATE_NAME_PLACEHOLDER)
        .replace(PATH_TOKEN, TEMPLATE_FILE_PLACEHOLDER)
        .replace(/\s+/g, ' ').trim();

/** The template a plan teaches: its generalized steps, one per line. */
export const planTemplate = (steps: readonly string[]): string => steps.map(generalizeStep).filter(Boolean).join('\n');

export const templateFileText = (type: TaskType, template: string): string => [
    '---',
    `description: Learned plan template for ${TASK_TYPE_LABELS[type]} tasks (Habits)`,
    `taskType: ${type}`,
    '---',
    ...template.split('\n').map((s, i) => `${i + 1}. ${s}`),
    ''
].join('\n');

/** The Plan-mode system prompt section for a learned template. */
export const templatePrompt = (type: TaskType, template: string): string =>
    `Plan template the user approved before for ${TASK_TYPE_LABELS[type]} tasks (learned in Habits). Shape the PLAN like it, filling in the real files and names:\n${template.split('\n').map(s => `- ${s}`).join('\n')}`;
