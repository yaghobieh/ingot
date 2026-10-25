import type { Command } from '@theia/core/lib/common/command';

export const INGOT_COMMANDS = {
    about: { id: 'ingot.about', label: 'About Ingot', category: 'Ingot' }
} as const satisfies Record<string, Command>;
