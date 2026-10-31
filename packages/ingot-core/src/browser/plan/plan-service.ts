import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { ContextKeyService, type ContextKey } from '@theia/core/lib/browser/context-key-service';
import { IDE_FLAGS } from '../../common/config/remote-config.consts';
import { DEFAULT_PLAN_TIER } from '../../common/plan/plan.consts';
import type { GatedFeature, PlanTier } from '../../common/plan/plan.types';
import { isEntitled, planTierOf } from '../../common/plan/plan.utils';
import { IngotAccountService } from '../account/account-service';
import { IngotFeatureFlags } from '../config/feature-flags';
import { PLAN_AI_KEY, PLAN_TIER_KEY } from './plan.browser-consts';

/**
 * The account's plan tier (IDEA-271): free when signed out, else from the account's plan. AI agent, chat and Rex ask
 * `can(feature)`; the `plan_gate` remote flag turns the gate off.
 */
@injectable()
export class IngotPlanService {

    @inject(IngotAccountService) protected readonly account: IngotAccountService;
    @inject(IngotFeatureFlags) protected readonly flags: IngotFeatureFlags;
    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;

    protected current: PlanTier = DEFAULT_PLAN_TIER;
    protected gateOn = true;
    /** Until the backend has answered, nothing is locked, so a paying user's restored chat is never closed at start-up. */
    protected known = false;
    protected tierKey?: ContextKey<string>;
    protected aiKey?: ContextKey<boolean>;
    protected readonly onDidChangeEmitter = new Emitter<PlanTier>();
    /** Fires when the tier, the gate flag or `known` changes. */
    readonly onDidChange: Event<PlanTier> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.tierKey = this.contextKeys.createKey(PLAN_TIER_KEY, this.current);
        this.aiKey = this.contextKeys.createKey(PLAN_AI_KEY, true);
        this.account.onDidChange(() => this.update());
        this.flags.onDidChange(() => this.update());
        this.account.configure().then(() => {
            this.known = true;
            this.update(true);
        });
    }

    protected update(force = false): void {
        const tier = planTierOf(this.account.snapshot);
        const gateOn = this.flags.enabled(IDE_FLAGS.planGate);
        if (!force && tier === this.current && gateOn === this.gateOn) {
            return;
        }
        this.current = tier;
        this.gateOn = gateOn;
        this.tierKey?.set(tier);
        this.aiKey?.set(this.can('chat'));
        this.onDidChangeEmitter.fire(tier);
    }

    get tier(): PlanTier {
        return this.current;
    }

    can(feature: GatedFeature): boolean {
        return !this.known || !this.gateOn || isEntitled(this.current, feature);
    }

    /** Plans and billing on the portal. */
    openUpgrade(): void {
        this.account.openBilling();
    }
}
