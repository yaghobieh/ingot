import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { ProblemManager } from '@theia/markers/lib/browser/problem/problem-manager';
import type { Diagnostic } from '@theia/core/shared/vscode-languageserver-protocol';
import {
    BUGBOT_TEXT, NO_CHANGES_TEXT, REVIEW_BUDGET, REVIEW_DIAGNOSTIC_OWNER, REVIEW_DIAGNOSTIC_SOURCE, SEVERITY_DIAGNOSTIC
} from '../../common/code-review/code-review.consts';
import { CodeReviewService, type PostResult, type ReviewFinding } from '../../common/code-review/code-review.types';
import { bugbotCommentBody, fixPrompt, reviewDiff } from '../../common/code-review/code-review.utils';
import { bugbotGuidance } from '../../common/project-config/bugbot.utils';
import { ProjectConfigService } from '../project-config/project-config-service';
import { ReviewModelProvider } from '../sandbox/review-model';
import { AgentStore } from '../agents/agent-store';
import { IngotAgentsContribution } from '../agents/agents-contribution';
import { IngotModelClient } from '../models/model-client';
import { LINE_END_COLUMN } from './code-review.browser-consts';

export type ReviewStatus = 'running' | 'done' | 'error';

export interface ReviewRun {
    readonly label: string;
    readonly status: ReviewStatus;
    readonly root: string;
    readonly findings: readonly ReviewFinding[];
    readonly reviewedFiles: readonly string[];
    readonly skippedFiles: readonly string[];
    readonly calls: number;
    readonly model?: string;
    readonly message?: string;
    /** IDEA-287: the pull request reviewed (as typed), so the review can be posted to it. */
    readonly pullRequest?: string;
    readonly posting?: boolean;
    /** Set once posted: the comment URL, or '' when GitHub did not return one. */
    readonly postedUrl?: string;
}

/** IDEA-293: runs AI code reviews and shows the findings as editor diagnostics and in the Review panel. */
@injectable()
export class CodeReviewStore {

    @inject(CodeReviewService) protected readonly backend: CodeReviewService;
    @inject(ReviewModelProvider) protected readonly reviewModels: ReviewModelProvider;
    @inject(IngotModelClient) protected readonly models: IngotModelClient;
    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(IngotAgentsContribution) protected readonly agentsView: IngotAgentsContribution;
    @inject(ProblemManager) protected readonly problems: ProblemManager;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(ProjectConfigService) protected readonly projectConfig: ProjectConfigService;

    protected current?: ReviewRun;
    protected marked: URI[] = [];
    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    get run(): ReviewRun | undefined {
        return this.current;
    }

    get running(): boolean {
        return this.current?.status === 'running';
    }

    reviewLocal(): Promise<ReviewRun | undefined> {
        return this.review(root => this.backend.localDiff(root), 'Local changes');
    }

    reviewPullRequest(ref: string): Promise<ReviewRun | undefined> {
        return this.review(root => this.backend.pullRequestDiff(root, ref), `PR ${ref.trim()}`, ref.trim());
    }

    /** IDEA-287: posts the finished pull request review as a comment on the PR (the user asked for it). */
    async postToPullRequest(): Promise<PostResult> {
        const run = this.current;
        if (!run?.pullRequest || run.status !== 'done' || run.posting) {
            return { ok: false, error: BUGBOT_TEXT.noPullRequest };
        }
        const posting: ReviewRun = { ...run, posting: true };
        this.set(posting);
        const result = await this.backend.postPullRequestComment(run.root, run.pullRequest, bugbotCommentBody(run.label, run.findings, run.reviewedFiles, run.model))
            .catch((error: unknown): PostResult => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        if (this.current === posting) {
            this.set({ ...run, posting: false, ...(result.ok ? { postedUrl: result.url ?? '' } : {}) });
        }
        return result;
    }

    protected set(run: ReviewRun | undefined): void {
        this.current = run;
        this.onDidChangeEmitter.fire();
    }

    protected async review(load: (root: string) => Promise<{ diff: string; label: string; error?: string }>, pending: string, pullRequest?: string): Promise<ReviewRun | undefined> {
        await this.reviewOnce(load, pending, pullRequest);
        return this.current;
    }

    protected async reviewOnce(load: (root: string) => Promise<{ diff: string; label: string; error?: string }>, pending: string, pullRequest?: string): Promise<void> {
        const root = this.workspace.tryGetRoots()[0]?.resource;
        const rootPath = root?.path.fsPath();
        if (this.running) {
            return;
        }
        const empty = { findings: [], reviewedFiles: [], skippedFiles: [], calls: 0, ...(pullRequest ? { pullRequest } : {}) };
        if (!root || !rootPath) {
            this.set({ ...empty, label: pending, status: 'error', root: '', message: 'Open a project first.' });
            return;
        }
        this.clearMarkers();
        this.set({ ...empty, label: pending, status: 'running', root: rootPath });
        try {
            const diff = await load(rootPath);
            if (diff.error) {
                this.set({ ...empty, label: diff.label, status: 'error', root: rootPath, message: diff.error });
                return;
            }
            if (!diff.diff.trim()) {
                this.set({ ...empty, label: diff.label, status: 'done', root: rootPath, message: NO_CHANGES_TEXT });
                return;
            }
            const modelId = this.reviewModels.modelFor(this.agents.resolveModel(this.agents.model));
            this.set({ ...empty, label: diff.label, status: 'running', root: rootPath, model: this.models.label(modelId) });
            // IDEA-287: team rules and BUGBOT.md guidelines (root, and the folders of changed files) shape every review.
            const guidance = bugbotGuidance(await this.projectConfig.loadBugbot(root).catch(() => []), diff.diff, this.projectConfig.appliedTeamRules());
            const outcome = await reviewDiff(diff.diff, diff.label, this.reviewModels.model(modelId), REVIEW_BUDGET, guidance);
            const failed = outcome.errors.length > 0 && outcome.errors.length === outcome.calls;
            this.set({
                label: diff.label, status: failed ? 'error' : 'done', root: rootPath, model: this.models.label(modelId), ...(pullRequest ? { pullRequest } : {}),
                findings: outcome.findings, reviewedFiles: outcome.reviewedFiles, skippedFiles: outcome.skippedFiles, calls: outcome.calls,
                ...(outcome.errors.length ? { message: `The review model failed: ${outcome.errors[0]}` } : {})
            });
            this.setMarkers(root, outcome.findings);
        } catch (error) {
            this.set({ ...empty, label: pending, status: 'error', root: rootPath, message: error instanceof Error ? error.message : String(error) });
        }
    }

    uriOf(finding: ReviewFinding): URI | undefined {
        return this.current?.root ? URI.fromFilePath(this.current.root).resolve(finding.path) : undefined;
    }

    protected setMarkers(root: URI, findings: readonly ReviewFinding[]): void {
        const byPath = new Map<string, Diagnostic[]>();
        for (const finding of findings) {
            const line = finding.line - 1;
            byPath.set(finding.path, [...byPath.get(finding.path) ?? [], {
                range: { start: { line, character: 0 }, end: { line, character: LINE_END_COLUMN } },
                severity: SEVERITY_DIAGNOSTIC[finding.severity],
                source: REVIEW_DIAGNOSTIC_SOURCE,
                code: finding.id,
                message: finding.detail ? `${finding.title}: ${finding.detail}` : finding.title
            }]);
        }
        this.marked = [...byPath.entries()].map(([path, diagnostics]) => {
            const uri = root.resolve(path);
            this.problems.setMarkers(uri, REVIEW_DIAGNOSTIC_OWNER, diagnostics);
            return uri;
        });
    }

    protected clearMarkers(): void {
        this.marked.forEach(uri => this.problems.setMarkers(uri, REVIEW_DIAGNOSTIC_OWNER, []));
        this.marked = [];
    }

    clear(): void {
        this.clearMarkers();
        this.set(undefined);
    }

    find(id: string): ReviewFinding | undefined {
        return this.current?.findings.find(finding => finding.id === id);
    }

    /** "Fix with agent": a new chat with the finding as the prompt. */
    async fix(id: string): Promise<void> {
        const finding = this.find(id);
        if (!finding) {
            return;
        }
        await this.agentsView.openView({ activate: true, reveal: true });
        this.agents.create(`Fix: ${finding.title}`);
        this.agents.send(fixPrompt(finding));
    }
}
