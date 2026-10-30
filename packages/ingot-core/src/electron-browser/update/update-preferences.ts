import { PreferenceContribution, type PreferenceSchema } from '@theia/core/lib/common/preferences';
import type { interfaces } from '@theia/core/shared/inversify';
import { UPDATE_CHANNEL_PREFERENCE, UPDATE_CHANNELS, UPDATER_TEXT } from '../../common/update/auto-update.consts';

/** Desktop-only: the release channel the auto-updater follows (IDEA-269). */
export const updatePreferenceSchema: PreferenceSchema = {
    properties: {
        [UPDATE_CHANNEL_PREFERENCE]: {
            type: 'string',
            enum: [...UPDATE_CHANNELS],
            enumDescriptions: ['Releases only.', 'Releases and pre-releases (betas).'],
            default: UPDATE_CHANNELS[0],
            description: UPDATER_TEXT.channelDescription
        }
    }
};

export const bindUpdatePreferences = (bind: interfaces.Bind): void => {
    bind(PreferenceContribution).toConstantValue({ schema: updatePreferenceSchema });
};
