import { AGENTS_WINDOW_PARAM, AGENTS_WINDOW_VALUE } from './workbench.consts';

/** True when this window was opened as the dedicated Agents Window (IDEA-118). */
export const isAgentsWindowUrl = (search: string): boolean => new URLSearchParams(search).get(AGENTS_WINDOW_PARAM) === AGENTS_WINDOW_VALUE;

/**
 * URL of the Agents Window for the current window's URL: same app and query (Electron passes its port there),
 * plus the agents flag, with the workspace kept in the hash.
 */
export const agentsWindowUrl = (href: string): string => {
    const url = new URL(href);
    url.searchParams.set(AGENTS_WINDOW_PARAM, AGENTS_WINDOW_VALUE);
    return url.toString();
};
