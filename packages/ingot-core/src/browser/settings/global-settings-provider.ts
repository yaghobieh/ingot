import { injectable } from '@theia/core/shared/inversify';
import type URI from '@theia/core/lib/common/uri';
import { UserConfigsPreferenceProvider } from '@theia/preferences/lib/common/user-configs-preference-provider';
import { GLOBAL_SETTINGS_FILE } from '../../common/settings/global-settings.consts';

/**
 * User scope (IDEA-94): ~/.ingot/ingot.settings.json is read as plain user settings under settings.json, so edits made in
 * the Settings dialog (saved to settings.json) still win, and project settings win over both. The file is watched, so
 * changes apply live; writes never go to it.
 */
@injectable()
export class IngotUserConfigsPreferenceProvider extends UserConfigsPreferenceProvider {
    protected override createProviders(userStorageLocation: URI): void {
        const uri = userStorageLocation.resolve(GLOBAL_SETTINGS_FILE);
        if (!this.providers.has(uri.toString())) {
            this.providers.set(uri.toString(), this.createProvider(uri, this.configurations.getConfigName()));
        }
        super.createProviders(userStorageLocation);
    }
}
