import { ContainerModule } from '@theia/core/shared/inversify';
import { bindViewContribution, FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core/lib/common/command';
import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { CODE_REVIEW_SERVICE_PATH } from '../../common/code-review/code-review.consts';
import { CodeReviewService } from '../../common/code-review/code-review.types';
import { CodeReviewStore } from './code-review-store';
import { CodeReviewWidget } from './code-review-widget';
import { CodeReviewContribution } from './code-review-contribution';
import { BugbotContribution, bugbotPreferenceSchema } from './bugbot-contribution';
import { CODE_REVIEW_WIDGET_ID } from './code-review.browser-consts';

/** IDEA-293: AI code review of the local diff or a GitHub pull request; IDEA-287: `/bugbot`. */
export default new ContainerModule(bind => {
    bind(CodeReviewService).toDynamicValue(ctx => ServiceConnectionProvider.createProxy<CodeReviewService>(ctx.container, CODE_REVIEW_SERVICE_PATH)).inSingletonScope();
    bind(CodeReviewStore).toSelf().inSingletonScope();
    bind(CodeReviewWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: CODE_REVIEW_WIDGET_ID, createWidget: () => ctx.container.get(CodeReviewWidget) })).inSingletonScope();
    bindViewContribution(bind, CodeReviewContribution);
    bind(FrontendApplicationContribution).toService(CodeReviewContribution);
    bind(BugbotContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(BugbotContribution);
    bind(CommandContribution).toService(BugbotContribution);
    bind(PreferenceContribution).toConstantValue({ schema: bugbotPreferenceSchema });
});
