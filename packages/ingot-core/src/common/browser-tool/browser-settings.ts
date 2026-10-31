/** IDEA-130/133: Settings › Tools › Agent tools. */
export const BROWSER_PREFS = {
    enabled: 'ingot.agent.browser.enabled',
    /** IDEA-289: offer the browser tools in every run; off (default): only in runs started with /browser. */
    everyRun: 'ingot.agent.browser.everyRun',
    /** Open, click, type, scroll and back wait on the approval card. */
    requireApproval: 'ingot.agent.browser.requireApproval',
    /** Reading the page and screenshots ask too (off: they run at once). */
    approveReads: 'ingot.agent.browser.approveReads'
} as const;

export interface BrowserToolSettings {
    readonly enabled: boolean;
    readonly everyRun: boolean;
    readonly requireApproval: boolean;
    readonly approveReads: boolean;
}

export const BROWSER_DEFAULTS: BrowserToolSettings = { enabled: true, everyRun: false, requireApproval: true, approveReads: false };

/** Browser tools that only look at the page. */
export const BROWSER_READ_TOOLS: readonly string[] = ['browser_read', 'browser_screenshot', 'browser_console', 'browser_network'];

const bool = (v: unknown, d: boolean): boolean => typeof v === 'boolean' ? v : d;

export const browserToolSettings = (get: (key: string) => unknown): BrowserToolSettings => ({
    enabled: bool(get(BROWSER_PREFS.enabled), BROWSER_DEFAULTS.enabled),
    everyRun: bool(get(BROWSER_PREFS.everyRun), BROWSER_DEFAULTS.everyRun),
    requireApproval: bool(get(BROWSER_PREFS.requireApproval), BROWSER_DEFAULTS.requireApproval),
    approveReads: bool(get(BROWSER_PREFS.approveReads), BROWSER_DEFAULTS.approveReads)
});

/** Whether a browser tool call waits on the card under these settings. */
export const browserNeedsCard = (tool: string, settings: BrowserToolSettings): boolean =>
    settings.requireApproval && (!BROWSER_READ_TOOLS.includes(tool) || settings.approveReads);

/** IDEA-289: the agent gets the browser tools when they are allowed and either offered in every run or the run used /browser. */
export const browserToolsOn = (settings: BrowserToolSettings, browserRun: boolean): boolean =>
    settings.enabled && (settings.everyRun || browserRun);
