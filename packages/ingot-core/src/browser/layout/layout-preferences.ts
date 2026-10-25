import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { CHAT_POSITIONS, DEFAULT_CHAT_POSITION, LAYOUT_PREFS } from '../../common/layout/layout.consts';

export const layoutPreferenceSchema: PreferenceSchema = {
    properties: {
        [LAYOUT_PREFS.chatPosition]: {
            type: 'string', enum: [...CHAT_POSITIONS], default: DEFAULT_CHAT_POSITION,
            enumDescriptions: ['Chat column on the right, project tree on the left.', 'Chat docked in the bottom panel, next to Terminal.'],
            description: 'Where the AI chat panel lives. The project tree stays on the left.'
        }
    }
};
