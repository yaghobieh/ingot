import type { AgentMessage } from './agents.types';
import { fileBadge } from './agents.utils';
import { FOLDER_SUFFIX, MENTION_PATTERN } from './agent-panel.consts';
import type { DiffTotals, MentionChip, ThreadLayout } from './agent-panel.types';
import { latestUserIndex } from './chat-thread';

/** The first visible agent message after each visible user message: it carries the "Ingot Agent" line. */
export const turnLeadIndexes = (messages: readonly Pick<AgentMessage, 'role' | 'hidden'>[]): Set<number> => {
    const leads = new Set<number>();
    let open = true;
    messages.forEach((message, index) => {
        if (message.hidden) {
            return;
        }
        if (message.role === 'user') {
            open = true;
        } else if (message.role === 'agent' && open) {
            leads.add(index);
            open = false;
        }
    });
    return leads;
};

const NONE = -1;

/**
 * Lays out the latest turn: its first reply gets the agent line and Explored row, its last reply the checklist, and the
 * reply that made the latest edits (`editsIndex`, from the change tracker) the edited-files card. Older edits get no card.
 */
export const threadLayout = (messages: readonly Pick<AgentMessage, 'role' | 'hidden'>[], editsIndex: number | undefined): ThreadLayout => {
    const leads = turnLeadIndexes(messages);
    const latestUser = latestUserIndex(messages);
    const turn = messages.map((message, index) => ({ message, index }))
        .filter(({ message, index }) => index > latestUser && message.role === 'agent' && !message.hidden)
        .map(({ index }) => index);
    const turnLead = turn[0] ?? NONE;
    const turnLast = turn[turn.length - 1] ?? NONE;
    const inTurn = editsIndex !== undefined && editsIndex > latestUser;
    const editsAt = !inTurn ? NONE : turn.includes(editsIndex) ? editsIndex : turnLast;
    return { leads, turnLead, turnLast, editsAt };
};

const isMentionPath = (path: string): boolean =>
    path.endsWith(FOLDER_SUFFIX) ? path.length > FOLDER_SUFFIX.length : /\.[\w]+$/.test(path);

/** `@path` mentions in the draft as chips: files get their type badge, folders a DIR badge. */
export const mentionChips = (draft: string): MentionChip[] => {
    const chips: MentionChip[] = [];
    for (const match of draft.matchAll(MENTION_PATTERN)) {
        const path = match[1];
        if (!isMentionPath(path) || chips.some(chip => chip.path === path)) {
            continue;
        }
        const folder = path.endsWith(FOLDER_SUFFIX);
        const label = folder ? path : path.slice(path.lastIndexOf(FOLDER_SUFFIX) + 1);
        chips.push({ path, label, badge: fileBadge(path), folder });
    }
    return chips;
};

/** `@folder/` mentions in a prompt (files are handled by `parseMentions`). */
export const parseFolderMentions = (prompt: string): string[] =>
    mentionChips(prompt).filter(chip => chip.folder).map(chip => chip.path);

export const sumDiffs = (stats: readonly DiffTotals[]): DiffTotals =>
    stats.reduce((total, next) => ({ added: total.added + next.added, removed: total.removed + next.removed }), { added: 0, removed: 0 });
