import { injectable } from '@theia/core/shared/inversify';
import { PreferenceConfigurations } from '@theia/core/lib/common/preferences/preference-configurations';
import { CONFIG_FOLDERS } from '../../common/debug/debug.consts';

/** Reads and creates project launch.json / tasks.json / settings.json in `.ingot/` first (IDEA-138). */
@injectable()
export class IngotPreferenceConfigurations extends PreferenceConfigurations {
    override getPaths(): string[] {
        return [...CONFIG_FOLDERS];
    }
}
