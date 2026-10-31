import { inject, injectable } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { IngotModelClient } from '../models/model-client';
import { CHEAP_MODEL_ORDER, SANDBOX_PREFS } from '../../common/sandbox/sandbox.consts';
import type { RiskModel } from '../../common/sandbox/sandbox.types';

/**
 * IDEA-288 / IDEA-293: the cheap model behind auto-review and AI code review. The setting wins, then the first connected
 * cheap model, then the chat's own model (so a local model works too). Calls are single, non-streamed and token-capped.
 */
@injectable()
export class ReviewModelProvider {

    @inject(IngotModelClient) protected readonly models: IngotModelClient;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;

    modelFor(fallback: string): string {
        const chosen = this.preferences.get<string>(SANDBOX_PREFS.reviewModel, '').trim();
        if (chosen && this.models.isModelConfigured(chosen)) {
            return chosen;
        }
        return CHEAP_MODEL_ORDER.find(id => this.models.isModelConfigured(id)) ?? fallback;
    }

    /** A `RiskModel` bound to one model id. */
    model(modelId: string): RiskModel {
        return {
            complete: async (system, user, maxTokens) => (await this.models.complete(modelId, [{ role: 'system', content: system }, { role: 'user', content: user }], { maxTokens, temperature: 0 })).text
        };
    }
}
