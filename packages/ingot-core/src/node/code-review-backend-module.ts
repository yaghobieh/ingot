import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { CODE_REVIEW_SERVICE_PATH } from '../common/code-review/code-review.consts';
import { CodeReviewService } from '../common/code-review/code-review.types';
import { IngotCodeReviewService } from './ingot-code-review-service';

/** IDEA-293: read-only diffs for AI code review. */
export default new ContainerModule(bind => {
    bind(IngotCodeReviewService).toSelf().inSingletonScope();
    bind(CodeReviewService).toService(IngotCodeReviewService);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler(CODE_REVIEW_SERVICE_PATH, () => ctx.container.get<CodeReviewService>(CodeReviewService))).inSingletonScope();
});
