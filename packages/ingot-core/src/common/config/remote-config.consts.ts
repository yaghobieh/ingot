/** Flags the IDE knows, with the value used when the server does not mention them (IDEA-125). Unknown flags are off. */
export const IDE_FLAGS = {
    /** Mic button in the chat composer (voice dictation). */
    micDictation: 'mic_dictation',
    /** "Browse Marketplace" in the MCP tool window. */
    mcpMarketplace: 'mcp_marketplace',
    /** Settings sync through /v1/sync (IDEA-126). */
    settingsSync: 'settings_sync'
} as const;

export type IdeFlag = typeof IDE_FLAGS[keyof typeof IDE_FLAGS];

export const IDE_FLAG_DEFAULTS: Readonly<Record<IdeFlag, boolean>> = {
    [IDE_FLAGS.micDictation]: true,
    [IDE_FLAGS.mcpMarketplace]: true,
    [IDE_FLAGS.settingsSync]: true
};

export const CONFIG_PATH = '/v1/config';
export const CONFIG_CACHE_FILE = 'remote-config.json';
export const DEFAULT_CONFIG_TTL_SECONDS = 300;
/** Never poll faster than this, whatever the server says. */
export const MIN_CONFIG_TTL_SECONDS = 30;
export const MAX_CONFIG_TTL_SECONDS = 24 * 60 * 60;
export const DEFAULT_DOWNLOAD_URL = 'https://github.com/yaghobieh/ingot/releases/latest';
/** localStorage key: the latestVersion the user said "Later" to. */
export const UPDATE_DISMISSED_KEY = 'ingot.update.dismissed';
export const FORCE_UPDATE_SCREEN_ID = 'ingot-force-update';

export const UPDATE_TEXT = {
    available: (version: string) => `Ingot ${version} is available.`,
    download: 'Download',
    releaseNotes: 'Release notes',
    later: 'Later',
    continueWithout: 'Continue without the agent',
    forceTitle: 'This version is no longer supported',
    forceBody: (current: string, min: string) => `Ingot ${current} can no longer use the agent or chat. Download version ${min} or later to keep working.`,
    chatBlocked: 'This version of Ingot is no longer supported. Download the latest version to use the agent and chat.'
} as const;
