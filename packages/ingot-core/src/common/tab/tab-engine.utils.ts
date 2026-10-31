import { TAB_MAX_OUTPUT_TOKENS } from './tab.consts';
import { buildTabMessages, parseTabReply } from './tab.utils';
import { estimateTokens } from './tab-budget.utils';
import type { TabEngineDeps, TabOutcome } from './tab.types';

const skipped = (reason: Extract<TabOutcome, { kind: 'skipped' }>['reason'], error?: string): TabOutcome =>
    ({ kind: 'skipped', reason, ...(error ? { error } : {}) });

/**
 * One Tab request: the ignore check comes first so an ignored file is never read into a prompt, then the daily caps
 * (counting the reply's worst case), then the model call. Usage is recorded before sending so a failed call still counts.
 */
export const runTabPrediction = async (deps: TabEngineDeps, linePrefix: string, lineSuffix: string): Promise<TabOutcome> => {
    if (await deps.isIgnored()) {
        return skipped('ignored');
    }
    if (deps.isCancelled()) {
        return skipped('cancelled');
    }
    const messages = buildTabMessages(deps.buildContext());
    const promptTokens = estimateTokens(messages.map(m => m.content).join(''));
    const block = await deps.checkBudget(promptTokens + TAB_MAX_OUTPUT_TOKENS);
    if (block) {
        return skipped(block);
    }
    await deps.recordRequest(promptTokens);
    let reply: string;
    try {
        reply = await deps.complete(messages);
    } catch (error) {
        return skipped('error', error instanceof Error ? error.message : String(error));
    }
    await deps.recordReply(estimateTokens(reply));
    return deps.isCancelled() ? skipped('cancelled') : { kind: 'prediction', prediction: parseTabReply(reply, linePrefix, lineSuffix) };
};
