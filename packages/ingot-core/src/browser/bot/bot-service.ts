import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter } from '@theia/core/lib/common/event';
import { Disposable } from '@theia/core/lib/common/disposable';
import { AccountBackend } from '../../common/account/account-protocol';
import { BOT_ACTIVE_POLL_MS, BOT_API_PATH, BOT_IDLE_POLL_MS, BOT_MAX_PROMPT } from '../../common/bot/bot.consts';
import type { BotApproval, BotDecision, BotEntitlement, BotEvent, BotMessage, BotRepo, BotResponse, BotRun, BotSnapshot, BotUsage } from '../../common/bot/bot.types';
import { botErrorText, isActiveRun } from '../../common/bot/bot.utils';
import { IngotAccountService } from '../account/account-service';

/**
 * IDEA-154: the IDE side of Ingot Bot. Same thread as the website (`/api/bot/chat`), live run status and approvals.
 * Every call goes through the account backend, so the access token never reaches the browser.
 */
@injectable()
export class IngotBotService implements Disposable {

    @inject(AccountBackend) protected readonly backend: AccountBackend;
    @inject(IngotAccountService) protected readonly account: IngotAccountService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange = this.onDidChangeEmitter.event;

    protected state: BotSnapshot = { signedIn: false, loading: false, repos: [], repoId: '', messages: [], approvals: [], runs: [] };
    protected timer: ReturnType<typeof setTimeout> | undefined;
    protected visible = false;

    get snapshot(): BotSnapshot { return this.state; }

    @postConstruct()
    protected init(): void {
        this.account.onDidChange(() => { if (this.visible) { void this.refresh(); } });
    }

    /** Polls only while the panel is open. */
    setVisible(visible: boolean): void {
        this.visible = visible;
        if (visible) { void this.refresh(); } else { this.stop(); }
    }

    protected set(patch: Partial<BotSnapshot>): void {
        this.state = { ...this.state, ...patch };
        this.onDidChangeEmitter.fire();
    }

    protected request(method: string, path: string, body?: unknown): Promise<BotResponse> {
        return this.backend.botRequest(method, path, body);
    }

    protected chatPath(): string {
        return `${BOT_API_PATH}/chat${this.state.repoId ? `?repoId=${encodeURIComponent(this.state.repoId)}` : ''}`;
    }

    async refresh(): Promise<void> {
        this.stop();
        if (!this.account.signedIn) {
            this.set({ signedIn: false, loading: false, error: undefined });
            return;
        }
        this.set({ signedIn: true, loading: this.state.entitlement === undefined });
        const [status, usage, repos, chat, approvals, runs] = await Promise.all([
            this.request('GET', `${BOT_API_PATH}/status`), this.request('GET', `${BOT_API_PATH}/usage`), this.request('GET', `${BOT_API_PATH}/repos`),
            this.request('GET', this.chatPath()), this.request('GET', `${BOT_API_PATH}/approvals`), this.request('GET', `${BOT_API_PATH}/runs?limit=20`)
        ]);
        if (status.status !== 200) {
            this.set({ loading: false, error: botErrorText(status) });
        } else {
            this.set({
                loading: false, error: undefined,
                entitlement: status.body.entitlement as BotEntitlement,
                runner: String(status.body.runner ?? ''),
                modelsLive: status.body.modelsLive === true,
                runnerLive: status.body.runnerLive === true,
                usage: usage.status === 200 ? usage.body.usage as BotUsage : this.state.usage,
                repos: repos.status === 200 ? (repos.body.repos as BotRepo[] ?? []).filter(repo => repo.enabled) : this.state.repos,
                messages: chat.status === 200 ? chat.body.messages as BotMessage[] ?? [] : this.state.messages,
                approvals: approvals.status === 200 ? approvals.body.approvals as BotApproval[] ?? [] : this.state.approvals,
                runs: runs.status === 200 ? runs.body.runs as BotRun[] ?? [] : this.state.runs
            });
        }
        this.schedule();
    }

    protected schedule(): void {
        if (!this.visible) { return; }
        const active = this.state.runs.some(isActiveRun);
        this.timer = setTimeout(() => void this.refresh(), active ? BOT_ACTIVE_POLL_MS : BOT_IDLE_POLL_MS);
    }

    protected stop(): void {
        if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    }

    selectRepo(repoId: string): void {
        this.set({ repoId, messages: [] });
        void this.refresh();
    }

    /** Sends a chat message; the server starts a run for it. Returns an error text or ''. */
    async send(text: string): Promise<string> {
        const prompt = text.trim().slice(0, BOT_MAX_PROMPT);
        if (!prompt) { return ''; }
        const response = await this.request('POST', `${BOT_API_PATH}/chat`, { text: prompt, repoId: this.state.repoId || null });
        await this.refresh();
        return response.status === 201 || response.status === 200 ? '' : botErrorText(response);
    }

    async decide(approvalId: string, decision: BotDecision): Promise<string> {
        const response = await this.request('POST', `${BOT_API_PATH}/approvals/${encodeURIComponent(approvalId)}`, { decision });
        await this.refresh();
        return response.status === 200 ? '' : botErrorText(response);
    }

    async cancel(runId: string): Promise<void> {
        await this.request('POST', `${BOT_API_PATH}/runs/${encodeURIComponent(runId)}/cancel`, {});
        await this.refresh();
    }

    async events(runId: string): Promise<BotEvent[]> {
        const response = await this.request('GET', `${BOT_API_PATH}/runs/${encodeURIComponent(runId)}/events`);
        return response.status === 200 ? response.body.events as BotEvent[] ?? [] : [];
    }

    openOnWebsite(): void {
        this.account.openBotPage();
    }

    dispose(): void {
        this.stop();
        this.onDidChangeEmitter.dispose();
    }
}
