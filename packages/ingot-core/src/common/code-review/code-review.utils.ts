import {
    BUGBOT_COMMENT_MARKER, BUGBOT_COMMENT_TITLE, BUGBOT_LOCAL_WORDS, BUGBOT_PROMPT, REVIEW_SEVERITIES, REVIEW_SYSTEM, SEVERITY_ALIASES, SEVERITY_LABELS
} from './code-review.consts';
import type { BugbotRequest, DiffFile, PullRequestRef, ReviewBudget, ReviewFinding, ReviewModel, ReviewOutcome, ReviewSeverity } from './code-review.types';

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const unquote = (path: string): string => path.replace(/^"|"$/g, '');

/** Files of a unified diff (`git diff`, `gh pr diff`) with the new-file line numbers of their added lines. */
export const parseUnifiedDiff = (diff: string): DiffFile[] => {
    const files: DiffFile[] = [];
    let current: { path: string; added: number[]; lines: string[]; deleted: boolean } | undefined;
    let next = 0;
    const flush = (): void => {
        if (current) {
            files.push({ path: current.path, added: current.added, text: current.lines.join('\n'), deleted: current.deleted });
        }
    };
    for (const line of diff.split('\n')) {
        const header = FILE_HEADER.exec(line);
        if (header) {
            flush();
            current = { path: unquote(header[2]), added: [], lines: [line], deleted: false };
            continue;
        }
        if (!current) {
            continue;
        }
        current.lines.push(line);
        if (line.startsWith('+++ ')) {
            const target = line.slice(4).trim();
            current.deleted = target === '/dev/null';
            if (!current.deleted) {
                current.path = unquote(target).replace(/^b\//, '');
            }
            continue;
        }
        if (line.startsWith('--- ')) {
            continue;
        }
        const hunk = HUNK_HEADER.exec(line);
        if (hunk) {
            next = Number(hunk[1]);
        } else if (line.startsWith('+')) {
            current.added.push(next++);
        } else if (line.startsWith(' ')) {
            next++;
        }
    }
    flush();
    return files;
};

/** Packs files into at most `maxCalls` chunks of `maxChunkChars`; the rest is skipped. A huge file is cut to fit. */
export const budgetChunks = (files: readonly DiffFile[], budget: ReviewBudget): { chunks: DiffFile[][]; skipped: string[] } => {
    const chunks: DiffFile[][] = [];
    const skipped: string[] = [];
    let size = 0;
    for (const file of files.filter(f => !f.deleted && f.added.length > 0)) {
        const text = file.text.length > budget.maxChunkChars ? `${file.text.slice(0, budget.maxChunkChars)}\n… (diff cut to fit the review budget)` : file.text;
        const fits = chunks.length > 0 && size + text.length <= budget.maxChunkChars;
        if (!fits && chunks.length >= budget.maxCalls) {
            skipped.push(file.path);
            continue;
        }
        if (!fits) {
            chunks.push([]);
            size = 0;
        }
        chunks[chunks.length - 1].push({ ...file, text });
        size += text.length;
    }
    return { chunks, skipped };
};

export const reviewUserPrompt = (label: string, files: readonly DiffFile[]): string =>
    [`Review this diff (${label}).`, '', ...files.map(file => file.text)].join('\n');

const str = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export const toSeverity = (value: unknown): ReviewSeverity => SEVERITY_ALIASES[str(value).toLowerCase()] ?? 'medium';

/** The added line closest to `line` (models are often a line or two off), or the line itself when the file has none. */
const nearestAdded = (line: number, added: readonly number[]): number => {
    if (!added.length || added.includes(line)) {
        return Math.max(1, line);
    }
    return added.reduce((best, candidate) => Math.abs(candidate - line) < Math.abs(best - line) ? candidate : best, added[0]);
};

const matchFile = (path: string, files: readonly DiffFile[]): DiffFile | undefined => {
    const clean = path.replace(/^\.?\//, '').replace(/^[ab]\//, '');
    return files.find(file => file.path === clean) ?? files.find(file => file.path.endsWith(`/${clean}`) || clean.endsWith(`/${file.path}`));
};

/** Findings from the model's reply; entries for files outside the diff or without a title are dropped. */
export const parseFindings = (text: string, files: readonly DiffFile[], idPrefix = 'f'): ReviewFinding[] => {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) {
        return [];
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text.slice(start, end + 1));
    } catch {
        return [];
    }
    if (!Array.isArray(raw)) {
        return [];
    }
    const findings: ReviewFinding[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const entry = item as Record<string, unknown>;
        const file = matchFile(str(entry.path) || str(entry.file), files);
        const title = str(entry.title) || str(entry.message);
        if (!file || !title) {
            continue;
        }
        const line = nearestAdded(Math.floor(Number(entry.line)) || file.added[0] || 1, file.added);
        findings.push({ id: `${idPrefix}-${findings.length + 1}`, path: file.path, line, severity: toSeverity(entry.severity), title, detail: str(entry.detail) || str(entry.description) });
    }
    return findings;
};

const severityRank = (severity: ReviewSeverity): number => REVIEW_SEVERITIES.indexOf(severity);

/** Most severe first, then by file and line; one finding per file, line and title. */
export const sortFindings = (findings: readonly ReviewFinding[]): ReviewFinding[] => {
    const seen = new Set<string>();
    return [...findings]
        .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.path.localeCompare(b.path) || a.line - b.line)
        .filter(finding => {
            const key = `${finding.path}:${finding.line}:${finding.title.toLowerCase()}`;
            return seen.has(key) ? false : (seen.add(key), true);
        });
};

/** Reviews a diff in at most `budget.maxCalls` capped model calls. A failed call is reported, the others still count. */
export const reviewDiff = async (diff: string, label: string, model: ReviewModel, budget: ReviewBudget, guidance = ''): Promise<ReviewOutcome> => {
    const system = guidance.trim() ? `${REVIEW_SYSTEM}\n\n${guidance.trim()}` : REVIEW_SYSTEM;
    const files = parseUnifiedDiff(diff);
    const { chunks, skipped } = budgetChunks(files, budget);
    const findings: ReviewFinding[] = [];
    const errors: string[] = [];
    let calls = 0;
    for (const [index, chunk] of chunks.entries()) {
        calls++;
        try {
            const reply = await model.complete(system, reviewUserPrompt(label, chunk), budget.maxTokens);
            findings.push(...parseFindings(reply, chunk, `f${index + 1}`));
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    return {
        findings: sortFindings(findings).slice(0, budget.maxFindings),
        reviewedFiles: chunks.flat().map(file => file.path),
        skippedFiles: skipped,
        calls,
        errors
    };
};

/** `12`, `#12` or `https://github.com/owner/repo/pull/12`. */
export const parsePullRequestRef = (input: string): PullRequestRef | undefined => {
    const text = input.trim();
    const url = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/i.exec(text);
    if (url) {
        return { number: Number(url[2]), repo: url[1] };
    }
    const bare = /^#?(\d+)$/.exec(text);
    return bare ? { number: Number(bare[1]) } : undefined;
};

/** The chat prompt behind "Fix with agent". */
export const fixPrompt = (finding: ReviewFinding): string => [
    `Fix this code review finding in ${finding.path} at line ${finding.line} (${finding.severity}): ${finding.title}`,
    finding.detail,
    'Read the file first, keep the change minimal, and do not change unrelated code.'
].filter(Boolean).join('\n\n');

export const severityCounts = (findings: readonly ReviewFinding[]): Record<ReviewSeverity, number> => {
    const counts: Record<ReviewSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    findings.forEach(finding => counts[finding.severity]++);
    return counts;
};

/** `/bugbot …` from the chat: a pull request, the local changes, or extra instructions; undefined for other prompts. */
export const parseBugbotPrompt = (prompt: string): BugbotRequest | undefined => {
    const match = BUGBOT_PROMPT.exec(prompt.trim());
    if (!match) {
        return undefined;
    }
    const args = (match[1] ?? '').trim();
    const ref = args.replace(/^(?:pr|pull request|pull)\s+/i, '');
    if (parsePullRequestRef(ref)) {
        return { kind: 'pr', ref };
    }
    return BUGBOT_LOCAL_WORDS.includes(args.toLowerCase()) ? { kind: 'local' } : { kind: 'instructions', text: args };
};

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** The pull request comment: a summary line and one table row per finding, most severe first. */
export const bugbotCommentBody = (label: string, findings: readonly ReviewFinding[], reviewedFiles: readonly string[], model?: string): string => {
    const counts = severityCounts(findings);
    const summary = findings.length
        ? `Found ${findings.length} issue${findings.length === 1 ? '' : 's'} (${REVIEW_SEVERITIES.filter(s => counts[s]).map(s => `${counts[s]} ${SEVERITY_LABELS[s].toLowerCase()}`).join(', ')}) in ${label}.`
        : `No problems found in ${reviewedFiles.length} file${reviewedFiles.length === 1 ? '' : 's'} of ${label}.`;
    const rows = sortFindings(findings).map(f => `| ${SEVERITY_LABELS[f.severity]} | \`${cell(f.path)}:${f.line}\` | **${cell(f.title)}**${f.detail ? ` ${cell(f.detail)}` : ''} |`);
    return [
        BUGBOT_COMMENT_MARKER, BUGBOT_COMMENT_TITLE, '', summary,
        ...(rows.length ? ['', '| Severity | Where | Finding |', '| --- | --- | --- |', ...rows] : []),
        '', `<sub>Reviewed by Ingot${model ? ` with ${model}` : ''}. Findings are suggestions; check them before changing code.</sub>`
    ].join('\n');
};
