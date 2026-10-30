import * as fs from 'fs';
import * as path from 'path';
import { app } from '@theia/core/electron-shared/electron';
import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { IngotElectronMainApplication } from './ingot-electron-main-application';
import { IngotElectronMainContribution } from './ingot-electron-main-contribution';
import { IngotDeepLinkContribution } from './ingot-deep-link-contribution';
import { IngotAutoUpdateContribution } from './ingot-auto-update-contribution';
import { ElectronConnectionHandler } from '@theia/core/lib/electron-main/messaging/electron-connection-handler';
import { RpcConnectionHandler } from '@theia/core/lib/common/messaging/proxy-factory';
import { IngotUpdateController } from './update/ingot-update-controller';
import { createUpdateDriver } from './update/electron-update-driver';
import { DEFAULT_PLUGINS_ENV, INGOT_UPDATER_PATH, PACKAGED_PLUGINS_DIR } from '../common/update/auto-update.consts';
import type { IngotUpdaterClient } from '../common/update/auto-update.types';
import { autoUpdateDecision, defaultPluginsValue } from '../common/update/auto-update.utils';
import { BAKED_ENDPOINTS_KEY } from '../common/account/account.consts';
import { bakedEndpointEnv } from '../common/account/account-endpoints.utils';
import { installProcessReporter } from '../common/telemetry/process-reporter';
import { PRODUCT } from '../common/product.consts';

// Before app 'ready': the macOS app menu and its About/Hide/Quit role labels read the name then.
app.setName(PRODUCT.name);
// Never touch the macOS Keychain: Chromium cookie / safeStorage encryption uses a mock keychain and a basic password store.
app.commandLine.appendSwitch('use-mock-keychain');
app.commandLine.appendSwitch('password-store', 'basic');

// IDEA-134: packaged apps ship the built-in language plugins in <resources>/plugins (electron-builder extraResources).
// Set before the backend process is forked (it inherits this env); dev runs pass --plugins=local-dir:../../plugins.
if (app.isPackaged) {
    process.env[DEFAULT_PLUGINS_ENV] = defaultPluginsValue(process.env[DEFAULT_PLUGINS_ENV], path.join(process.resourcesPath, PACKAGED_PLUGINS_DIR));
    // IDEA-140: release builds bake the public server and portal URLs into package.json (see docs/RELEASING.md).
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
    // IDEA-269: one updater for the app; every window talks to it over Electron IPC.
    bind(IngotUpdateController).toDynamicValue(() => {
        const env = { isPackaged: app.isPackaged, platform: process.platform, version: app.getVersion(), env: process.env };
        return new IngotUpdateController(autoUpdateDecision(env), env.version, createUpdateDriver);
    }).inSingletonScope();
    bind(ElectronConnectionHandler).toDynamicValue(context => new RpcConnectionHandler<IngotUpdaterClient>(INGOT_UPDATER_PATH, client => {
        const controller = context.container.get(IngotUpdateController);
        controller.addClient(client);
        client.onDidCloseConnection(() => controller.removeClient(client));
        return controller;
    })).inSingletonScope();
    bind(IngotAutoUpdateContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(IngotAutoUpdateContribution);
});
