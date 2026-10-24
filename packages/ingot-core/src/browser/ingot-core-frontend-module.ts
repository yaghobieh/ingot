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
import { AI_CHAT_WIDGET_ID, IngotAiChatWidget } from './ai/ingot-ai-chat-widget';
import { IngotAiChatContribution } from './ai/ingot-ai-chat-contribution';
import { IngotStripeWidget } from './stripe/ingot-stripe-widget';
import { IngotBranchService } from './vcs/ingot-branch-service';
import { IngotStatusBarContribution } from './status/ingot-status-bar-contribution';
import { IngotEditorContribution } from './status/ingot-editor-contribution';
import { EditorContribution } from '@theia/editor/lib/browser/editor-contribution';

import '../../src/browser/style/index.css';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
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

    bind(IngotAiChatWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: AI_CHAT_WIDGET_ID, createWidget: () => ctx.container.get(IngotAiChatWidget) })).inSingletonScope();
    bindViewContribution(bind, IngotAiChatContribution);

    bind(IngotStripeWidget).toSelf().inSingletonScope();
    bind(IngotBranchService).toSelf().inSingletonScope();
    bind(IngotStatusBarContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(IngotStatusBarContribution);

    bind(IngotEditorContribution).toSelf().inSingletonScope();
    rebind(EditorContribution).toService(IngotEditorContribution);

    bind(IngotAboutDialog).toSelf().inSingletonScope();
    rebind(AboutDialog).toService(IngotAboutDialog);
});
