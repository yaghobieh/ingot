import type { Command } from '@theia/core/lib/common/command';

export const DISK_SYNC_COMMANDS = {
    reloadAll: { id: 'ingot.files.reloadFromDisk', label: 'Reload All from Disk', category: 'File' }
} as const satisfies Record<string, Command>;

export const DISK_SYNC_TEXT = {
    reload: 'Reload from Disk',
    keep: 'Keep My Version',
    changed: (name: string): string => `${name} changed on disk, but the editor has unsaved edits. Reload it from disk?`
} as const;
