import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common/command';
import { MenuContribution } from '@theia/core/lib/common/menu';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ShellLayoutRestorer } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import { IngotGearMenuContribution } from './gear-menu-contribution';
import { AgentsWindowOpener, BrowserAgentsWindowOpener } from './agents-window';
import { IngotAgentsWindowContribution } from './agents-window-contribution';
import { IngotShellLayoutRestorer } from './agents-window-layout-restorer';
import { IngotPanelsContribution } from './panels-contribution';
import { IngotShortcutConflictsContribution } from './shortcut-conflicts-contribution';
import { IngotLayoutCustomContribution } from './layout-custom-contribution';
import '../../../src/browser/style/workbench.css';

/**
 * Workbench chrome (gear menu, title bar actions, Agents Window, panel toggles, …). A separate module keeps these
 * features independent of the core module's long binding list.
 */
export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(IngotGearMenuContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(IngotGearMenuContribution);
    bind(MenuContribution).toService(IngotGearMenuContribution);

    bind(BrowserAgentsWindowOpener).toSelf().inSingletonScope();
    bind(AgentsWindowOpener).toService(BrowserAgentsWindowOpener);
    bind(IngotAgentsWindowContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(IngotAgentsWindowContribution);
    bind(FrontendApplicationContribution).toService(IngotAgentsWindowContribution);
    bind(IngotShellLayoutRestorer).toSelf().inSingletonScope();
    rebind(ShellLayoutRestorer).toService(IngotShellLayoutRestorer);

    bind(IngotPanelsContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(IngotPanelsContribution);
    bind(MenuContribution).toService(IngotPanelsContribution);
    bind(FrontendApplicationContribution).toService(IngotPanelsContribution);

    bind(IngotShortcutConflictsContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(IngotShortcutConflictsContribution);

    bind(IngotLayoutCustomContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(IngotLayoutCustomContribution);
    bind(MenuContribution).toService(IngotLayoutCustomContribution);
    bind(FrontendApplicationContribution).toService(IngotLayoutCustomContribution);
});
