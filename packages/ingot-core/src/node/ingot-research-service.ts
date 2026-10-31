import { inject, injectable } from '@theia/core/shared/inversify';
import { IngotAccountBackend } from './account/ingot-account-backend';
import { ideHeaders } from '../common/account/gateway.utils';
import { parseProviderError, redactSecrets } from '../common/models/models.utils';
import { PRODUCT } from '../common/product.consts';
import { DEFAULT_RESEARCH_COST_USD, DEFAULT_RESEARCH_PAGES, RESEARCH_FEATURE, RESEARCH_PATH, RESEARCH_SIGN_IN, RESEARCH_TIMEOUT_MS, RESEARCH_TTL_MS } from '../common/research/research.consts';
import type { ResearchEvent, ResearchOptions, ResearchPoll, ResearchService } from '../common/research/research.types';
import { parseSse, researchErrorText } from '../common/research/research.utils';

interface ResearchRun {
    readonly events: ResearchEvent[];
    done: boolean;
    error?: string;
    readonly controller: AbortController;
}

/**
 * IDEA-314: Deep Research runs on the Ingot server (`POST /v1/research`, SSE) with the signed-in account's token.
 * The token stays in the backend; the frontend polls the parsed events.
 */
@injectable()
export class IngotResearchService implements ResearchService {

    @inject(IngotAccountBackend) protected readonly account: IngotAccountBackend;

    protected readonly runs = new Map<string, ResearchRun>();
    protected counter = 0;

    async start(question: string, options: ResearchOptions = {}): Promise<string> {
        const token = await this.account.accessToken().catch(() => undefined);
        if (!token) {
            throw new Error(RESEARCH_SIGN_IN);
        }
        const id = `research-${Date.now().toString(36)}-${this.counter++}`;
        const run: ResearchRun = { events: [], done: false, controller: new AbortController() };
        this.runs.set(id, run);
        const body = { question: question.trim(), maxCostUsd: options.maxCostUsd ?? DEFAULT_RESEARCH_COST_USD, maxPages: options.maxPages ?? DEFAULT_RESEARCH_PAGES };
        this.pump(run, token, body).finally(() => {
            run.done = true;
            this.account.usageChanged();
            setTimeout(() => this.runs.delete(id), RESEARCH_TTL_MS);
        });
        return id;
    }

    async poll(id: string, from: number): Promise<ResearchPoll> {
        const run = this.runs.get(id);
        if (!run) {
            return { events: [], done: true, error: researchErrorText('research_failed') };
        }
        return { events: run.events.slice(from), done: run.done, error: run.error };
    }

    async cancel(id: string): Promise<void> {
        this.runs.get(id)?.controller.abort();
    }

    protected async pump(run: ResearchRun, token: string, body: Record<string, unknown>): Promise<void> {
        try {
            const signal = AbortSignal.any([run.controller.signal, AbortSignal.timeout(RESEARCH_TIMEOUT_MS)]);
            const response = await fetch(`${this.account.gatewayBaseUrl}${RESEARCH_PATH}`, {
                method: 'POST',
                headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream', 'x-ingot-feature': RESEARCH_FEATURE, ...ideHeaders(PRODUCT.version) },
                body: JSON.stringify(body),
                signal
            });
            if (!response.ok || !response.body) {
                const json = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown };
                const message = typeof json.message === 'string' && json.message ? json.message : undefined;
                const code = typeof json.error === 'string' ? json.error : '';
                throw new Error(message ?? (code ? researchErrorText(code) : parseProviderError(json) ?? `Deep research failed (${response.status}).`));
            }
            const decoder = new TextDecoder();
            const reader = response.body.getReader();
            let buffer = '';
            for (;;) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }
                const parsed = parseSse(buffer + decoder.decode(value, { stream: true }));
                buffer = parsed.rest;
                run.events.push(...parsed.events);
            }
            run.events.push(...parseSse(`${buffer}\n`).events);
        } catch (error) {
            if (!run.controller.signal.aborted) {
                run.error = redactSecrets(error instanceof Error ? error.message : String(error), [token]);
            }
        }
    }
}
