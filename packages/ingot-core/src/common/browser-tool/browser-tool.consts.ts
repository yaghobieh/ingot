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
