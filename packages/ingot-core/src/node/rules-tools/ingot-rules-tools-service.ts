import * as fs from 'fs';
import * as path from 'path';
import { inject, injectable } from '@theia/core/shared/inversify';
import { KeyStoreService } from '@theia/core/lib/common/key-store';
import {
    clampCostCap, DEFAULT_MAX_TOKENS, exportWrites, isMockModel, loadRules, loadRuleTests, mockCaller, OPENROUTER_BASE_URL, openRouterCaller,
    planExport, resolvePrice, runRuleTests
} from '../../common/rules-kit';
import type { ExportPlan, ExportTarget, RuleTestReport } from '../../common/rules-kit';
import { DEFAULT_KEYCHAIN_SERVICE } from '../../common/models/models.consts';
import {
    NO_KEY_MESSAGE, OPENROUTER_BASE_URL_ENV, OPENROUTER_KEY_ACCOUNT, OPENROUTER_KEY_ENV, TEST_REPORT_FILE
} from '../../common/rules-tools/rules-tools.consts';
import type { RuleTestListing, RuleTestRequest, RulesToolsService } from '../../common/rules-tools/rules-tools.types';
import { applyWrites, openProject, writeState } from './rules-project';

/** IDEA-319/320/323: the `ingot export` / `rules test` / `rules prune` engine for the IDE, on the project folder on disk. */
@injectable()
export class IngotRulesToolsService implements RulesToolsService {

    @inject(KeyStoreService) protected readonly keyStore: KeyStoreService;

    protected readonly keychainService = process.env.INGOT_KEYCHAIN_SERVICE || DEFAULT_KEYCHAIN_SERVICE;

    protected checkRoot(root: string): void {
        if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
            throw new Error(`${root || 'The project'} is not a folder.`);
        }
    }

    async planExport(root: string, targets?: readonly ExportTarget[], force?: boolean): Promise<ExportPlan> {
        this.checkRoot(root);
        return this.slim(planExport(openProject(root), { targets, force }));
    }

    async applyExport(root: string, targets?: readonly ExportTarget[], force?: boolean): Promise<ExportPlan> {
        this.checkRoot(root);
        applyWrites(root, exportWrites(planExport(openProject(root), { targets, force })));
        return this.planExport(root, targets, force);
    }

    /** File bodies stay on the backend; the dialog only needs paths, actions and line counts. */
    protected slim(plan: ExportPlan): ExportPlan {
        return { ...plan, files: plan.files.map(({ content: _content, before: _before, ...file }) => file) };
    }

    /** The OpenRouter key from the keychain (Models page), else OPENROUTER_API_KEY; never sent to the frontend or logged. */
    protected async openRouterKey(): Promise<string | undefined> {
        const stored = await this.keyStore.getPassword(this.keychainService, OPENROUTER_KEY_ACCOUNT).catch(() => undefined);
        return stored?.trim() || process.env[OPENROUTER_KEY_ENV]?.trim() || undefined;
    }

    async listRuleTests(root: string): Promise<RuleTestListing> {
        this.checkRoot(root);
        const suite = loadRuleTests(openProject(root));
        return {
            cases: suite.cases.map(({ id, name, file, runs }) => ({ id, name, file, runs })),
            errors: suite.errors,
            keyConfigured: !!await this.openRouterKey(),
            lastReport: this.readReport(root)
        };
    }

    protected readReport(root: string): RuleTestReport | undefined {
        try {
            return JSON.parse(fs.readFileSync(path.join(root, TEST_REPORT_FILE), 'utf8')) as RuleTestReport;
        } catch {
            return undefined;
        }
    }

    async runRuleTests(root: string, request: RuleTestRequest): Promise<RuleTestReport> {
        this.checkRoot(root);
        const project = openProject(root);
        const suite = loadRuleTests(project, request.only);
        const mock = isMockModel(request.model);
        const baseUrl = process.env[OPENROUTER_BASE_URL_ENV]?.trim() || OPENROUTER_BASE_URL;
        let call = mockCaller;
        if (!mock) {
            const apiKey = await this.openRouterKey();
            if (!apiKey) {
                throw new Error(NO_KEY_MESSAGE);
            }
            call = openRouterCaller({ apiKey, model: request.model, fetch, baseUrl });
        }
        const price = await resolvePrice(request.model, fetch, baseUrl);
        if (!price) {
            throw new Error(`Unknown price for ${request.model}, so the cost cap can't be enforced. Pick a model listed on openrouter.ai/models.`);
        }
        const report = await runRuleTests(loadRules(project), suite, {
            model: request.model, price, maxCostUsd: clampCostCap(request.maxCostUsd), maxTokens: DEFAULT_MAX_TOKENS, call
        });
        writeState(root, TEST_REPORT_FILE, `${JSON.stringify({ ...report, ranAt: new Date().toISOString() }, undefined, 2)}\n`);
        return report;
    }
}
