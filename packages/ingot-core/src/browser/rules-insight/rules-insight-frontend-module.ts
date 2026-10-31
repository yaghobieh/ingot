import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { WidgetFactory } from '@theia/core/lib/browser/widget-manager';
import { bindViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { RulesInsightService } from '../../common/rules-insight/rules-insight.types';
import { EFFECTIVE_RULES_WIDGET_ID, RULE_HITS_WIDGET_ID, RULES_INSIGHT_SERVICE_PATH } from '../../common/rules-insight/rules-insight.consts';
import { RulesDoctorContribution } from './rules-doctor-contribution';
import { RuleHitsStore } from './rule-hits-store';
import { RuleHitsWidget } from './rule-hits-widget';
import { EffectiveRulesWidget } from './effective-rules-widget';
import { EffectiveRulesContribution, RuleHitsContribution } from './rules-insight-contribution';
import { IngotSchemaContribution } from './ingot-schema-contribution';
import '../../../src/browser/style/rules-insight.css';

/**
 * Rules insight (IDEA-316 epic): Rules Doctor, Rule Hits, `.ingot` schemas and Effective Rules. Its own module keeps
 * these features out of the core module's binding list.
 */
export default new ContainerModule(bind => {
    bind(RulesInsightService).toDynamicValue(ctx => ServiceConnectionProvider.createProxy<RulesInsightService>(ctx.container, RULES_INSIGHT_SERVICE_PATH)).inSingletonScope();

    bind(RulesDoctorContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(RulesDoctorContribution);
    bind(CommandContribution).toService(RulesDoctorContribution);

    bind(RuleHitsStore).toSelf().inSingletonScope();
    bind(RuleHitsWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: RULE_HITS_WIDGET_ID, createWidget: () => ctx.container.get(RuleHitsWidget) })).inSingletonScope();
    bindViewContribution(bind, RuleHitsContribution);

    bind(EffectiveRulesWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: EFFECTIVE_RULES_WIDGET_ID, createWidget: () => ctx.container.get(EffectiveRulesWidget) })).inSingletonScope();
    bindViewContribution(bind, EffectiveRulesContribution);

    bind(IngotSchemaContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(IngotSchemaContribution);
    bind(CommandContribution).toService(IngotSchemaContribution);
});
