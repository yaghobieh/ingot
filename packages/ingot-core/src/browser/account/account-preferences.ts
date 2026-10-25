import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';
import { interfaces } from '@theia/core/shared/inversify';
import { ACCOUNT_PREFERENCES, DEFAULT_PORTAL_URL, DEFAULT_SERVER_URL } from '../../common/account/account.consts';

/** Where the Ingot account lives. Non-secret: the session itself is kept in the OS keychain. */
export const accountPreferenceSchema: PreferenceSchema = {
    properties: {
        [ACCOUNT_PREFERENCES.serverUrl]: { type: 'string', default: DEFAULT_SERVER_URL, description: 'Ingot account and model server.' },
        [ACCOUNT_PREFERENCES.portalUrl]: { type: 'string', default: DEFAULT_PORTAL_URL, description: 'Ingot website (sign-in and dashboard).' }
    }
};

export const bindAccountPreferences = (bind: interfaces.Bind): void => {
    bind(PreferenceContribution).toConstantValue({ schema: accountPreferenceSchema });
};
