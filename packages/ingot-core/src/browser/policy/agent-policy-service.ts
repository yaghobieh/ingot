import URI from '@theia/core/lib/common/uri';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { DEFAULT_POLICY, POLICY_FILE, POLICY_TEMPLATE } from '../../common/policy/agent-policy.consts';
import type { PolicyContext, PolicyLoad } from '../../common/policy/agent-policy.types';
import { parsePolicy } from '../../common/policy/agent-policy.utils';
import { POLICY_JSON_INDENT } from './policy.consts';

/** IDEA-263: reads the project's `.ingot/policy.json` (fresh on every tool round, so edits apply at once). */
@injectable()
export class AgentPolicyService {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;

    protected home?: Promise<string | undefined>;

    rootPath(): string | undefined {
        return this.workspace.tryGetRoots()[0]?.resource.path.fsPath();
    }

    async load(root: string | undefined = this.rootPath()): Promise<PolicyLoad> {
        if (!root) {
            return { policy: DEFAULT_POLICY, errors: [], exists: false };
        }
        const uri = URI.fromFilePath(root).resolve(POLICY_FILE);
        if (!await this.files.exists(uri).catch(() => false)) {
            return { policy: DEFAULT_POLICY, errors: [], exists: false };
        }
        const text = (await this.files.read(uri).catch(() => undefined))?.value;
        return { ...parsePolicy(text), exists: true };
    }

    async context(root: string, cwd?: string): Promise<PolicyContext> {
        this.home ??= this.env.getHomeDirUri().then(uri => new URI(uri).path.fsPath(), () => undefined);
        const home = await this.home;
        return { root, ...(cwd && cwd !== root ? { cwd } : {}), ...(home ? { home } : {}) };
    }

    /** Writes the template unless the file exists. Returns its URI, or undefined without a project. */
    async createTemplate(): Promise<URI | undefined> {
        const root = this.workspace.tryGetRoots()[0]?.resource;
        if (!root) {
            return undefined;
        }
        const uri = root.resolve(POLICY_FILE);
        if (!await this.files.exists(uri)) {
            await this.files.create(uri, `${JSON.stringify(POLICY_TEMPLATE, undefined, POLICY_JSON_INDENT)}\n`);
        }
        return uri;
    }
}
