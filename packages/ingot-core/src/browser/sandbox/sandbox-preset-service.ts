import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { DEFAULT_PRESET, POLICY_FILE } from '../../common/sandbox/sandbox.consts';
import type { SandboxPreset } from '../../common/sandbox/sandbox.types';
import { parsePreset, withPreset } from '../../common/sandbox/sandbox.utils';

/** IDEA-288: the sandbox / approval preset of each open project, read from and written to `.ingot/policy.json`. */
@injectable()
export class SandboxPresetService {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    protected readonly presets = new Map<string, SandboxPreset>();
    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @postConstruct()
    protected init(): void {
        this.files.onDidFilesChange(event => {
            for (const key of this.presets.keys()) {
                if (event.contains(this.policyUri(new URI(key)))) {
                    void this.load(new URI(key));
                }
            }
        });
        void this.workspace.roots.then(roots => roots[0] && this.load(roots[0].resource));
        this.workspace.onWorkspaceChanged(roots => roots[0] && void this.load(roots[0].resource));
    }

    protected policyUri(root: URI): URI {
        return root.resolve(POLICY_FILE);
    }

    get defaultRoot(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    /** The cached preset (the default until the file was read). */
    peek(root: URI | undefined = this.defaultRoot): SandboxPreset {
        if (!root) {
            return DEFAULT_PRESET;
        }
        const cached = this.presets.get(root.toString());
        if (!cached) {
            void this.load(root);
        }
        return cached ?? DEFAULT_PRESET;
    }

    async load(root: URI): Promise<SandboxPreset> {
        const text = await this.files.read(this.policyUri(root)).then(file => file.value, () => undefined);
        const preset = parsePreset(text);
        const before = this.presets.get(root.toString());
        this.presets.set(root.toString(), preset);
        if (!before || before.sandbox !== preset.sandbox || before.approvals !== preset.approvals || before.network !== preset.network) {
            this.onDidChangeEmitter.fire();
        }
        return preset;
    }

    async set(root: URI, preset: SandboxPreset): Promise<void> {
        const uri = this.policyUri(root);
        const text = await this.files.read(uri).then(file => file.value, () => undefined);
        const next = withPreset(text, preset);
        if (text === undefined) {
            await this.files.createFile(uri, undefined, { overwrite: false }).catch(() => undefined);
        }
        await this.files.write(uri, next);
        this.presets.set(root.toString(), preset);
        this.onDidChangeEmitter.fire();
    }
}
