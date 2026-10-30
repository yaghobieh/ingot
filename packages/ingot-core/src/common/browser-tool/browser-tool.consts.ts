/** IDEA-130 browser tool limits and ids. */
export const BROWSER_WIDGET_ID = 'ingot-browser';
export const BROWSER_WIDGET_LABEL = 'Browser';
export const BROWSER_PROXY_PATH = '/ingot-browser/proxy';
/** Electron session partition for pages the agent opens (cookies kept apart from the IDE). */
export const BROWSER_PARTITION = 'persist:ingot-browser';
export const BROWSER_HOME = 'about:blank';
export const BROWSER_LOAD_TIMEOUT_MS = 20_000;
export const BROWSER_SETTLE_MS = 400;
export const PAGE_TEXT_CHARS = 6_000;
export const PAGE_MAX_ELEMENTS = 80;
export const PROXY_TIMEOUT_MS = 20_000;
export const PROXY_MAX_BYTES = 5_000_000;

/** IDEA-289: console messages and failed requests kept per browser (oldest dropped first). */
export const BROWSER_LOG_LIMIT = 200;
/** Entries the agent gets per console / network read (the latest ones). */
export const BROWSER_LOG_REPORT = 50;
export const BROWSER_LOG_TEXT_CHARS = 500;
/** Lines the desktop page observer writes to the console for Ingot; never shown as page logs. */
export const BROWSER_NET_PREFIX = '__ingot_net__';
export const BROWSER_SEL_PREFIX = '__ingot_sel__';
/** The proxy marks an upstream HTTP error in the page it returns (the frame cannot read the status). */
export const BROWSER_STATUS_META = 'ingot-status';
/** Console lines Electron itself adds to pages (dev security warnings), not the page's own. */
export const ELECTRON_INTERNAL_SOURCE = 'node:electron/';
export const HTTP_ERROR_MIN = 400;
/** Electron's ERR_ABORTED: a load replaced by another navigation, not a failure. */
export const LOAD_ABORTED_CODE = -3;
export const SELECTION_DEBOUNCE_MS = 150;
/** Most selected characters quoted into the chat. */
export const SELECTION_QUOTE_CHARS = 1_500;
export const SELECTION_POPOVER_GAP_PX = 6;
export const SELECTION_POPOVER_WIDTH_PX = 280;
/** Context key: focus is inside the Browser panel. */
export const BROWSER_FOCUS_KEY = 'ingotBrowserFocus';
/** IDEA-289: the `/browser` composer command that turns the browser tools on for one run. */
export const BROWSER_RUN_COMMAND = 'browser';
export const BROWSER_RUN_NOTE = 'The user started this run with /browser: use the Ingot browser tools (ingot/browser_*) to open, check and test pages, and read the console and failed requests when something looks broken.';
export const BROWSER_RUN_ONLY_TEXT = 'The browser tools are on only for runs started with /browser. Ask the user to start the message with /browser.';
