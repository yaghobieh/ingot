import type { SettingInfo, SettingsPage } from './settings.types';

/** The tree without admin-only pages for everyone else (IDEA-287). */
export const pagesFor = (pages: readonly SettingsPage[], isAdmin: boolean): SettingsPage[] =>
    pages.filter(page => isAdmin || !page.adminOnly).map(page => page.children ? { ...page, children: pagesFor(page.children, isAdmin) } : page);

export const flattenPages = (pages: readonly SettingsPage[], parents: readonly string[] = []): { page: SettingsPage; path: string[] }[] =>
    pages.flatMap(page => [{ page, path: [...parents, page.label] }, ...flattenPages(page.children ?? [], [...parents, page.label])]);

/** Human label for a preference key: `editor.fontSize` → "Font Size". */
/** Labels that read better than the key's last segment. */
const SETTING_LABELS: Record<string, string> = {
    'ingot.account.syncSettings': 'Sync settings',
    'ingot.chat.attachActiveFile': 'Attach active file automatically',
    // IDEA-133: Agent tools.
    'ingot.agent.terminal.enabled': 'Let the agent run commands',
    'ingot.agent.terminal.requireApproval': 'Ask before running commands',
    'ingot.agent.terminal.foregroundTimeoutSeconds': 'Foreground timeout (seconds)',
    'ingot.agent.terminal.maxOutputChars': 'Output sent to the agent (characters)',
    'ingot.agent.processes.showInChat': 'Show background processes in the chat',
    'ingot.agent.browser.enabled': 'Let the agent use the browser',
    'ingot.agent.browser.everyRun': 'Offer the browser in every run (off: only with /browser)',
    'ingot.agent.browser.requireApproval': 'Ask before browser actions',
    'ingot.agent.browser.approveReads': 'Also ask before reading pages and screenshots',
    'ingot.agent.workLoop': 'Run checks, fix, and commit after a task',
    'ingot.agent.maxToolRounds': 'Most tool rounds in one turn',
    'ingot.agent.maxToolResultChars': 'Tool result kept for the model (characters)'
};

export const settingLabel = (key: string): string => {
    if (SETTING_LABELS[key]) {
        return SETTING_LABELS[key];
    }
    const last = key.split('.').pop() ?? key;
    return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
};

const matchesPage = (page: SettingsPage, needle: string, describe: (key: string) => SettingInfo | undefined): boolean =>
    page.label.toLowerCase().includes(needle)
    || (page.description ?? '').toLowerCase().includes(needle)
    || (page.actions ?? []).some(a => a.label.toLowerCase().includes(needle))
    || (page.preferences ?? []).some(key => {
        const info = describe(key);
        return `${key} ${settingLabel(key)} ${info?.description ?? ''}`.toLowerCase().includes(needle);
    });

/** Page ids matching the search text, with their ancestors so the tree stays navigable. */
export const searchPages = (pages: readonly SettingsPage[], query: string, describe: (key: string) => SettingInfo | undefined): Set<string> => {
    const needle = query.trim().toLowerCase();
    const result = new Set<string>();
    const visit = (page: SettingsPage, ancestors: string[]): void => {
        if (!needle || matchesPage(page, needle, describe)) {
            result.add(page.id);
            ancestors.forEach(id => result.add(id));
        }
        page.children?.forEach(child => visit(child, [...ancestors, page.id]));
    };
    pages.forEach(page => visit(page, []));
    return result;
};

/** Preferences on a page that match the search text (all of them when the page itself matches). */
export const visiblePreferences = (page: SettingsPage, query: string, describe: (key: string) => SettingInfo | undefined): string[] => {
    const needle = query.trim().toLowerCase();
    const keys = [...(page.preferences ?? [])];
    if (!needle || page.label.toLowerCase().includes(needle)) {
        return keys;
    }
    return keys.filter(key => `${key} ${settingLabel(key)} ${describe(key)?.description ?? ''}`.toLowerCase().includes(needle));
};

/** Parses a value typed into a setting field according to its schema type. */
export const coerceSetting = (raw: string | boolean, type: string | undefined): unknown => {
    if (typeof raw === 'boolean') {
        return raw;
    }
    if (type === 'number' || type === 'integer') {
        const n = Number(raw);
        return Number.isFinite(n) ? n : undefined;
    }
    return raw;
};

export const themeIdFromLabel = (label: string): string => `user-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme'}`;

/** color theme `type` → Monaco base theme. */
export const uiThemeFor = (type: unknown): 'vs' | 'vs-dark' | 'hc-black' | 'hc-light' =>
    type === 'light' ? 'vs' : type === 'hc' || type === 'hcDark' ? 'hc-black' : type === 'hcLight' ? 'hc-light' : 'vs-dark';
