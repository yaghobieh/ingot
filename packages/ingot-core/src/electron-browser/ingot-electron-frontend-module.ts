import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronMainMenuFactory } from '@theia/core/lib/electron-browser/menu/electron-main-menu-factory';
import { CustomTitleWidgetFactory } from '@theia/core/lib/electron-browser/menu/electron-menu-contribution';
import { LaunchBackgroundContribution } from '../browser/theme/launch-background-contribution';
import { ElectronLaunchBackgroundContribution } from './electron-launch-background-contribution';
import { IngotElectronMenuFactory } from './ingot-electron-menu-factory';
import { IngotCustomTitleWidget } from './ingot-custom-title-widget';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(IngotElectronMenuFactory).toSelf().inSingletonScope();
    rebind(ElectronMainMenuFactory).toService(IngotElectronMenuFactory);
    // IDEA-169: the window title keeps clear of the main toolbar in small windows.
    bind(IngotCustomTitleWidget).toSelf();
    rebind(CustomTitleWidgetFactory).toFactory(context => () => context.container.get(IngotCustomTitleWidget));
    bind(ElectronLaunchBackgroundContribution).toSelf().inSingletonScope();
    rebind(LaunchBackgroundContribution).toService(ElectronLaunchBackgroundContribution);
});
