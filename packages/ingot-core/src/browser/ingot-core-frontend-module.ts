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

    bind(IngotAboutDialog).toSelf().inSingletonScope();
    rebind(AboutDialog).toService(IngotAboutDialog);
});
