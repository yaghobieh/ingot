import URI from '@theia/core/lib/common/uri';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { DEFAULT_POLICY, POLICY_FILE, POLICY_TEMPLATE } from '../../common/policy/agent-policy.consts';
import type { PolicyContext, PolicyLoad } from '../../common/policy/agent-policy.types';
import { parsePolicy } from '../../common/policy/agent-policy.utils';
import {
    CURSOR_CLI_FILE, CURSOR_PERMISSIONS_FILE, CURSOR_SANDBOX_FILE, EMPTY_OVERLAY, INGOT_PERMISSIONS_FILE, USER_CURSOR_FILES
} from '../../common/policy/cursor-policy.consts';
import type { PolicyOverlay, PolicySourceOverlay } from '../../common/policy/cursor-policy.types';
import {
    applyOverlay, cursorAllowlistOverlay, cursorOrigins, cursorPermissionsOverlay, cursorSandboxOverlay, isEmptyOverlay, mergeOverlays
} from '../../common/policy/cursor-policy.utils';
import { CONFIG_DIRS, IMPORT_HOME_ENV } from '../../common/project-config/project-config.consts';
import { CursorModeService } from '../import/cursor-mode-service';
import { POLICY_JSON_INDENT } from './policy.consts';

interface PolicyFile {
    readonly file: string;
    readonly uri: URI;
    readonly parse: (text: string | undefined) => PolicyOverlay;
}

/**
 * IDEA-263: reads the project's `.ingot/policy.json` (fresh on every tool round, so edits apply at once).
 * IDEA-287: Cursor's files are merged in, lowest priority first: `~/.cursor/cli-config.json`, `~/.cursor/sandbox.json` and
 * `~/.cursor/permissions.json` in every mode; `.cursor/cli.json`, `.cursor/sandbox.json` and `.cursor/permissions.json`
 * while the workspace reads `.cursor` live; `.ingot/permissions.json` always.
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

    /** `~/.cursor` (or the folder `INGOT_IMPORT_HOME` names, as for the other imported user files). */
    protected async cursorHome(): Promise<URI> {
        const override = (await this.env.getValue(IMPORT_HOME_ENV).catch(() => undefined))?.value;
        return (override ? URI.fromFilePath(override) : new URI(await this.env.getHomeDirUri())).resolve(CONFIG_DIRS.external);
    }

    protected async cursorFiles(base: URI): Promise<PolicyFile[]> {
        const [home, live] = await Promise.all([this.cursorHome(), this.modes.readsCursor(base).catch(() => false)]);
        const user = (name: string) => ({ file: `~/${CONFIG_DIRS.external}/${name}`, uri: home.resolve(name) });
        const project = (file: string) => ({ file, uri: base.resolve(file) });
        return [
            { ...user(USER_CURSOR_FILES.cli), parse: cursorPermissionsOverlay },
            { ...user(USER_CURSOR_FILES.sandbox), parse: cursorSandboxOverlay },
            { ...user(USER_CURSOR_FILES.permissions), parse: cursorAllowlistOverlay },
            ...(live ? [
                { ...project(CURSOR_CLI_FILE), parse: cursorPermissionsOverlay },
                { ...project(CURSOR_SANDBOX_FILE), parse: cursorSandboxOverlay },
                { ...project(CURSOR_PERMISSIONS_FILE), parse: cursorAllowlistOverlay }
            ] : []),
            { ...project(INGOT_PERMISSIONS_FILE), parse: cursorAllowlistOverlay }
        ];
    }

    async load(root: string | undefined = this.rootPath()): Promise<PolicyLoad> {
        if (!root) {
            return { policy: DEFAULT_POLICY, errors: [], exists: false };
        }
        const base = URI.fromFilePath(root);
        const uri = base.resolve(POLICY_FILE);
        const exists = await this.files.exists(uri).catch(() => false);
        const own: PolicyLoad = exists ? { ...parsePolicy(await this.read(uri)), exists } : { policy: DEFAULT_POLICY, errors: [], exists };
        const files = await this.cursorFiles(base);
        const texts = await Promise.all(files.map(file => this.read(file.uri)));
        const found: PolicySourceOverlay[] = files.flatMap((file, i) => texts[i] === undefined ? [] : [{ file: file.file, overlay: file.parse(texts[i]) }]);
        const overlay = found.reduce((merged, source) => mergeOverlays(merged, source.overlay), EMPTY_OVERLAY);
        if (isEmptyOverlay(overlay) && !overlay.ignored.length) {
            return own;
        }
        const policy = own.errors.length ? own.policy : applyOverlay(own.policy, overlay, exists);
        const origins = own.errors.length ? [] : cursorOrigins(own.policy, policy, [...found].reverse());
        const autoRun = overlay.autoRunAllow.length || overlay.autoRunBlock.length ? { allow: overlay.autoRunAllow, block: overlay.autoRunBlock } : undefined;
        return {
            ...own, policy, sources: found.map(source => source.file),
            ...(overlay.ignored.length ? { ignored: overlay.ignored } : {}),
            ...(origins.length ? { origins } : {}),
            ...(overlay.mcpAllow.length ? { mcpAllow: overlay.mcpAllow } : {}),
            ...(autoRun ? { autoRun } : {})
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
