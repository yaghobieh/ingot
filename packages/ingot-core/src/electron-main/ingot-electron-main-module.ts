import * as path from 'path';
import { app } from '@theia/core/electron-shared/electron';
import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { IngotElectronMainApplication } from './ingot-electron-main-application';
import { IngotElectronMainContribution } from './ingot-electron-main-contribution';
import { IngotDeepLinkContribution } from './ingot-deep-link-contribution';
import { IngotAutoUpdateContribution } from './ingot-auto-update-contribution';
import { DEFAULT_PLUGINS_ENV, PACKAGED_PLUGINS_DIR } from '../common/update/auto-update.consts';
import { defaultPluginsValue } from '../common/update/auto-update.utils';

// IDEA-134: packaged apps ship the built-in language plugins in <resources>/plugins (electron-builder extraResources).
// Set before the backend process is forked (it inherits this env); dev runs pass --plugins=local-dir:../../plugins.
if (app.isPackaged) {
    process.env[DEFAULT_PLUGINS_ENV] = defaultPluginsValue(process.env[DEFAULT_PLUGINS_ENV], path.join(process.resourcesPath, PACKAGED_PLUGINS_DIR));
}

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    // IDEA-130: the window allows the locked-down <webview> of the agent browser panel.
    bind(IngotElectronMainApplication).toSelf().inSingletonScope();
    rebind(ElectronMainApplication).toService(IngotElectronMainApplication);
    bind(IngotElectronMainContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(IngotElectronMainContribution);
    bind(IngotDeepLinkContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(IngotDeepLinkContribution);
    bind(IngotAutoUpdateContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(IngotAutoUpdateContribution);
});
