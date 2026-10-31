import { inject, injectable } from '@theia/core/shared/inversify';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { IngotModelClient } from '../models/model-client';
import { LearnedHabitStore } from '../habits/learned-store';
import { findModel } from '../../common/models/models.utils';
import type { CatalogModel } from '../../common/models/models.types';
import { blendedPrice, priceOf } from '../../common/cost/cost.utils';
import { learnedId } from '../../common/habits/learned.utils';
import type { LearnedHabit } from '../../common/habits/learned.types';
import { ROUTER_PREFS } from '../../common/router/router.consts';
import type { RouteDecision, TaskSignals, TaskType } from '../../common/router/router.types';
import { pickRoute, profileTask } from '../../common/router/router.utils';

/**
 * IDEA-307 Autopilot Model Router: a simple step (short question, explanation, docs, rename, format) goes to a cheaper
 * connected model; the model the user keeps for a task type is learned as a Habit and preferred. Chinese-origin models
 * and routers of unknown upstream (OpenRouter auto) are never picked (see `isRouterSafe`).
 */
@injectable()
export class ModelRouter {

    @inject(IngotModelClient) protected readonly models: IngotModelClient;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(LearnedHabitStore) protected readonly learned: LearnedHabitStore;

    get enabled(): boolean {
        return this.preferences.get<boolean>(ROUTER_PREFS.enabled, false) === true;
    }

    async setEnabled(on: boolean): Promise<void> {
        await this.preferences.set(ROUTER_PREFS.enabled, on, PreferenceScope.User);
    }

    /** Where this step would go; `learned` is the saved model for its task type. Undefined keeps `current`. */
    decide(current: string, prompt: string, signals: TaskSignals, tokens: number, learned?: string): RouteDecision | undefined {
        const model = findModel(current);
        if (!this.enabled || !model) {
            return undefined;
        }
        const overrides = this.models.settings.modelOverrides ?? {};
        return pickRoute<CatalogModel>({
            current: model, candidates: this.models.catalog, profile: profileTask(prompt, signals), tokens, learned,
            priceOf: m => blendedPrice(priceOf(m)), configured: id => this.models.isModelConfigured(id) && !this.models.unavailableReason(id),
            overrideOf: m => overrides[m.provider]
        });
    }

    /** The decision for a send, with the learned model loaded first. */
    async route(current: string, prompt: string, signals: TaskSignals, tokens: number): Promise<RouteDecision | undefined> {
        if (!this.enabled) {
            return undefined;
        }
        const type = profileTask(prompt, signals).type;
        return this.decide(current, prompt, signals, tokens, await this.learned.value(learnedId('model-choice', type)));
    }

    /** Render-time decision (the composer's estimate) from the habits already loaded. */
    preview(current: string, prompt: string, signals: TaskSignals, tokens: number): RouteDecision | undefined {
        return this.enabled ? this.decide(current, prompt, signals, tokens, this.learned.valueNow(learnedId('model-choice', profileTask(prompt, signals).type))) : undefined;
    }

    /** The user kept (or turned down) `model` for a task type; resolves to the habit when this saved it. */
    recordChoice(taskType: TaskType, model: string, positive: boolean): Promise<LearnedHabit | undefined> {
        return this.learned.record({ kind: 'model-choice', taskType, value: model, positive });
    }
}
