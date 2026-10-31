import * as fs from 'fs';
import * as path from 'path';
import { inject, injectable } from '@theia/core/shared/inversify';
import { KeyStoreService } from '@theia/core/lib/common/key-store';
import {
    clampCostCap, DEFAULT_MAX_TOKENS, exportWrites, isMockModel, loadRules, loadRuleTests, mockCaller, OPENROUTER_BASE_URL, openRouterCaller,
    parseHitLog, planExport, planPrune, pruneEdits, recordHits, resolvePrice, RULE_HITS_FILE, RULES_DIR, runRuleTests, serializeHitLog
} from '../../common/rules-kit';
import type { ExportPlan, ExportTarget, PrunePlan, RuleTestReport } from '../../common/rules-kit';
import { DEFAULT_KEYCHAIN_SERVICE } from '../../common/models/models.consts';
import {
    decideProposal, LEARNED_STATE_FILE, learnFromMessage, learnFromRejection, parseLearnedState, pendingProposals, renderLearnedRule, serializeLearnedState
} from '../../common/learned-rules';
import type { LearnedRuleProposal, LearnedRulesState, RejectedHunk } from '../../common/learned-rules';
import {
    NO_KEY_MESSAGE, OPENROUTER_BASE_URL_ENV, OPENROUTER_KEY_ACCOUNT, OPENROUTER_KEY_ENV, TEST_REPORT_FILE
} from '../../common/rules-tools/rules-tools.consts';
import type { RuleTestListing, RuleTestRequest, RulesToolsService } from '../../common/rules-tools/rules-tools.types';
import { applyWrites, gitAddedAt, openProject, writeState } from './rules-project';

/** IDEA-319/320/323: the `ingot export` / `rules test` / `rules prune` engine for the IDE, on the project folder on disk. */
@injectable()
export class IngotRulesToolsService implements RulesToolsService {

    @inject(KeyStoreService) protected readonly keyStore: KeyStoreService;

    protected readonly keychainService = process.env.INGOT_KEYCHAIN_SERVICE || DEFAULT_KEYCHAIN_SERVICE;
    /** State writes per project and file, one at a time so concurrent agent turns never lose updates. */
    protected readonly stateWrites = new Map<string, Promise<unknown>>();

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

    protected prunePlan(root: string, days: number): PrunePlan {
        const project = openProject(root);
        return planPrune(project, { days, now: new Date(), hits: parseHitLog(project.read(RULE_HITS_FILE)), addedAt: gitAddedAt(root, RULES_DIR) });
    }

    async planPrune(root: string, days: number): Promise<PrunePlan> {
        this.checkRoot(root);
        return this.prunePlan(root, days);
    }

    async applyPrune(root: string, days: number, only: readonly string[]): Promise<PrunePlan> {
        this.checkRoot(root);
        if (only.length) {
            applyWrites(root, pruneEdits(openProject(root), this.prunePlan(root, days), only));
        }
        return this.prunePlan(root, days);
    }

    protected queue<T>(root: string, file: string, task: () => T): Promise<T> {
        const key = path.join(root, file);
        const run = (this.stateWrites.get(key) ?? Promise.resolve()).catch(() => undefined).then(task);
        this.stateWrites.set(key, run);
        return run;
    }

    async recordRuleHits(root: string, paths: readonly string[]): Promise<void> {
        const rules = paths.filter(file => file.startsWith(RULES_DIR));
        if (!rules.length || !root || !fs.existsSync(path.join(root, RULES_DIR))) {
            return;
        }
        await this.queue(root, RULE_HITS_FILE, () => {
            const file = path.join(root, RULE_HITS_FILE);
            const current = fs.existsSync(file) ? parseHitLog(fs.readFileSync(file, 'utf8')) : undefined;
            writeState(root, RULE_HITS_FILE, serializeHitLog(recordHits(current, rules, new Date())));
        }).catch(() => undefined);
    }

    protected readLearned(root: string): LearnedRulesState {
        const file = path.join(root, LEARNED_STATE_FILE);
        return parseLearnedState(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined);
    }

    protected existingRules(root: string): string[] {
        return openProject(root).files.filter(file => file.startsWith(RULES_DIR));
    }

    /** Runs `change` on the learned-rules state and saves it; returns the new proposal, if any. */
    protected learn(root: string, change: (state: LearnedRulesState, taken: string[]) => { state: LearnedRulesState; proposal?: LearnedRuleProposal }): Promise<LearnedRuleProposal | undefined> {
        this.checkRoot(root);
        return this.queue(root, LEARNED_STATE_FILE, () => {
            const before = this.readLearned(root);
            const { state, proposal } = change(before, this.existingRules(root));
            if (state !== before) {
                writeState(root, LEARNED_STATE_FILE, serializeLearnedState(state));
            }
            return proposal;
        });
    }

    async learnFromRejection(root: string, hunks: readonly RejectedHunk[]): Promise<LearnedRuleProposal | undefined> {
        return this.learn(root, (state, taken) => learnFromRejection(state, hunks, new Date(), taken));
    }

    async learnFromMessage(root: string, message: string): Promise<LearnedRuleProposal | undefined> {
        return this.learn(root, (state, taken) => learnFromMessage(state, message, new Date(), taken));
    }

    async listLearnedRules(root: string): Promise<LearnedRuleProposal[]> {
        this.checkRoot(root);
        return pendingProposals(this.readLearned(root));
    }

    async acceptLearnedRule(root: string, id: string, body: string): Promise<string> {
        this.checkRoot(root);
        return this.queue(root, LEARNED_STATE_FILE, () => {
            const state = this.readLearned(root);
            const proposal = pendingProposals(state).find(item => item.id === id);
            if (!proposal) {
                throw new Error('This proposal was already handled.');
            }
            const text = body.trim() || proposal.body;
            applyWrites(root, [{ path: proposal.path, content: renderLearnedRule(proposal, text) }]);
            writeState(root, LEARNED_STATE_FILE, serializeLearnedState(decideProposal(state, id, 'accepted', new Date(), text)));
            return proposal.path;
        });
    }

    async dismissLearnedRule(root: string, id: string): Promise<void> {
        this.checkRoot(root);
        await this.queue(root, LEARNED_STATE_FILE, () => {
            writeState(root, LEARNED_STATE_FILE, serializeLearnedState(decideProposal(this.readLearned(root), id, 'dismissed', new Date())));
        });
    }
}
