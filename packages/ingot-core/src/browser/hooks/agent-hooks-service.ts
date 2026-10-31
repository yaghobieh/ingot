import { Emitter, type Event } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { GitService } from '../../common/git/git.types';
import {
    agentHookPrompt, agentVerdict, gitHookRunner, gitHookScript, HOOK_RUNNER, HOOK_STAGES, HOOK_TIMEOUT_SECONDS, HOOKS_FILE, HOOKS_PREFS, hooksTemplate,
    isAgentStep, isIngotHook, parseHooks, type HookStage, type HookStepResult, type HooksConfig
} from '../../common/git/hooks';
import { AiCommitService } from '../commit/ai-commit-service';
import { IngotModelClient } from '../models/model-client';
import { ProcessStore } from '../processes/process-store';
import { ProjectConfigService } from '../project-config/project-config-service';
import { bugbotGuidance } from '../../common/project-config/bugbot.utils';

export interface HooksRun {
    readonly stage: HookStage;
    readonly results: readonly HookStepResult[];
    readonly passed: boolean;
    readonly errors: readonly string[];
}

/**
 * IDEA-178: runs `.ingot/hooks.json` steps before Ingot commits or pushes (shell steps through the process service,
 * agent steps through the model), and installs the small git hooks that run the shell steps for terminal commits.
 */
@injectable()
export class AgentHooksService {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(GitService) protected readonly git: GitService;
    @inject(ProcessStore) protected readonly processes: ProcessStore;
    @inject(IngotModelClient) protected readonly models: IngotModelClient;
    @inject(AiCommitService) protected readonly aiCommit: AiCommitService;
    @inject(ProjectConfigService) protected readonly projectConfig: ProjectConfigService;

    protected readonly onDidChangeEmitter = new Emitter<HooksRun | undefined>();
    /** Fires while a run goes (step by step) and when it ends; `undefined` clears the panel. */
    readonly onDidChange: Event<HooksRun | undefined> = this.onDidChangeEmitter.event;
    protected current?: HooksRun;

    get enabled(): boolean {
        return this.preferences.get<boolean>(HOOKS_PREFS.enabled, true) !== false;
    }

    get lastRun(): HooksRun | undefined {
        return this.current;
    }

    clear(): void {
        this.current = undefined;
        this.onDidChangeEmitter.fire(undefined);
    }

    protected rootUri(root?: string): URI | undefined {
        return root ? URI.fromFilePath(root) : this.workspace.tryGetRoots()[0]?.resource;
    }

    async loadConfig(root?: string): Promise<{ config: HooksConfig; errors: readonly string[]; exists: boolean }> {
        const base = this.rootUri(root);
        if (!base) {
            return { config: {}, errors: [], exists: false };
        }
        const uri = base.resolve(HOOKS_FILE);
        if (!await this.files.exists(uri)) {
            return { config: {}, errors: [], exists: false };
        }
        const text = (await this.files.read(uri).catch(() => undefined))?.value;
        return { ...parseHooks(text), exists: true };
    }

    /** Runs the stage's steps in order and stops at the first failure. Resolves `passed: true` when there is nothing to run. */
    async run(root: string, stage: HookStage, diff?: () => Promise<string>): Promise<HooksRun> {
        if (!this.enabled) {
            return { stage, results: [], passed: true, errors: [] };
        }
        const { config, errors } = await this.loadConfig(root);
        const steps = config[stage] ?? [];
        if (!steps.length) {
            return { stage, results: [], passed: !errors.length, errors };
        }
        let results: HookStepResult[] = steps.map(step => ({ step, state: 'skipped', output: '', startedAt: 0 }));
        const publish = (passed: boolean): HooksRun => {
            this.current = { stage, results, passed, errors };
            this.onDidChangeEmitter.fire(this.current);
            return this.current;
        };
        let failed = false;
        for (const [i, step] of steps.entries()) {
            if (failed) {
                break;
            }
            const startedAt = Date.now();
            results = results.map((r, j) => j === i ? { ...r, state: 'running', startedAt } : r);
            publish(false);
            let result: HookStepResult;
            if (isAgentStep(step)) {
                result = await this.runAgentStep(step, stage, diff, startedAt, root);
            } else {
                const timeoutMs = (step.timeoutSeconds ?? HOOK_TIMEOUT_SECONDS) * 1000;
                const out = await this.processes.service.run({ cwd: root, command: step.run, origin: 'agent', timeoutMs, maxOutput: 20_000 })
                    .catch((error: unknown) => ({ output: error instanceof Error ? error.message : String(error), info: undefined, movedToBackground: false }));
                const exitCode = out.info?.exitCode;
                if (out.movedToBackground && out.info) {
                    await this.processes.service.stop(out.info.id).catch(() => undefined);
                }
                const ok = !out.movedToBackground && out.info?.status === 'exited' && exitCode === 0;
                result = {
                    step, state: ok ? 'passed' : 'failed', exitCode, startedAt, endedAt: Date.now(),
                    output: `${out.output.trimEnd()}${out.movedToBackground ? `\nStopped: still running after ${timeoutMs / 1000}s.` : ''}`
                };
            }
            failed = result.state === 'failed';
            results = results.map((r, j) => j === i ? result : r);
        }
        return publish(!failed && !errors.length);
    }

    protected async runAgentStep(step: { name: string; agent: string }, stage: HookStage, diff: (() => Promise<string>) | undefined, startedAt: number, root: string): Promise<HookStepResult> {
        const model = this.aiCommit.pickModel();
        if (!model) {
            return { step, state: 'failed', output: 'No model is ready for agent checks. Sign in to Ingot or connect a model, or bypass this time.', startedAt, endedAt: Date.now() };
        }
        try {
            const text = await (diff ? diff() : this.aiCommit.collectDiff());
            // IDEA-287: BUGBOT.md review guidelines (root and the folders of changed files) apply to agent checks.
            const guidance = bugbotGuidance(await this.projectConfig.loadBugbot(this.rootUri(root)).catch(() => []), text);
            const content = [agentHookPrompt(step, stage, text), guidance].filter(Boolean).join('\n\n');
            const answer = await this.models.stream(model, [{ role: 'user', content }], () => undefined,
                { feature: 'agent_hook', maxTokens: 300, temperature: 0 }).done;
            const verdict = agentVerdict(answer);
            return { step, state: verdict.passed ? 'passed' : 'failed', output: answer.trim(), startedAt, endedAt: Date.now() };
        } catch (error) {
            return { step, state: 'failed', output: `The agent check could not run: ${error instanceof Error ? error.message : String(error)}`, startedAt, endedAt: Date.now() };
        }
    }

    /** Writes `.ingot/hooks.json` from the template (never overwrites). Returns the file's URI. */
    async createTemplate(): Promise<URI | undefined> {
        const base = this.rootUri();
        if (!base) {
            return undefined;
        }
        const uri = base.resolve(HOOKS_FILE);
        if (!await this.files.exists(uri)) {
            await this.files.create(uri, hooksTemplate());
        }
        await this.installGitHooks().catch(() => undefined);
        return uri;
    }

    /**
     * Installs the pre-commit / pre-push git hooks that call Ingot's runner. A hook someone else wrote is never
     * replaced; it is reported instead. Off (or no config): Ingot's own hooks are removed.
     */
    async installGitHooks(root?: string): Promise<{ installed: HookStage[]; skipped: string[] }> {
        const base = this.rootUri(root);
        const path = base?.path.fsPath();
        if (!base || !path) {
            return { installed: [], skipped: [] };
        }
        const [gitDir, hooksDir] = (await this.git.run(path, { kind: 'hookDirs' }).catch(() => ({ output: '' }))).output.split('\n').map(l => l.trim());
        if (!gitDir || !hooksDir) {
            return { installed: [], skipped: ['Not a git repository.'] };
        }
        const at = (p: string): URI => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) ? URI.fromFilePath(p) : base.resolve(p);
        const dir = at(gitDir);
        const hooks = at(hooksDir);
        const { config, exists } = await this.loadConfig(path);
        const wanted = this.enabled && exists && this.preferences.get<boolean>(HOOKS_PREFS.installGitHooks, true) !== false;
        const installed: HookStage[] = [];
        const skipped: string[] = [];
        for (const stage of HOOK_STAGES) {
            const hook = hooks.resolve(stage);
            const current = await this.files.exists(hook) ? (await this.files.read(hook)).value : undefined;
            if (current !== undefined && !isIngotHook(current)) {
                skipped.push(`${stage}: a hook from another tool is already there; Ingot left it alone.`);
                continue;
            }
            if (wanted && config[stage]?.length) {
                await this.files.write(hook, gitHookScript(stage));
                await this.git.run(path, { kind: 'chmodHook', stage }).catch(() => undefined);
                installed.push(stage);
            } else if (current !== undefined) {
                await this.files.delete(hook).catch(() => undefined);
            }
        }
        const runner = dir.resolve(HOOK_RUNNER);
        if (installed.length) {
            await this.files.write(runner, gitHookRunner());
        } else if (await this.files.exists(runner)) {
            await this.files.delete(runner).catch(() => undefined);
        }
        return { installed, skipped };
    }
}
