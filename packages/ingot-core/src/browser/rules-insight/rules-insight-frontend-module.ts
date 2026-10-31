import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { RulesInsightService } from '../../common/rules-insight/rules-insight.types';
import { RULES_INSIGHT_SERVICE_PATH } from '../../common/rules-insight/rules-insight.consts';
import { RulesDoctorContribution } from './rules-doctor-contribution';

/**
 * Rules insight (IDEA-316 epic): Rules Doctor, Rule Hits, `.ingot` schemas and Effective Rules. Its own module keeps
 * these features out of the core module's binding list.
 */
export default new ContainerModule(bind => {
    bind(RulesInsightService).toDynamicValue(ctx => ServiceConnectionProvider.createProxy<RulesInsightService>(ctx.container, RULES_INSIGHT_SERVICE_PATH)).inSingletonScope();

    bind(RulesDoctorContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(RulesDoctorContribution);
    bind(CommandContribution).toService(RulesDoctorContribution);
});
