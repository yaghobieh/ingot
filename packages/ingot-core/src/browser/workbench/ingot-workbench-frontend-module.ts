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
import { PreferenceProvider } from '@theia/core/lib/common/preferences/preference-provider';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { DefaultsPreferenceProvider } from '@theia/core/lib/common/preferences/defaults-preference-provider';
import { SessionPreferenceProvider } from '@theia/core/lib/common/preferences/session-preference-provider';
import { JsonSchemaContribution } from '@theia/core/lib/browser/json-schema-store';
import { WorkspacePreferenceProvider } from '@theia/preferences/lib/browser/workspace-preference-provider';
import { FoldersPreferencesProvider } from '@theia/preferences/lib/browser/folders-preferences-provider';
import { IngotUserConfigsPreferenceProvider } from '../settings/global-settings-provider';
import { IngotGlobalSettingsContribution } from '../settings/global-settings-contribution';
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
    // IDEA-94: the user scope also reads ~/.ingot/ingot.settings.json. rebind drops every scope's provider, so all five
    // are bound again exactly as Theia binds them, with only the user one swapped.
    rebind(PreferenceProvider).to(DefaultsPreferenceProvider).inSingletonScope().whenTargetNamed(PreferenceScope.Default);
    bind(PreferenceProvider).to(SessionPreferenceProvider).inSingletonScope().whenTargetNamed(PreferenceScope.Session);
    bind(PreferenceProvider).to(IngotUserConfigsPreferenceProvider).inSingletonScope().whenTargetNamed(PreferenceScope.User);
    bind(PreferenceProvider).to(WorkspacePreferenceProvider).inSingletonScope().whenTargetNamed(PreferenceScope.Workspace);
    bind(PreferenceProvider).to(FoldersPreferencesProvider).inSingletonScope().whenTargetNamed(PreferenceScope.Folder);
    bind(IngotGlobalSettingsContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(IngotGlobalSettingsContribution);
    bind(JsonSchemaContribution).toService(IngotGlobalSettingsContribution);
    bind(FrontendApplicationContribution).toService(IngotGlobalSettingsContribution);
});
