/** IDEA-109: backend side of Ingot's built-in agent tools (terminal command, web search / fetch). */
export const AGENT_ACTIONS_SERVICE_PATH = '/services/ingot-agent-actions';
export const AgentActionsService = Symbol('IngotAgentActionsService');

export interface AgentActionResult {
    readonly text: string;
    readonly isError: boolean;
    /** The command was still running when the wait ended. A check in this state did not pass. */
    readonly movedToBackground?: boolean;
}

export interface AgentActionsService {
    /** Runs a shell command in `cwd` (the project root) with a timeout; returns combined, size-capped output. */
    runCommand(cwd: string, command: string): Promise<AgentActionResult>;
    /** Fetches an http(s) page as plain text. */
    fetchUrl(url: string): Promise<AgentActionResult>;
    /** Web search results as "title — url" lines. */
    search(query: string): Promise<AgentActionResult>;
}

export const MAX_ACTION_OUTPUT = 32_000;
export const COMMAND_TIMEOUT_MS = 120_000;

export const capOutput = (text: string, max = MAX_ACTION_OUTPUT): string =>
    text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} more characters cut)` : text;

/** Readable text from HTML: drops scripts / styles / tags and collapses whitespace. */
export const htmlToText = (html: string): string => html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

/** Results from DuckDuckGo's HTML endpoint: `<a class="result__a" href="…">title</a>`. */
export const parseSearchResults = (html: string, limit = 8): { title: string; url: string }[] => {
    const out: { title: string; url: string }[] = [];
    for (const m of html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
        let url = m[1].replace(/&amp;/g, '&');
        const redirect = /[?&]uddg=([^&]+)/.exec(url);
        if (redirect) {
            url = decodeURIComponent(redirect[1]);
        }
        if (url.startsWith('//')) {
            url = `https:${url}`;
        }
        out.push({ title: htmlToText(m[2]), url });
        if (out.length >= limit) {
            break;
        }
    }
    return out;
};
