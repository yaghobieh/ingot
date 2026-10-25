import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { IngotElectronMainContribution } from './ingot-electron-main-contribution';
import { IngotDeepLinkContribution } from './ingot-deep-link-contribution';

export default new ContainerModule(bind => {
    bind(IngotElectronMainContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(IngotElectronMainContribution);
    bind(IngotDeepLinkContribution).toSelf().inSingletonScope();
    bind(ElectronMainApplicationContribution).toService(IngotDeepLinkContribution);
});
