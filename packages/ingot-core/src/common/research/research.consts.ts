export const RESEARCH_SERVICE_PATH = '/services/ingot-research';
/** Under the gateway base (`/v1`): POST /v1/research. */
export const RESEARCH_PATH = '/research';
export const RESEARCH_FEATURE = 'deep-research';

export const DEFAULT_RESEARCH_COST_USD = 0.05;
export const DEFAULT_RESEARCH_PAGES = 30;
export const MAX_RESEARCH_QUESTION = 1000;

/** A run reads and writes for a few minutes; the request gives up after this. */
export const RESEARCH_TIMEOUT_MS = 10 * 60_000;
/** Finished runs stay pollable this long. */
export const RESEARCH_TTL_MS = 120_000;
export const RESEARCH_POLL_MS = 400;
/** Site chips shown on a live run. */
export const RESEARCH_RECENT_SITES = 10;

export const RESEARCH_TOOL = 'deep_research';
export const RESEARCH_TITLE = 'Deep research';
export const RESEARCH_BETA = 'Beta';
export const RESEARCH_STARTING = 'Planning the research…';
export const RESEARCH_STOPPED = 'Research stopped.';
export const RESEARCH_SIGN_IN = 'Deep research runs on the Ingot server: sign in to Ingot to use it.';

/** Server error codes the chat explains in words. */
export const RESEARCH_ERRORS: Readonly<Record<string, string>> = {
    research_failed: 'The research run failed. Try again in a minute.',
    research_rate_limited: 'Too many research runs. Try again later.',
    research_unavailable: 'Deep research is not available on this server right now.',
    research_question_required: 'Type a question to research.',
    research_question_too_long: `Questions can be up to ${MAX_RESEARCH_QUESTION} characters.`
};

/** Last line of the server's Markdown answer: `_Deep research · 30 pages · 13 sites · $0.0049_`. */
export const RESEARCH_FOOTER = /\n*_Deep research · (\d+) pages · (\d+) sites · \$([\d.]+)_\s*$/;

/** Labels under a country code (bbc.co.uk) and shared hosts where each subdomain is its own site (x.github.io). */
export const COUNTRY_SECOND_LEVEL: ReadonlySet<string> = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ne', 'or']);
export const SHARED_HOSTS: ReadonlySet<string> = new Set(['github.io', 'gitlab.io', 'pages.dev', 'vercel.app', 'netlify.app', 'herokuapp.com', 'blogspot.com', 'substack.com', 'wordpress.com']);
