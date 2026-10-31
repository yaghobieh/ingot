import URI from '@theia/core/lib/common/uri';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { DEFAULT_POLICY, POLICY_FILE, POLICY_TEMPLATE } from '../../common/policy/agent-policy.consts';
import type { PolicyContext, PolicyLoad } from '../../common/policy/agent-policy.types';
import { parsePolicy } from '../../common/policy/agent-policy.utils';
import { CURSOR_CLI_FILE, CURSOR_SANDBOX_FILE } from '../../common/policy/cursor-policy.consts';
import {
    applyOverlay, cursorOrigins, cursorPermissionsOverlay, cursorSandboxOverlay, isEmptyOverlay, mergeOverlays
} from '../../common/policy/cursor-policy.utils';
import { CursorModeService } from '../import/cursor-mode-service';
import { POLICY_JSON_INDENT } from './policy.consts';

/**
 * IDEA-263: reads the project's `.ingot/policy.json` (fresh on every tool round, so edits apply at once).
 * IDEA-287: while the workspace reads `.cursor` live, `.cursor/cli.json` permissions and `.cursor/sandbox.json` are merged in.
 */
@injectable()
export class AgentPolicyService {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;
    @inject(CursorModeService) protected readonly modes: CursorModeService;

    protected home?: Promise<string | undefined>;

    rootPath(): string | undefined {
        return this.workspace.tryGetRoots()[0]?.resource.path.fsPath();
    }

    async load(root: string | undefined = this.rootPath()): Promise<PolicyLoad> {
        if (!root) {
            return { policy: DEFAULT_POLICY, errors: [], exists: false };
        }
        const base = URI.fromFilePath(root);
        const uri = base.resolve(POLICY_FILE);
        const exists = await this.files.exists(uri).catch(() => false);
        const own: PolicyLoad = exists ? { ...parsePolicy(await this.read(uri)), exists } : { policy: DEFAULT_POLICY, errors: [], exists };
        if (!await this.modes.readsCursor(base).catch(() => false)) {
            return own;
        }
        const [cli, sandbox] = await Promise.all([this.read(base.resolve(CURSOR_CLI_FILE)), this.read(base.resolve(CURSOR_SANDBOX_FILE))]);
        const [cliOverlay, sandboxOverlay] = [cursorPermissionsOverlay(cli), cursorSandboxOverlay(sandbox)];
        const overlay = mergeOverlays(cliOverlay, sandboxOverlay);
        const sources = [...(cli !== undefined ? [CURSOR_CLI_FILE] : []), ...(sandbox !== undefined ? [CURSOR_SANDBOX_FILE] : [])];
        if (isEmptyOverlay(overlay) && !overlay.ignored.length) {
            return own;
        }
        const policy = own.errors.length ? own.policy : applyOverlay(own.policy, overlay, exists);
        const origins = own.errors.length ? [] : cursorOrigins(own.policy, policy, cliOverlay, sandboxOverlay);
        return {
            ...own, policy, sources, ...(overlay.ignored.length ? { ignored: overlay.ignored } : {}), ...(origins.length ? { origins } : {})
        };
    }

    protected async read(uri: URI): Promise<string | undefined> {
        return (await this.files.read(uri).catch(() => undefined))?.value;
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
