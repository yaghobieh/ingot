import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import type { AgentSession } from '../../common/agents/agents.types';
import {
    ARTIFACT_RUNS_LIMIT, ARTIFACTS_DIR, COMMENTS_FILE, PLAN_FILE, PNG_MEDIA_TYPE, RUN_META_FILE, SCREENSHOTS_DIR, WALKTHROUGH_FILE
} from '../../common/artifacts/artifacts.consts';
import type { ArtifactComment, ArtifactFile, ArtifactRunMeta, WalkthroughInput } from '../../common/artifacts/artifacts.types';
import {
    isSafeArtifactName, isSafeRunId, parseComments, parseRunMeta, planMarkdown, runDir, runIdFor, screenshotName, sortArtifacts, sortRuns, walkthroughMarkdown
} from '../../common/artifacts/artifacts.utils';

/** A run in progress: where it writes and what it wrote so far. */
interface LiveRun {
    readonly root: URI;
    readonly meta: ArtifactRunMeta;
    written: boolean;
    screenshots: string[];
    agentWalkthrough: boolean;
    readonly prompt: string;
    plan?: string;
}

const JSON_INDENT = 2;
const toBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
};
const fromBase64 = (data: string): Uint8Array => Uint8Array.from(atob(data), c => c.charCodeAt(0));

/**
 * IDEA-290: the `.ingot/artifacts/<runId>/` folder of each agent run (plan.md, walkthrough.md, screenshots/,
 * run.json, comments.json). The folder is created on the first write, so plain questions leave nothing behind.
 */
@injectable()
export class ArtifactService {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    protected readonly live = new Map<string, LiveRun>();
    protected readonly turns = new Map<string, number>();
    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    get root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    protected dir(root: URI, runId: string): URI {
        return root.resolve(runDir(runId));
    }

    /** Starts a run for a chat turn. Nothing is written until the agent produces an artifact. */
    begin(session: AgentSession, root: URI | undefined): string | undefined {
        if (!root) {
            return undefined;
        }
        const prompts = session.messages.filter(m => m.role === 'user' && !m.hidden);
        const prior = this.turns.get(session.id) ?? 0;
        const next = Math.max(prompts.length, prior + 1);
        this.turns.set(session.id, next);
        const runId = runIdFor(session.id, next);
        this.live.set(session.id, {
            root, written: false, screenshots: [], agentWalkthrough: false, prompt: prompts[prompts.length - 1]?.text ?? '',
            meta: { runId, sessionId: session.id, title: session.title, startedAt: Date.now() }
        });
        return runId;
    }

    runOf(sessionId: string): string | undefined {
        const run = this.live.get(sessionId);
        return run?.written ? run.meta.runId : undefined;
    }

    protected async writeText(uri: URI, text: string): Promise<void> {
        await this.files.createFile(uri, BinaryBuffer.fromString(text), { overwrite: true });
    }

    protected async ensure(session: AgentSession): Promise<LiveRun | undefined> {
        const run = this.live.get(session.id);
        if (!run) {
            return undefined;
        }
        if (!run.written) {
            run.written = true;
            await this.writeText(this.dir(run.root, run.meta.runId).resolve(RUN_META_FILE), JSON.stringify({ ...run.meta, title: session.title }, undefined, JSON_INDENT));
            session.artifactsRun = run.meta.runId;
        }
        return run;
    }

    /** Writes a markdown artifact; returns its path relative to the project. */
    async write(session: AgentSession, name: string, content: string): Promise<string | undefined> {
        if (!isSafeArtifactName(name) || name.includes('/')) {
            return undefined;
        }
        const run = await this.ensure(session);
        if (!run) {
            return undefined;
        }
        if (name === WALKTHROUGH_FILE) {
            run.agentWalkthrough = true;
        }
        await this.writeText(this.dir(run.root, run.meta.runId).resolve(name), content);
        this.onDidChangeEmitter.fire();
        return `${runDir(run.meta.runId)}/${name}`;
    }

    /** plan.md from the reply's PLAN list; an unchanged plan is not written again. */
    async writePlan(session: AgentSession, plan: readonly string[]): Promise<string | undefined> {
        const run = this.live.get(session.id);
        const text = planMarkdown(session.title, plan);
        if (!run || !plan.length || run.plan === text) {
            return undefined;
        }
        run.plan = text;
        return this.write(session, PLAN_FILE, text);
    }

    /** Saves a PNG (base64, no data: prefix) under screenshots/. */
    async writeScreenshot(session: AgentSession, base64: string): Promise<string | undefined> {
        const run = await this.ensure(session);
        if (!run || !base64) {
            return undefined;
        }
        const name = screenshotName(run.screenshots.length + 1);
        run.screenshots.push(name);
        await this.files.createFile(this.dir(run.root, run.meta.runId).resolve(name), BinaryBuffer.wrap(fromBase64(base64)), { overwrite: true });
        this.onDidChangeEmitter.fire();
        return `${runDir(run.meta.runId)}/${name}`;
    }

    /**
     * Ends the run: writes walkthrough.md when the run produced anything (and the agent did not write its own),
     * and stamps run.json with the end time.
     */
    async finish(session: AgentSession, input: Omit<WalkthroughInput, 'screenshots' | 'title' | 'prompt'>): Promise<void> {
        const run = this.live.get(session.id);
        if (!run) {
            return;
        }
        if (!run.written && !input.files.length) {
            this.live.delete(session.id);
            return;
        }
        await this.ensure(session);
        this.live.delete(session.id);
        const dir = this.dir(run.root, run.meta.runId);
        if (!run.agentWalkthrough) {
            await this.writeText(dir.resolve(WALKTHROUGH_FILE), walkthroughMarkdown({ ...input, title: session.title, prompt: run.prompt, screenshots: run.screenshots }));
        }
        await this.writeText(dir.resolve(RUN_META_FILE), JSON.stringify({ ...run.meta, title: session.title, endedAt: Date.now() }, undefined, JSON_INDENT));
        this.onDidChangeEmitter.fire();
    }

    async listRuns(root = this.root): Promise<ArtifactRunMeta[]> {
        if (!root) {
            return [];
        }
        const stat = await this.files.resolve(root.resolve(ARTIFACTS_DIR)).catch(() => undefined);
        const runs = await Promise.all((stat?.children ?? []).filter(c => c.isDirectory && isSafeRunId(c.name)).map(async c =>
            parseRunMeta(await this.files.read(c.resource.resolve(RUN_META_FILE)).then(r => r.value, () => undefined))
            ?? { runId: c.name, sessionId: '', title: c.name, startedAt: c.mtime ?? 0 }));
        return sortRuns(runs).slice(0, ARTIFACT_RUNS_LIMIT);
    }

    async listFiles(runId: string, root = this.root): Promise<ArtifactFile[]> {
        if (!root || !isSafeRunId(runId)) {
            return [];
        }
        const dir = this.dir(root, runId);
        const stat = await this.files.resolve(dir).catch(() => undefined);
        const names = (stat?.children ?? []).filter(c => !c.isDirectory).map(c => c.name);
        const shots = await this.files.resolve(dir.resolve(SCREENSHOTS_DIR)).catch(() => undefined);
        names.push(...(shots?.children ?? []).filter(c => !c.isDirectory).map(c => `${SCREENSHOTS_DIR}/${c.name}`));
        return sortArtifacts(names);
    }

    async readText(runId: string, name: string, root = this.root): Promise<string> {
        if (!root || !isSafeRunId(runId) || !isSafeArtifactName(name)) {
            return '';
        }
        return this.files.read(this.dir(root, runId).resolve(name)).then(r => r.value, () => '');
    }

    async imageUrl(runId: string, name: string, root = this.root): Promise<string | undefined> {
        if (!root || !isSafeRunId(runId) || !isSafeArtifactName(name)) {
            return undefined;
        }
        const file = await this.files.readFile(this.dir(root, runId).resolve(name)).catch(() => undefined);
        return file ? `data:${PNG_MEDIA_TYPE};base64,${toBase64(file.value.buffer)}` : undefined;
    }

    async comments(runId: string, root = this.root): Promise<ArtifactComment[]> {
        if (!root || !isSafeRunId(runId)) {
            return [];
        }
        return parseComments(await this.files.read(this.dir(root, runId).resolve(COMMENTS_FILE)).then(r => r.value, () => undefined));
    }

    async saveComments(runId: string, comments: readonly ArtifactComment[], root = this.root): Promise<void> {
        if (!root || !isSafeRunId(runId)) {
            return;
        }
        await this.writeText(this.dir(root, runId).resolve(COMMENTS_FILE), JSON.stringify(comments, undefined, JSON_INDENT));
        this.onDidChangeEmitter.fire();
    }
}
