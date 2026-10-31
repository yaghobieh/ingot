import { inject, injectable } from '@theia/core/shared/inversify';
import { AUTO_REVIEW_BUDGET } from '../../common/sandbox/sandbox.consts';
import type { RiskAssessment, SandboxCheck, SandboxPreset } from '../../common/sandbox/sandbox.types';
import { assessRisk } from '../../common/sandbox/sandbox.utils';
import { ReviewModelProvider } from './review-model';

/** IDEA-288: auto-review. One capped model call per flagged action, at most `maxChecksPerChat` per chat. */
@injectable()
export class AutoReviewer {

    @inject(ReviewModelProvider) protected readonly reviewModels: ReviewModelProvider;

    protected readonly used = new Map<string, number>();

    remaining(chatId: string): number {
        return Math.max(0, AUTO_REVIEW_BUDGET.maxChecksPerChat - (this.used.get(chatId) ?? 0));
    }

    /** `guidance`: IDEA-287 permissions.json `autoRun` instructions, steering (not enforcing) the verdict. */
    async assess(chatId: string, chatModel: string, action: string, check: SandboxCheck, preset: SandboxPreset, guidance = ''): Promise<RiskAssessment> {
        const remaining = this.remaining(chatId);
        if (remaining > 0) {
            this.used.set(chatId, (this.used.get(chatId) ?? 0) + 1);
        }
        const model = this.reviewModels.model(this.reviewModels.modelFor(chatModel));
        return assessRisk(model, action, check, preset, { remaining, maxTokens: AUTO_REVIEW_BUDGET.maxTokens, maxActionChars: AUTO_REVIEW_BUDGET.maxActionChars }, guidance);
    }
}
