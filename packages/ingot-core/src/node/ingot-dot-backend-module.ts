import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { RULE_PACKS_SERVICE_PATH } from '../common/rule-packs/rule-packs.consts';
import { RulePacksService } from '../common/rule-packs/rule-packs.types';
import { IngotRulePacksService } from './ingot-rule-packs-service';

/** IDEA-322: Store rule packs (download, lockfile, org packs) run in the backend. */
export default new ContainerModule(bind => {
    bind(IngotRulePacksService).toSelf().inSingletonScope();
    bind(RulePacksService).toService(IngotRulePacksService);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler(RULE_PACKS_SERVICE_PATH, () => ctx.container.get<RulePacksService>(RulePacksService))).inSingletonScope();
});
