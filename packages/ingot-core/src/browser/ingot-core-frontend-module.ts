import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { IngotCoreContribution } from './ingot-core-contribution';

import '../../src/browser/style/index.css';

export default new ContainerModule(bind => {
    bind(IngotCoreContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(IngotCoreContribution);
    bind(MenuContribution).toService(IngotCoreContribution);
});
