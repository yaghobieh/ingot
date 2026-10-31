import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { TAB_DEFAULT_LIMITS, TAB_PREFERENCES, TAB_USAGE_STORAGE_KEY } from '../../common/tab/tab.consts';
import { addUsage, budgetBlock, tabDay, usageForDay } from '../../common/tab/tab-budget.utils';
import type { TabBudgetBlock, TabLimits, TabUsage } from '../../common/tab/tab.types';

/** Per-day request and token caps for Tab, kept in local storage so every window shares them. */
@injectable()
export class IngotTabUsage {

    @inject(StorageService) protected readonly storage: StorageService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;

    protected readonly onDidChangeEmitter = new Emitter<TabUsage>();
    readonly onDidChange: Event<TabUsage> = this.onDidChangeEmitter.event;

    /** Last usage read or written, for the status bar. */
    last?: TabUsage;

    get limits(): TabLimits {
        return {
            maxRequestsPerDay: this.preferences.get<number>(TAB_PREFERENCES.maxRequestsPerDay, TAB_DEFAULT_LIMITS.maxRequestsPerDay),
            maxTokensPerDay: this.preferences.get<number>(TAB_PREFERENCES.maxTokensPerDay, TAB_DEFAULT_LIMITS.maxTokensPerDay)
        };
    }

    async today(): Promise<TabUsage> {
        this.last = usageForDay(await this.storage.getData<TabUsage>(TAB_USAGE_STORAGE_KEY), tabDay(new Date()));
        return this.last;
    }

    async check(estimatedTokens: number): Promise<TabBudgetBlock | undefined> {
        return budgetBlock(await this.today(), this.limits, estimatedTokens);
    }

    /** Counts one request and its prompt tokens before it is sent. */
    async recordRequest(tokens: number): Promise<void> {
        await this.save(addUsage(await this.today(), tokens));
    }

    async recordReply(tokens: number): Promise<void> {
        const usage = await this.today();
        await this.save({ ...usage, tokens: usage.tokens + tokens });
    }

    protected async save(usage: TabUsage): Promise<void> {
        this.last = usage;
        await this.storage.setData(TAB_USAGE_STORAGE_KEY, usage);
        this.onDidChangeEmitter.fire(usage);
    }
}
