import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { QuickInputService, type QuickPickItem, type QuickPickItemOrSeparator } from '@theia/core/lib/common/quick-pick-service';
import { isOSX, isWindows } from '@theia/core/lib/common/os';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { DebugConfigurationManager } from '@theia/debug/lib/browser/debug-configuration-manager';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import { DebugSessionOptions } from '@theia/debug/lib/browser/debug-session-options';
import { DebugService } from '@theia/debug/lib/common/debug-service';
import type { DebugSession } from '@theia/debug/lib/browser/debug-session';
import { DebugScope } from '@theia/debug/lib/browser/console/debug-console-items';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import {
    DEBUG_SESSION_COMMANDS, INGOT_DEBUG_COMMANDS, RUNTIME_GUIDES, SCAN_MAX_DEPTH, SCAN_MAX_ENTRIES, SCAN_SKIP_FOLDERS, XDEBUG_INI
} from '../../common/debug/debug.consts';
import { DebugToolsService, type DebugRuntimeKind, type DetectedConfiguration, type LaunchConfiguration, type ProjectFacts, type RuntimeProblem } from '../../common/debug/debug.types';
import { detectConfigurations, missingRuntime, onDemandAdapter, runtimeForType } from '../../common/debug/debug.utils';
import { DEBUG_TEXT } from './debug.browser-consts';

const BUNDLED_HINT_KEY = 'ingot.debug.bundledRuntimeHint';

/**
 * Like a full IDE, the locals of the paused frame are open right away: Theia only expands scopes the adapter marks
 * as `locals`, and the Java / PHP adapters do not set that hint.
 */
const expandLocalScopes = (): void => {
    const proto = DebugScope.prototype as unknown as { expandByDefault(this: DebugScope): boolean; ingotPatched?: boolean };
    if (proto.ingotPatched) {
        return;
    }
    const original = proto.expandByDefault;
    proto.expandByDefault = function (this: DebugScope): boolean {
        return original.call(this) || (!this.expensive && LOCAL_SCOPE.test(this.name));
    };
    proto.ingotPatched = true;
};
const LOCAL_SCOPE = /^local/i;

export interface DebugTarget {
    readonly configuration: LaunchConfiguration;
    readonly workspaceFolderUri?: string;
}

interface TargetPick extends QuickPickItem {
    readonly target?: DebugTarget;
    readonly detected?: DetectedConfiguration;
    readonly edit?: boolean;
}

/**
 * Starts debug sessions the way a full IDE does (IDEA-138): the selected run/debug configuration from launch.json,
 * else one detected from the project (Maven/Gradle, PHP + Xdebug, npm scripts, Python), after checking that the
 * runtime and the debug adapter are installed and guiding the user when they are not.
 */
@injectable()
export class IngotDebugLauncher {

    @inject(DebugConfigurationManager) protected readonly configurations: DebugConfigurationManager;
    @inject(DebugSessionManager) protected readonly sessions: DebugSessionManager;
    @inject(DebugService) protected readonly debugService: DebugService;
    @inject(DebugToolsService) protected readonly tools: DebugToolsService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(TerminalService) protected readonly terminals: TerminalService;
    @inject(WindowService) protected readonly windows: WindowService;
    @inject(StorageService) protected readonly storage: StorageService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    protected detectedConfigurations: DetectedConfiguration[] = [];
    protected selectedDetected?: DetectedConfiguration;

    @postConstruct()
    protected init(): void {
        expandLocalScopes();
        this.workspace.onWorkspaceChanged(() => this.refresh());
        this.configurations.onDidChange(() => this.onDidChangeEmitter.fire());
        this.sessions.onDidChange(() => this.onDidChangeEmitter.fire());
        this.refresh();
    }

    get detected(): readonly DetectedConfiguration[] {
        return this.detectedConfigurations;
    }

    /** Configurations from launch.json (compounds and dynamic ones excluded). */
    get saved(): DebugTarget[] {
        return [...this.configurations.all].filter(DebugSessionOptions.isConfiguration)
            .filter(o => !DebugSessionOptions.isDynamic(o))
            .map(o => ({ configuration: o.configuration as LaunchConfiguration, workspaceFolderUri: o.workspaceFolderUri }));
    }

    /** Name shown in the title bar's run/debug configuration selector. */
    get selectedName(): string | undefined {
        const current = this.configurations.current;
        return (current && DebugSessionOptions.isConfiguration(current) ? current.name : undefined)
            ?? this.selectedDetected?.configuration.name
            ?? this.detectedConfigurations[0]?.configuration.name;
    }

    /** A saved configuration Theia has selected, or a detected one the user picked. */
    get explicitName(): string | undefined {
        const current = this.configurations.current;
        return (current && DebugSessionOptions.isConfiguration(current) ? current.name : undefined) ?? this.selectedDetected?.configuration.name;
    }

    get currentSession(): DebugSession | undefined {
        return this.sessions.currentSession;
    }

    get hasConfiguration(): boolean {
        return this.saved.length > 0 || this.detectedConfigurations.length > 0;
    }

    get sessionActive(): boolean {
        return this.sessions.sessions.length > 0;
    }

    async refresh(): Promise<void> {
        const root = this.root;
        this.detectedConfigurations = root ? detectConfigurations(await this.facts(root)) : [];
        if (this.selectedDetected && !this.detectedConfigurations.some(d => d.configuration.name === this.selectedDetected?.configuration.name)) {
            this.selectedDetected = undefined;
        }
        this.onDidChangeEmitter.fire();
    }

    protected get root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    /** Shallow scan of the project: root names, file extensions and package.json. */
    protected async facts(root: URI): Promise<ProjectFacts> {
        const extensions = new Set<string>();
        let rootFiles: string[] = [];
        let visited = 0;
        const walk = async (uri: URI, depth: number): Promise<void> => {
            if (depth > SCAN_MAX_DEPTH || visited > SCAN_MAX_ENTRIES) {
                return;
            }
            const stat = await this.files.resolve(uri).catch(() => undefined);
            const children = stat?.children ?? [];
            if (depth === 0) {
                rootFiles = children.map(c => c.name);
            }
            for (const child of children) {
                visited++;
                if (child.isDirectory) {
                    if (!(SCAN_SKIP_FOLDERS as readonly string[]).includes(child.name) && !child.name.startsWith('.')) {
                        await walk(child.resource, depth + 1);
                    }
                } else if (child.resource.path.ext) {
                    extensions.add(child.resource.path.ext.toLowerCase());
                }
            }
        };
        await walk(root, 0);
        const packageJson = rootFiles.includes('package.json')
            ? await this.files.read(root.resolve('package.json')).then(c => c.value).catch(() => undefined)
            : undefined;
        return { rootFiles, extensions: [...extensions], packageJson };
    }

    /** Debug (or run without the debugger) the selected configuration. */
    async launch(noDebug = false): Promise<boolean> {
        const target = await this.target();
        if (!target) {
            return false;
        }
        return this.start(target, noDebug);
    }

    async start(target: DebugTarget, noDebug = false): Promise<boolean> {
        if (!await this.ensureReady(target.configuration)) {
            return false;
        }
        const configuration = noDebug ? { ...target.configuration, noDebug: true } : { ...target.configuration };
        const session = await this.sessions.start({ name: configuration.name, configuration, workspaceFolderUri: target.workspaceFolderUri ?? this.root?.toString(), startedByUser: true });
        return !!session;
    }

    async stop(): Promise<void> {
        await this.commands.executeCommand(DEBUG_SESSION_COMMANDS.stop);
    }

    protected async target(): Promise<DebugTarget | undefined> {
        const current = this.configurations.current;
        if (current && DebugSessionOptions.isConfiguration(current) && !DebugSessionOptions.isDynamic(current)) {
            return { configuration: current.configuration as LaunchConfiguration, workspaceFolderUri: current.workspaceFolderUri };
        }
        const saved = this.saved;
        if (saved.length === 1 && this.detectedConfigurations.length === 0) {
            return saved[0];
        }
        if (this.selectedDetected) {
            return { configuration: this.selectedDetected.configuration, workspaceFolderUri: this.root?.toString() };
        }
        if (!this.hasConfiguration) {
            const action = await this.messages.info(DEBUG_TEXT.noConfiguration, DEBUG_TEXT.createConfiguration);
            if (action === DEBUG_TEXT.createConfiguration) {
                await this.commands.executeCommand(INGOT_DEBUG_COMMANDS.editConfigurations.id);
            }
            return undefined;
        }
        if (saved.length === 0 && this.detectedConfigurations.length === 1) {
            return { configuration: this.detectedConfigurations[0].configuration, workspaceFolderUri: this.root?.toString() };
        }
        return this.pick();
    }

    /** Quick pick of saved and detected configurations; picking one selects it for Run / Debug. */
    async pick(): Promise<DebugTarget | undefined> {
        const items: QuickPickItemOrSeparator[] = [];
        const saved = this.saved;
        if (saved.length) {
            items.push({ type: 'separator', label: DEBUG_TEXT.savedGroup });
            items.push(...saved.map((target): TargetPick => ({ label: target.configuration.name, description: target.configuration.type, target })));
        }
        if (this.detectedConfigurations.length) {
            items.push({ type: 'separator', label: DEBUG_TEXT.detectedGroup });
            items.push(...this.detectedConfigurations.map((detected): TargetPick => ({ label: detected.configuration.name, detail: detected.detail, detected })));
        }
        items.push({ type: 'separator', label: '' });
        items.push({ label: INGOT_DEBUG_COMMANDS.editConfigurations.label, edit: true } as TargetPick);
        const picked = await this.quickInput.showQuickPick(items, { placeholder: DEBUG_TEXT.pickPlaceholder }) as TargetPick | undefined;
        if (!picked) {
            return undefined;
        }
        if (picked.edit) {
            await this.commands.executeCommand(INGOT_DEBUG_COMMANDS.editConfigurations.id);
            return undefined;
        }
        return this.select(picked.target, picked.detected);
    }

    select(target?: DebugTarget, detected?: DetectedConfiguration): DebugTarget | undefined {
        if (target) {
            this.selectedDetected = undefined;
            this.configurations.current = this.configurations.find(target.configuration.name, target.workspaceFolderUri);
            this.onDidChangeEmitter.fire();
            return target;
        }
        if (detected) {
            this.selectedDetected = detected;
            this.configurations.current = undefined;
            this.onDidChangeEmitter.fire();
            return { configuration: detected.configuration, workspaceFolderUri: this.root?.toString() };
        }
        return undefined;
    }

    /** Debug adapter and runtime present? Otherwise explain and offer to install, and do not start. */
    async ensureReady(configuration: LaunchConfiguration): Promise<boolean> {
        const adapter = onDemandAdapter(configuration.type);
        if (adapter && !(await this.debugService.debugTypes()).includes(configuration.type)) {
            const action = await this.messages.info(DEBUG_TEXT.adapterMissing(adapter.label), DEBUG_TEXT.install);
            if (action === DEBUG_TEXT.install) {
                await this.commands.executeCommand(DEBUG_SESSION_COMMANDS.installExtension, adapter.extension);
            }
            return false;
        }
        const kind = runtimeForType(configuration.type);
        if (!kind) {
            return true;
        }
        const status = await this.tools.check(kind).catch(() => undefined);
        const problem = missingRuntime(configuration, status);
        if (problem === 'bundled') {
            if (!await this.storage.getData<boolean>(BUNDLED_HINT_KEY)) {
                await this.storage.setData(BUNDLED_HINT_KEY, true);
                this.guide(kind, problem);
            }
            return true;
        }
        if (problem) {
            await this.guide(kind, problem);
            return false;
        }
        return true;
    }

    protected get platform(): 'mac' | 'windows' | 'linux' {
        return isOSX ? 'mac' : isWindows ? 'windows' : 'linux';
    }

    /** Explains what is missing, with one click to type the install command in a terminal or open the guide. */
    async guide(kind: DebugRuntimeKind, problem: RuntimeProblem): Promise<void> {
        const guide = RUNTIME_GUIDES[kind];
        const xdebug = problem === 'xdebug';
        const title = xdebug ? DEBUG_TEXT.xdebugMissing : guide.title;
        const why = xdebug ? DEBUG_TEXT.xdebugWhy(XDEBUG_INI.join('  ')) : guide.why;
        const command = xdebug ? DEBUG_TEXT.xdebugInstall[this.platform] : guide.install[this.platform];
        const show = problem === 'bundled' ? this.messages.info.bind(this.messages) : this.messages.warn.bind(this.messages);
        const action = await show(`${title}. ${why}`, DEBUG_TEXT.installInTerminal, DEBUG_TEXT.openGuide);
        if (action === DEBUG_TEXT.installInTerminal) {
            await this.typeInTerminal(DEBUG_TEXT.terminalTitle(kind), command);
        } else if (action === DEBUG_TEXT.openGuide) {
            this.windows.openNewWindow(guide.url, { external: true });
        }
    }

    /** Types the install command without pressing Enter, so the user reviews and runs it. */
    protected async typeInTerminal(title: string, command: string): Promise<void> {
        const terminal = await this.terminals.newTerminal({ title, cwd: this.root?.toString(), destroyTermOnClose: true });
        await terminal.start();
        this.terminals.open(terminal, { widgetOptions: { area: 'bottom' }, mode: 'activate' });
        terminal.sendText(command);
    }
}
