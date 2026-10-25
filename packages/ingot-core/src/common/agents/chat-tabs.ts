import { NEW_AGENT_TITLE } from './agents.consts';

/** Context meter thresholds for the tab underline (IDEA-98). */
export const TAB_CONTEXT_WARN = 0.8;
export const TAB_CONTEXT_FULL = 0.95;
/** A fresh chat is named after this many words of the first message. */
export const TAB_TITLE_WORDS = 5;
export const TAB_TITLE_MIN_WORDS = 3;
export const TAB_TITLE_MAX = 32;

/** Short tab title from a message: the first few words, capitalized, truncated. */
export const tabTitleFromText = (text: string): string => {
    const words = text.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, TAB_TITLE_WORDS);
    const title = words.join(' ');
    const capped = title.charAt(0).toUpperCase() + title.slice(1);
    return capped.length > TAB_TITLE_MAX ? `${capped.slice(0, TAB_TITLE_MAX - 1)}…` : capped;
};

/**
 * What a tab shows: its title, or (for a chat that was never named) a live name once the draft has a few words,
 * otherwise nothing. "New chat" is never shown.
 */
export const tabLabel = (title: string, draft = ''): string => {
    if (title && title !== NEW_AGENT_TITLE) {
        return title;
    }
    const words = draft.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).filter(Boolean);
    return words.length >= TAB_TITLE_MIN_WORDS ? tabTitleFromText(draft) : '';
};

/** Context meter level for the tab underline. */
export const tabContextLevel = (ratio: number): 'ok' | 'warn' | 'full' =>
    ratio >= TAB_CONTEXT_FULL ? 'full' : ratio >= TAB_CONTEXT_WARN ? 'warn' : 'ok';

/** Moves one id to another position (drag to reorder); pinned ids always stay in front. */
export const reorderTabs = (ids: readonly string[], from: string, to: string, pinned: ReadonlySet<string> = new Set()): string[] => {
    const order = ids.filter(id => id !== from);
    const target = order.indexOf(to);
    if (!ids.includes(from) || target < 0) {
        return [...ids];
    }
    order.splice(ids.indexOf(from) < ids.indexOf(to) ? target + 1 : target, 0, from);
    return pinnedFirst(order, pinned);
};

/** Pinned tabs first, each group keeping its order. */
export const pinnedFirst = (ids: readonly string[], pinned: ReadonlySet<string>): string[] =>
    [...ids.filter(id => pinned.has(id)), ...ids.filter(id => !pinned.has(id))];
