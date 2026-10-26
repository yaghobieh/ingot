import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { IngotElectronMainApplication } from './ingot-electron-main-application';
import { IngotElectronMainContribution } from './ingot-electron-main-contribution';
import { IngotDeepLinkContribution } from './ingot-deep-link-contribution';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    // IDEA-130: the window allows the locked-down <webview> of the agent browser panel.
    bind(IngotElectronMainApplication).toSelf().inSingletonScope();
    rebind(ElectronMainApplication).toService(IngotElectronMainApplication);
    bind(IngotElectronMainContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(IngotElectronMainContribution);
    bind(IngotDeepLinkContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(IngotDeepLinkContribution);
});
