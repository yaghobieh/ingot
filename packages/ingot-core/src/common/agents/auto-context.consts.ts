import type { AutoContextKind, DiagnosticSeverity } from './auto-context.types';

/** Chips follow the editor after this pause; the git diff is re-read less often. */
export const AUTO_CONTEXT_DEBOUNCE_MS = 150;
export const DIFF_DEBOUNCE_MS = 1_000;
/** Git is often not ready right after a folder opens; a failed diff is retried this often, this many times. */
export const DIFF_RETRY_MS = 3_000;
export const MAX_DIFF_RETRIES = 10;
/** LSP DiagnosticSeverity → ours; hints are left out. */
export const LSP_SEVERITY_ERROR = 1;
export const LSP_SEVERITY: Record<number, DiagnosticSeverity | undefined> = { 1: 'error', 2: 'warning', 3: 'info' };

/** Lines on each side of the cursor sent from the current file. */
export const FILE_WINDOW_LINES = 40;
export const MAX_SELECTION_CHARS = 8_000;
export const MAX_DIAGNOSTICS = 20;
export const MAX_RECENT_EDITS = 8;
/** Edits older than this are not "recent". */
export const RECENT_EDIT_MS = 30 * 60 * 1000;
export const MAX_EDIT_LINES = 6;
export const MAX_DIFF_CHARS = 12_000;
/** Workspace diagnostics are capped; those in the current file come first. */
export const DIAGNOSTIC_ORDER = { error: 0, warning: 1, info: 2 } as const;

export const AUTO_CONTEXT_ORDER: readonly AutoContextKind[] = ['selection', 'file', 'diagnostics', 'edits', 'diff', 'memory'];

export const AUTO_CONTEXT_ICONS: Record<AutoContextKind, string> = {
    file: 'file', selection: 'selection', diagnostics: 'warning', edits: 'history', diff: 'git-compare', memory: 'lightbulb'
};

export const AUTO_CONTEXT_HEADER = 'IDE context (attached automatically from the editor; use it, and read more with the project tools when needed):';
export const DIFF_TRUNCATED = '… (diff truncated)';
