import type { ChatMessage } from '../models/models.types';

/** IDEA-176 Commit with AI: how much diff goes to the model, and how many tokens the reply may use. */
export const MAX_AI_DIFF_CHARS = 12_000;
/** Per file, so one huge file cannot crowd out the rest. */
export const MAX_AI_FILE_CHARS = 4_000;
export const AI_COMMIT_MAX_TOKENS = 160;
export const AI_COMMIT_FEATURE = 'commit_message';
export const TRUNCATED_MARK = '… (diff truncated)';

export const AI_COMMIT_TEXT = {
    button: 'Commit with AI: write the message from the staged changes',
    generating: 'Writing the commit message… (click to stop)',
    signedOut: 'Sign in to use Commit with AI.',
    offline: "Can't reach the Ingot server. Check your connection and try again.",
    noChanges: 'There are no changes to describe.',
    noModel: 'No model is ready for Commit with AI. Sign in or add a model in Settings › Models.',
    empty: 'The model returned an empty message. Try again.'
} as const;

export const AI_COMMIT_SYSTEM_PROMPT = [
    'You write git commit messages.',
    'Reply with only the commit message: no quotes, no code fences, no preamble.',
    'First line: imperative mood, at most 72 characters, no trailing period.',
    'If the change needs it, add a blank line and up to 4 short "- " bullet lines on what changed and why.',
    'Never invent changes that are not in the diff.'
].join(' ');

export interface TruncatedDiff {
    readonly text: string;
    readonly truncated: boolean;
}

/** Splits a unified diff into per-file chunks (each starting with `diff --git`). */
export const splitDiffFiles = (diff: string): string[] => {
    const parts = diff.split(/^(?=diff --git )/m).filter(p => p.trim());
    return parts.length ? parts : diff.trim() ? [diff] : [];
};

/** Caps each file, then the whole diff, keeping file headers so the model still sees every file. */
export const truncateDiff = (diff: string, max = MAX_AI_DIFF_CHARS, perFile = MAX_AI_FILE_CHARS): TruncatedDiff => {
    let truncated = false;
    const files = splitDiffFiles(diff).map(f => {
        if (f.length <= perFile) {
            return f;
        }
        truncated = true;
        return `${f.slice(0, perFile).replace(/\n[^\n]*$/, '')}\n${TRUNCATED_MARK}\n`;
    });
    let text = '';
    for (const f of files) {
        if (text.length + f.length > max) {
            truncated = true;
            const header = f.split('\n', 1)[0];
            if (text.length + header.length + TRUNCATED_MARK.length + 2 > max) {
                break;
            }
            text += `${header}\n${TRUNCATED_MARK}\n`;
            continue;
        }
        text += f;
    }
    return { text, truncated };
};

/** A new (unversioned) file as a diff, so the model sees its content like any other change. */
export const newFileDiff = (path: string, content: string): string => {
    const lines = content.replace(/\n$/, '').split('\n');
    return `diff --git a/${path} b/${path}\nnew file\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => `+${l}`).join('\n')}\n`;
};

export const commitMessagePrompt = (diff: TruncatedDiff, branch?: string): ChatMessage[] => [
    { role: 'system', content: AI_COMMIT_SYSTEM_PROMPT },
    {
        role: 'user',
        content: `${branch ? `Branch: ${branch}\n` : ''}${diff.truncated ? 'The diff below was shortened; describe what is visible.\n' : ''}Write the commit message for this diff:\n\n${diff.text}`
    }
];

/** Strips what models sometimes add around the message: fences, quotes, a "Commit message:" label. */
export const cleanCommitMessage = (text: string): string => {
    let out = text.replace(/\r\n/g, '\n').trim();
    out = out.replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '').trim();
    out = out.replace(/^(?:commit message|message)\s*:\s*/i, '').trim();
    out = out.replace(/^#{1,6}\s+/, '');
    if (/^["'`].*["'`]$/s.test(out) && !out.slice(1, -1).includes(out[0])) {
        out = out.slice(1, -1).trim();
    }
    return out;
};

/** Friendly text for gateway failures: signed out, offline, out of tokens, anything else as-is. */
export const aiCommitError = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    if (/sign in|not signed|unauthori[sz]ed|\b401\b/i.test(message)) {
        return AI_COMMIT_TEXT.signedOut;
    }
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|offline|timed? ?out|aborted due to timeout/i.test(message)) {
        return AI_COMMIT_TEXT.offline;
    }
    return message || AI_COMMIT_TEXT.empty;
};
