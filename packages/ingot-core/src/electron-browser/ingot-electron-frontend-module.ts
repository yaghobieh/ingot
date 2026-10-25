import { ContainerModule } from '@theia/core/shared/inversify';
import { ElectronMainMenuFactory } from '@theia/core/lib/electron-browser/menu/electron-main-menu-factory';
import { IngotElectronMenuFactory } from './ingot-electron-menu-factory';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(IngotElectronMenuFactory).toSelf().inSingletonScope();
    rebind(ElectronMainMenuFactory).toService(IngotElectronMenuFactory);
});
