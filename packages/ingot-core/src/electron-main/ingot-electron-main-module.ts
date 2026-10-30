import * as fs from 'fs';
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
import { BAKED_ENDPOINTS_KEY } from '../common/account/account.consts';
import { bakedEndpointEnv } from '../common/account/account-endpoints.utils';
import { installProcessReporter } from '../common/telemetry/process-reporter';
import { PRODUCT } from '../common/product.consts';

// Before app 'ready': the macOS app menu and its About/Hide/Quit role labels read the name then.
app.setName(PRODUCT.name);

// IDEA-134: packaged apps ship the built-in language plugins in <resources>/plugins (electron-builder extraResources).
// Set before the backend process is forked (it inherits this env); dev runs pass --plugins=local-dir:../../plugins.
if (app.isPackaged) {
    process.env[DEFAULT_PLUGINS_ENV] = defaultPluginsValue(process.env[DEFAULT_PLUGINS_ENV], path.join(process.resourcesPath, PACKAGED_PLUGINS_DIR));
    // IDEA-140: release builds bake the public server and portal URLs into package.json (see docs/release.md).
    Object.assign(process.env, bakedEndpointEnv(readBakedEndpoints(), process.env));
}

// IDEA-149: main-process crashes go to Sentry only when SENTRY_DSN is set.
installProcessReporter('ide-main');

function readBakedEndpoints(): Record<string, unknown> | undefined {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
        return pkg?.[BAKED_ENDPOINTS_KEY];
    } catch {
        return undefined;
    }
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
