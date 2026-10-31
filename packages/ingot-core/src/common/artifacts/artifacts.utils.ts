import {
    ARTIFACT_MAX_CHARS, ARTIFACT_NAME_MAX, ARTIFACTS_DIR, COMMENT_PREFIX, MARKDOWN_EXT, PLAN_FILE, PNG_EXT, RUN_TURN_PREFIX, SCREENSHOTS_DIR, STEER_QUOTE_CHARS,
    WALKTHROUGH_FILE, WALKTHROUGH_REPLY_CHARS
} from './artifacts.consts';
import type { ArtifactComment, ArtifactFile, ArtifactRunMeta, MarkdownLine, WalkthroughInput } from './artifacts.types';

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FENCE = /^\s*(```|~~~)/;

/** One folder per chat turn: `<chatId>-r<turn>`. */
export const runIdFor = (sessionId: string, turn: number): string => `${sessionId}-${RUN_TURN_PREFIX}${turn}`;

export const runDir = (runId: string): string => `${ARTIFACTS_DIR}/${runId}`;

export const isSafeRunId = (runId: string): boolean => SAFE_SEGMENT.test(runId) && runId.length <= ARTIFACT_NAME_MAX * 2;

/** `plan.md`, `notes.md` or `screenshots/<name>.png`. No folders, no `..`. */
export const isSafeArtifactName = (name: string): boolean => {
    const parts = name.split('/');
    if (name.length > ARTIFACT_NAME_MAX || parts.some(p => !SAFE_SEGMENT.test(p) || p.includes('..'))) {
        return false;
    }
    if (parts.length === 1) {
        return parts[0].endsWith(MARKDOWN_EXT);
    }
    return parts.length === 2 && parts[0] === SCREENSHOTS_DIR && parts[1].endsWith(PNG_EXT);
};

/** Validates `ingot/artifact` arguments. */
export const parseArtifactArgs = (args: Record<string, unknown>): { name: string; content: string } | { error: string } => {
    const raw = typeof args.name === 'string' ? args.name.trim() : '';
    const name = raw && !raw.includes('.') ? `${raw}${MARKDOWN_EXT}` : raw;
    const content = typeof args.content === 'string' ? args.content : '';
    if (!name || !isSafeArtifactName(name) || name.includes('/')) {
        return { error: `"${raw}" is not an artifact name. Use plan.md, walkthrough.md or another <name>.md.` };
    }
    if (!content.trim()) {
        return { error: 'An artifact needs content.' };
    }
    return { name, content: content.length > ARTIFACT_MAX_CHARS ? content.slice(0, ARTIFACT_MAX_CHARS) : content };
};

export const artifactKind = (name: string): ArtifactFile['kind'] => name.endsWith(PNG_EXT) ? 'image' : 'markdown';

/** Plan first, walkthrough next, other notes by name, then screenshots in order. */
export const sortArtifacts = (names: readonly string[]): ArtifactFile[] => {
    const rank = (name: string): number => name === PLAN_FILE ? 0 : name.startsWith(`${SCREENSHOTS_DIR}/`) ? 3 : name.endsWith(MARKDOWN_EXT) && name !== WALKTHROUGH_FILE ? 2 : 1;
    return [...names].filter(isSafeArtifactName).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }))
        .map(name => ({ name, kind: artifactKind(name) }));
};

export const screenshotName = (index: number): string => `${SCREENSHOTS_DIR}/shot-${index}${PNG_EXT}`;

export const planMarkdown = (title: string, plan: readonly string[]): string =>
    [`# Plan: ${title}`, '', ...plan.map(step => `- [ ] ${step}`), ''].join('\n');

export const walkthroughMarkdown = (input: WalkthroughInput): string => {
    const reply = input.reply.trim();
    return [
        `# Walkthrough: ${input.title}`,
        '',
        `> ${input.prompt.trim().split('\n')[0]}`,
        '',
        ...(input.plan.length ? ['## Steps', '', ...input.plan.map(step => `- [x] ${step}`), ''] : []),
        '## Changes',
        '',
        ...(input.files.length ? input.files.map(file => `- \`${file}\``) : ['- No files changed']),
        '',
        ...(input.screenshots.length ? ['## Screenshots', '', ...input.screenshots.map(shot => `![${shot}](${shot})`), ''] : []),
        ...(reply ? ['## Result', '', reply.length > WALKTHROUGH_REPLY_CHARS ? `${reply.slice(0, WALKTHROUGH_REPLY_CHARS)}…` : reply, ''] : [])
    ].join('\n');
};

/** Source lines with their fence state, so a line inside ``` is drawn as code. */
export const markdownLines = (source: string): MarkdownLine[] => {
    let code = false;
    return source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').map((text, index) => {
        const fence = FENCE.test(text);
        const inside = code || fence;
        if (fence) {
            code = !code;
        }
        return { line: index + 1, text, code: inside };
    });
};

const clip = (text: string): string => {
    const one = text.replace(/\s+/g, ' ').trim();
    return one.length > STEER_QUOTE_CHARS ? `${one.slice(0, STEER_QUOTE_CHARS - 1)}…` : one;
};

/** The message the agent gets for a comment. */
export const steeringText = (comment: Pick<ArtifactComment, 'file' | 'line' | 'quote' | 'text'>): string => {
    const where = comment.line ? `${comment.file} line ${comment.line}` : comment.file;
    const quote = clip(comment.quote);
    return `${COMMENT_PREFIX} ${where}${quote ? ` ("${quote}")` : ''}: ${comment.text.trim()}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export const parseComments = (raw: string | undefined): ArtifactComment[] => {
    try {
        const list: unknown = JSON.parse(raw ?? '[]');
        return Array.isArray(list) ? list.filter(isRecord).filter(c => typeof c.id === 'string' && typeof c.file === 'string' && typeof c.text === 'string')
            .map(c => ({
                id: String(c.id), file: String(c.file), text: String(c.text), quote: typeof c.quote === 'string' ? c.quote : '',
                at: typeof c.at === 'number' ? c.at : 0, sent: c.sent === true, ...(typeof c.line === 'number' && c.line > 0 ? { line: c.line } : {})
            })) : [];
    } catch {
        return [];
    }
};

export const parseRunMeta = (raw: string | undefined): ArtifactRunMeta | undefined => {
    try {
        const meta: unknown = JSON.parse(raw ?? '');
        if (!isRecord(meta) || typeof meta.runId !== 'string' || typeof meta.sessionId !== 'string') {
            return undefined;
        }
        return {
            runId: meta.runId, sessionId: meta.sessionId, title: typeof meta.title === 'string' ? meta.title : meta.runId,
            startedAt: typeof meta.startedAt === 'number' ? meta.startedAt : 0, ...(typeof meta.endedAt === 'number' ? { endedAt: meta.endedAt } : {})
        };
    } catch {
        return undefined;
    }
};

export const sortRuns = (runs: readonly ArtifactRunMeta[]): ArtifactRunMeta[] => [...runs].sort((a, b) => b.startedAt - a.startedAt);

/** Comments for one markdown line (or a whole image when `line` is undefined). */
export const commentsAt = (comments: readonly ArtifactComment[], file: string, line?: number): ArtifactComment[] =>
    comments.filter(c => c.file === file && c.line === line);
