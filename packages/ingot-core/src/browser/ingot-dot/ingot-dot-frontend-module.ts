import { ContainerModule } from '@theia/core/shared/inversify';
import { bindViewContribution, FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { ServiceConnectionProvider } from '@theia/core/lib/browser/messaging/service-connection-provider';
import { RULE_PACKS_SERVICE_PATH } from '../../common/rule-packs/rule-packs.consts';
import { RulePacksService } from '../../common/rule-packs/rule-packs.types';
import { SpecsService } from '../specs/specs-service';
import { IngotSpecsWidget } from '../specs/specs-widget';
import { IngotSpecsContribution } from '../specs/specs-contribution';
import { SpecTaskRunner } from '../specs/specs.types';
import { SPECS_WIDGET_ID } from '../specs/specs.consts';
import { IngotPolicyService } from '../ingot-policy/ingot-policy-service';
import { AgentPolicyGate } from '../ingot-policy/agent-policy-gate';
import { IngotPolicyWidget } from '../ingot-policy/policy-widget';
import { IngotPolicyContribution } from '../ingot-policy/policy-contribution';
import { POLICY_WIDGET_ID } from '../ingot-policy/ingot-policy.consts';
import { RulePacksModel } from '../rule-packs/rule-packs-model';
import { IngotRulePacksWidget } from '../rule-packs/rule-packs-widget';
import { IngotRulePacksContribution } from '../rule-packs/rule-packs-contribution';
import { RulePackRemover } from '../rule-packs/rule-packs.types';
import { RULE_PACKS_WIDGET_ID } from '../rule-packs/rule-packs.consts';

/** IDEA-316 ".ingot beyond Cursor": specs (IDEA-324), policy.yaml (IDEA-325 / IDEA-326) and rule packs (IDEA-322). */
export default new ContainerModule(bind => {
    bind(SpecsService).toSelf().inSingletonScope();
    bind(IngotSpecsWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: SPECS_WIDGET_ID, createWidget: () => ctx.container.get(IngotSpecsWidget) })).inSingletonScope();
    bindViewContribution(bind, IngotSpecsContribution);
    bind(SpecTaskRunner).toService(IngotSpecsContribution);

    bind(IngotPolicyService).toSelf().inSingletonScope();
    bind(AgentPolicyGate).toSelf().inSingletonScope();
    bind(IngotPolicyWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: POLICY_WIDGET_ID, createWidget: () => ctx.container.get(IngotPolicyWidget) })).inSingletonScope();
    bindViewContribution(bind, IngotPolicyContribution);
    bind(FrontendApplicationContribution).toService(IngotPolicyContribution);

    bind(RulePacksService).toDynamicValue(ctx => ServiceConnectionProvider.createProxy<RulePacksService>(ctx.container, RULE_PACKS_SERVICE_PATH)).inSingletonScope();
    bind(RulePacksModel).toSelf().inSingletonScope();
    bind(IngotRulePacksWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({ id: RULE_PACKS_WIDGET_ID, createWidget: () => ctx.container.get(IngotRulePacksWidget) })).inSingletonScope();
    bindViewContribution(bind, IngotRulePacksContribution);
    bind(FrontendApplicationContribution).toService(IngotRulePacksContribution);
    bind(RulePackRemover).toService(IngotRulePacksContribution);
});
