import * as fs from 'fs';
import * as path from 'path';
import { AQ_CONFIG_DIR, AQ_TARGET, AQ_USER_SETTINGS } from './agent-quality.consts';
import { budgetLine, checkBudget, MISSING_KEY, resolveOpenRouterKey, seedKeyStore } from './agent-quality.budget';

/**
 * IDEA-282: before every real-model run: stop when there is no key or the budget is spent, seed the dev key store,
 * write unattended settings and start from an empty target folder.
 */
export async function agentQualitySetup(): Promise<void> {
    const key = resolveOpenRouterKey();
    if (!key) {
        throw new Error(MISSING_KEY);
    }
    const budget = await checkBudget(key);
    console.log(budgetLine(budget));
    if (!budget.ok) {
        throw new Error(`Budget stop: ${budgetLine(budget)}. No run started.`);
    }
    seedKeyStore(key);
    fs.mkdirSync(AQ_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(path.join(AQ_CONFIG_DIR, 'settings.json'), JSON.stringify(AQ_USER_SETTINGS, undefined, 4));
    fs.rmSync(path.join(AQ_CONFIG_DIR, 'remote-config.json'), { force: true });
    fs.rmSync(AQ_TARGET, { recursive: true, force: true });
    fs.mkdirSync(AQ_TARGET, { recursive: true });
}

// Playwright requires a default export for globalSetup (tool config exception).
// eslint-disable-next-line no-restricted-syntax
export default agentQualitySetup;
