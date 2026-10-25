import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common/command';
import { MenuContribution } from '@theia/core/lib/common/menu';
import { IngotGearMenuContribution } from './gear-menu-contribution';

/**
 * Workbench chrome (gear menu, title bar actions, panel toggles, …). A separate module keeps these features
 * independent of the core module's long binding list.
 */
export default new ContainerModule(bind => {
    bind(IngotGearMenuContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(IngotGearMenuContribution);
    bind(MenuContribution).toService(IngotGearMenuContribution);
});
