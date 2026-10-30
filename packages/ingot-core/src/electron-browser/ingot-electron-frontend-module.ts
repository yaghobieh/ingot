import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ElectronMainMenuFactory } from '@theia/core/lib/electron-browser/menu/electron-main-menu-factory';
import { CustomTitleWidgetFactory } from '@theia/core/lib/electron-browser/menu/electron-menu-contribution';
import { LaunchBackgroundContribution } from '../browser/theme/launch-background-contribution';
import { ElectronLaunchBackgroundContribution } from './electron-launch-background-contribution';
import { ElectronIpcConnectionProvider } from '@theia/core/lib/electron-browser/messaging/electron-ipc-connection-source';
import { IngotElectronMenuFactory } from './ingot-electron-menu-factory';
import { IngotCustomTitleWidget } from './ingot-custom-title-widget';
import { IngotUpdater, INGOT_UPDATER_PATH } from '../common/update/auto-update.consts';
import type { IngotUpdaterService } from '../common/update/auto-update.types';
import { IngotUpdaterClientImpl } from '../browser/update/updater-client';
import { IngotUpdaterContribution } from './update/ingot-updater-contribution';
import { bindUpdatePreferences } from './update/update-preferences';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(IngotElectronMenuFactory).toSelf().inSingletonScope();
    rebind(ElectronMainMenuFactory).toService(IngotElectronMenuFactory);
    // IDEA-169: the window title keeps clear of the main toolbar in small windows.
    bind(IngotCustomTitleWidget).toSelf();
    rebind(CustomTitleWidgetFactory).toFactory(context => () => context.container.get(IngotCustomTitleWidget));
    bind(ElectronLaunchBackgroundContribution).toSelf().inSingletonScope();
    rebind(LaunchBackgroundContribution).toService(ElectronLaunchBackgroundContribution);
    // IDEA-269: auto-update lives in the Electron main process; this window talks to it over IPC.
    bind(IngotUpdaterClientImpl).toSelf().inSingletonScope();
    bind(IngotUpdater).toDynamicValue(context =>
        ElectronIpcConnectionProvider.createProxy<IngotUpdaterService>(context.container, INGOT_UPDATER_PATH, context.container.get(IngotUpdaterClientImpl))
    ).inSingletonScope();
    bind(IngotUpdaterContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(IngotUpdaterContribution);
    bind(CommandContribution).toService(IngotUpdaterContribution);
    bind(MenuContribution).toService(IngotUpdaterContribution);
    bindUpdatePreferences(bind);
});
