import type { SyncKind } from './sync.types';

export const SYNC_PATH = '/v1/sync';
export const SYNC_KINDS: readonly SyncKind[] = ['settings', 'rules', 'keybindings', 'chats'];
export const SYNC_PREFERENCE = 'ingot.account.syncSettings';
export const SYNC_PULL_LIMIT = 500;
export const SYNC_DEBOUNCE_MS = 2000;
export const SYNC_INTERVAL_MS = 5 * 60_000;
export const SYNC_FOCUS_THROTTLE_MS = 30_000;
export const SYNC_MAX_ITEM_BYTES = 200 * 1024;
export const SYNC_STATE_PREFIX = 'ingot.sync.state:';
export const SYNC_DEVICE_KEY = 'ingot.sync.device';
export const KEYMAPS_FILE = 'keymaps.json';
export const KEYBINDINGS_KEY = 'keymaps.json';
export const RULE_KEY_PREFIX = 'rules/';
export const CHAT_KEY_PREFIX = 'chat/';
/** Never synced: where the account lives, and anything that looks like a credential. */
export const NEVER_SYNC_SETTING_PREFIXES = ['ingot.account.'] as const;
export const SECRET_SETTING_PATTERN = /token|secret|password|passwd|api[-_.]?key|credential|auth/i;
export const SYNC_KEY_PATTERN = /^[A-Za-z0-9._:/@-]{1,200}$/;
export const SYNC_TEXT = {
    ruleConflict: (name: string, copy: string) => `Rule "${name}" was also changed on another device. Their version is saved as ${copy}.`
} as const;

export const SYNC_NOW_COMMAND = { id: 'ingot.sync.now', label: 'Sync Settings Now', category: 'Account' } as const;
