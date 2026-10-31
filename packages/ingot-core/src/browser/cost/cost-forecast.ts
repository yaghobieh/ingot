import { inject, injectable } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { ModelRouter } from '../router/model-router';
import { findModel } from '../../common/models/models.utils';
import { estimateTokens } from '../../common/agents/context-usage';
import { COST_PREFS, DEFAULT_SYSTEM_TOKENS, DEFAULT_WARN_USD } from '../../common/cost/cost.consts';
import type { CostForecast, ForecastRequest } from '../../common/cost/cost.types';
import { estimateRunCost, isOverBudget, priceOf } from '../../common/cost/cost.utils';

/** IDEA-307: the pre-run cost estimate in the composer (token estimate × model price table) and its warning threshold. */
@injectable()
export class CostForecastService {

    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(ModelRouter) protected readonly router: ModelRouter;

    get enabled(): boolean {
        return this.preferences.get<boolean>(COST_PREFS.forecast, true) !== false;
    }

    get warnUsd(): number {
        return Math.max(0, this.preferences.get<number>(COST_PREFS.warnUsd, DEFAULT_WARN_USD));
    }

    forecast(request: ForecastRequest): CostForecast | undefined {
        if (!this.enabled || !request.prompt.trim()) {
            return undefined;
        }
        const promptTokens = estimateTokens(request.prompt);
        const systemTokens = request.systemTokens ?? DEFAULT_SYSTEM_TOKENS;
        const routed = this.router.preview(request.model, request.prompt, { mode: request.mode, files: request.files }, systemTokens + request.historyTokens + promptTokens);
        const target = findModel(routed?.to ?? request.model);
        if (!target) {
            return undefined;
        }
        const price = priceOf(target);
        const estimate = estimateRunCost({ systemTokens, historyTokens: request.historyTokens, promptTokens, mode: request.mode, price });
        const warnUsd = this.warnUsd;
        return { estimate, model: target.id, price, routed, warnUsd, over: isOverBudget(estimate.usd, warnUsd) };
    }
}
