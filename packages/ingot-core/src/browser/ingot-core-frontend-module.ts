import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { bindViewContribution, FrontendApplicationContribution, KeybindingContribution, WidgetFactory } from '@theia/core/lib/browser';
import { AboutDialog } from '@theia/core/lib/browser/about-dialog';
import { IngotCoreContribution } from './ingot-core-contribution';
import { IngotThemeContribution } from './theme/ingot-theme-contribution';
import { IngotMainToolbar } from './shell/ingot-main-toolbar';
import { IngotShellContribution } from './shell/ingot-shell-contribution';
import { IngotWelcomeWidget } from './welcome/ingot-welcome-widget';
import { IngotWelcomeContribution } from './welcome/ingot-welcome-contribution';
import { WELCOME_WIDGET_ID } from './welcome/ingot-welcome.consts';
import { IngotAboutDialog } from './about/ingot-about-dialog';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { PORTS_SERVICE_PATH } from '../common/ports/ports.consts';
import { PortsService } from '../common/ports/ports.types';
import { IngotPortsWidget } from './ports/ingot-ports-widget';
import { IngotPortsContribution } from './ports/ingot-ports-contribution';
import { PORTS_WIDGET_ID } from './ports/ingot-ports.consts';
import { AgentStore } from './agents/agent-store';
import { AgentEditReview } from './agents/agent-edit-review';
import { IngotAgentsWidget } from './agents/agents-widget';
import { IngotAgentsContribution } from './agents/agents-contribution';
import { AGENTS_WIDGET_ID } from './agents/agents.consts';
import { IngotStripeWidget } from './stripe/ingot-stripe-widget';
import { IngotBranchService } from './vcs/ingot-branch-service';
import { IngotStatusBarContribution } from './status/ingot-status-bar-contribution';
import { IngotEditorContribution } from './status/ingot-editor-contribution';
import { EditorContribution } from '@theia/editor/lib/browser/editor-contribution';

import { WorkspaceFileService } from '@theia/workspace/lib/common/workspace-file-service';
import { IngotWorkspaceFileService } from '../common/workspace/ingot-workspace-file-service';
import { IngotGroupService } from './groups/ingot-group-service';
import { IngotProjectTabsWidget } from './groups/project-tabs-widget';
import { IngotGroupsContribution } from './groups/groups-contribution';
import '../../src/browser/style/index.css';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(IngotWorkspaceFileService).toSelf().inSingletonScope();
    rebind(WorkspaceFileService).toService(IngotWorkspaceFileService);
    bind(IngotGroupService).toSelf().inSingletonScope();
    bind(IngotProjectTabsWidget).toSelf().inSingletonScope();
    bind(IngotGroupsContribution).toSelf().inSingletonScope();
    for (const id of [FrontendApplicationContribution, CommandContribution, KeybindingContribution]) {
        bind(id).toService(IngotGroupsContribution);
    }
    bind(IngotCoreContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(IngotCoreContribution);
    bind(MenuContribution).toService(IngotCoreContribution);

    bind(IngotThemeContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(IngotThemeContribution);

    bind(IngotMainToolbar).toSelf().inSingletonScope();
    bind(IngotShellContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(IngotShellContribution);
    bind(CommandContribution).toService(IngotShellContribution);
    bind(KeybindingContribution).toService(IngotShellContribution);

    bind(IngotWelcomeWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: WELCOME_WIDGET_ID, createWidget: () => ctx.container.get(IngotWelcomeWidget) })).inSingletonScope();
    bindViewContribution(bind, IngotWelcomeContribution);
    bind(FrontendApplicationContribution).toService(IngotWelcomeContribution);

    bind(PortsService).toDynamicValue(ctx => ServiceConnectionProvider.createProxy<PortsService>(ctx.container, PORTS_SERVICE_PATH)).inSingletonScope();
    bind(IngotPortsWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: PORTS_WIDGET_ID, createWidget: () => ctx.container.get(IngotPortsWidget) })).inSingletonScope();
    bindViewContribution(bind, IngotPortsContribution);

    bind(AgentStore).toSelf().inSingletonScope();
    bind(AgentEditReview).toSelf().inSingletonScope();
    bind(IngotAgentsWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: AGENTS_WIDGET_ID, createWidget: () => ctx.container.get(IngotAgentsWidget) })).inSingletonScope();
    bindViewContribution(bind, IngotAgentsContribution);

    bind(IngotStripeWidget).toSelf().inSingletonScope();
    bind(IngotBranchService).toSelf().inSingletonScope();
    bind(IngotStatusBarContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(IngotStatusBarContribution);

    bind(IngotEditorContribution).toSelf().inSingletonScope();
    rebind(EditorContribution).toService(IngotEditorContribution);

    bind(IngotAboutDialog).toSelf().inSingletonScope();
    rebind(AboutDialog).toService(IngotAboutDialog);
});
