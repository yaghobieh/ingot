import type { ReviewBudget, ReviewSeverity } from './code-review.types';

export const CODE_REVIEW_SERVICE_PATH = '/services/ingot-code-review';

export const REVIEW_SEVERITIES: readonly ReviewSeverity[] = ['critical', 'high', 'medium', 'low'];

export const SEVERITY_LABELS: Record<ReviewSeverity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

/** Words models use for severities, mapped to ours. */
export const SEVERITY_ALIASES: Readonly<Record<string, ReviewSeverity>> = {
    critical: 'critical', blocker: 'critical', severe: 'critical',
    high: 'high', error: 'high', major: 'high', bug: 'high',
    medium: 'medium', warning: 'medium', moderate: 'medium',
    low: 'low', info: 'low', minor: 'low', nit: 'low', suggestion: 'low'
};

/** LSP `DiagnosticSeverity`: Error 1, Warning 2, Information 3. */
export const SEVERITY_DIAGNOSTIC: Record<ReviewSeverity, 1 | 2 | 3> = { critical: 1, high: 1, medium: 2, low: 3 };

/** Owner and `source` of the editor diagnostics. */
export const REVIEW_DIAGNOSTIC_OWNER = 'ingot-code-review';
export const REVIEW_DIAGNOSTIC_SOURCE = 'Ingot Review';

/** Budget caps: at most three capped calls per review. */
export const REVIEW_BUDGET: ReviewBudget = { maxChunkChars: 24_000, maxCalls: 3, maxTokens: 1_500, maxFindings: 40 };

export const REVIEW_SYSTEM = [
    'You are a careful senior code reviewer. Review only the added or changed lines (lines starting with "+") of the diff.',
    'Report real problems: bugs, crashes, security issues, data loss, race conditions, wrong logic, missing error handling. Skip style nits and praise.',
    'Reply with JSON only: an array of findings, each {"path": "<file path from the diff>", "line": <line number in the new file>, "severity": "critical" | "high" | "medium" | "low", "title": "<short summary>", "detail": "<why it is wrong and how to fix it>"}.',
    'Reply [] when there is nothing worth fixing.'
].join('\n');

export const LOCAL_CHANGES_LABEL = 'Local changes';
export const NO_CHANGES_TEXT = 'No changes to review.';

/** Untracked files added to the local diff (new files the agent or the user created). */
export const MAX_UNTRACKED_FILES = 50;
export const DIFF_MAX_BUFFER = 20 * 1024 * 1024;
export const DIFF_TIMEOUT_MS = 30_000;

export const GITHUB_API_URL = 'https://api.github.com';
export const GITHUB_DIFF_MEDIA_TYPE = 'application/vnd.github.v3.diff';
export const GITHUB_JSON_MEDIA_TYPE = 'application/vnd.github+json';
/** Overrides for tests and GitHub Enterprise. */
export const GH_BIN_ENV = 'INGOT_GH_BIN';
export const GITHUB_API_ENV = 'INGOT_GITHUB_API_URL';
export const GITHUB_TOKEN_ENVS: readonly string[] = ['GH_TOKEN', 'GITHUB_TOKEN'];
/** The GitHub MCP server's token (Settings › MCP), reused read-only for PR diffs. */
export const GITHUB_MCP_SERVER = 'github';
export const GITHUB_MCP_TOKEN = 'GITHUB_PERSONAL_ACCESS_TOKEN';

export const PR_HELP = 'Enter a pull request number (#12) or URL (https://github.com/owner/repo/pull/12).';
export const PR_NO_ACCESS = 'Could not read the pull request. Sign in to the GitHub CLI (gh auth login), set GH_TOKEN, or add a token to the GitHub MCP server.';

/** IDEA-287: `/bugbot` in the chat runs this review; with a PR (#12, `pr 12`, a URL) it reviews the pull request. */
export const BUGBOT_SLASH = 'bugbot';
export const BUGBOT_PROMPT = /^\/bugbot(?:\s+([\s\S]*))?$/i;
export const BUGBOT_LOCAL_WORDS: readonly string[] = ['', 'run', 'local', 'review'];
export const BUGBOT_AUTO_POST_PREF = 'ingot.review.bugbot.postToGitHub';
/** Marks Ingot's comment on a pull request. */
export const BUGBOT_COMMENT_MARKER = '<!-- ingot-bugbot -->';
export const BUGBOT_COMMENT_TITLE = '## Ingot Bugbot review';
export const BUGBOT_POST_COMMAND = { id: 'ingot.codeReview.postToPr', label: 'Post Review to GitHub PR', category: 'Ingot' } as const;
export const BUGBOT_TEXT = {
    started: 'Bugbot is reviewing',
    panel: 'Findings are in the Review panel and the editor.',
    posted: 'Posted the review to the pull request',
    postHint: 'Use "Post to GitHub PR" in the Review panel to comment on the pull request.',
    noPullRequest: 'Only a pull request review can be posted to GitHub.',
    busy: 'A review is already running.'
} as const;
