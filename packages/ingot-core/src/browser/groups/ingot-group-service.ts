import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { ApplicationShell, CompositeTreeNode, ExpandableTreeNode, SelectableTreeNode, WidgetManager } from '@theia/core/lib/browser';
import { Saveable } from '@theia/core/lib/browser/saveable';
import { QuickInputService } from '@theia/core/lib/browser/quick-input';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import type { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { FILE_NAVIGATOR_ID, FileNavigatorWidget } from '@theia/navigator/lib/browser/navigator-widget';
import { AgentStore } from '../agents/agent-store';
import { GROUP_NAME_PROMPT } from '../../common/groups/groups.consts';
import { cycleProject, groupFileName, groupFolderPath, isGroupFileName, isUnder } from '../../common/groups/groups.utils';
import { createWorkspaceFile } from '../../common/workspace/workspace.utils';

export interface GroupProject {
    readonly uri: string;
    readonly name: string;
}

type PatchableModel = { createRoot(): Promise<unknown>; updateRoot(): Promise<void>; root: unknown; expandNode(n: unknown): void; selectNode(n: unknown): void };

/**
 * Project groups (IDEA-52): a `.ingot-group` file is a multi-root workspace shown as top-level project tabs.
 * Switching a tab swaps the project context: Project tree root, open editors, terminals and agents.
 */
@injectable()
export class IngotGroupService {

    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(TerminalService) protected readonly terminals: TerminalService;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(WidgetManager) protected readonly widgets: WidgetManager;
    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(FileService) protected readonly files: FileService;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    protected items: GroupProject[] = [];
    protected activeUri?: string;
    protected switching = false;
    protected navigatorPatched = false;
    protected readonly editorsByProject = new Map<string, string[]>();
    protected readonly terminalsByProject = new Map<string, TerminalWidget[]>();

    get isGroup(): boolean {
        const stat = this.workspace.workspace;
        return !!stat && !stat.isDirectory && isGroupFileName(stat.resource.path.toString());
    }

    get projects(): readonly GroupProject[] {
        return this.items;
    }

    get active(): GroupProject | undefined {
        return this.items.find(p => p.uri === this.activeUri);
    }

    async start(): Promise<void> {
        await this.workspace.ready;
        this.workspace.onWorkspaceChanged(() => this.refresh());
        this.workspace.onWorkspaceLocationChanged(() => this.refresh());
        await this.refresh();
    }

    protected async refresh(): Promise<void> {
        const roots = this.isGroup ? await this.workspace.roots : [];
        this.items = roots.map(r => ({ uri: r.resource.toString(), name: r.resource.path.base }));
        if (!this.items.some(p => p.uri === this.activeUri)) {
            this.activeUri = this.items[0]?.uri;
        }
        this.agents.setScope(this.activeUri);
        await this.patchNavigator();
        await this.refreshNavigator();
        this.onDidChangeEmitter.fire();
    }

    async switchTo(uri: string): Promise<void> {
        if (this.switching || uri === this.activeUri || !this.items.some(p => p.uri === uri)) {
            return;
        }
        this.switching = true;
        try {
            const previous = this.activeUri;
            if (previous) {
                await this.parkEditors(previous);
                this.parkTerminals(previous);
            }
            this.activeUri = uri;
            this.agents.setScope(uri);
            await this.refreshNavigator();
            await this.restoreEditors(uri);
            await this.restoreTerminals(uri);
            this.onDidChangeEmitter.fire();
        } finally {
            this.switching = false;
        }
    }

    async cycle(delta: 1 | -1): Promise<void> {
        const next = cycleProject(this.items.map(p => p.uri), this.activeUri, delta);
        if (next) {
            await this.switchTo(next);
        }
    }

    async removeProject(uri: string): Promise<void> {
        if (this.items.length > 1) {
            await this.workspace.removeRoots([new URI(uri)]);
        }
    }

    /** Creates `<name>.ingot-group` next to the current project with the open roots, then opens it in this window. */
    async createGroup(): Promise<URI | undefined> {
        const roots = await this.workspace.roots;
        const [first] = roots;
        if (!first) {
            return undefined;
        }
        const name = await this.quickInput.input({ prompt: GROUP_NAME_PROMPT, placeHolder: 'fullstack' });
        if (!name?.trim()) {
            return undefined;
        }
        const dir = first.resource.parent;
        const target = dir.resolve(groupFileName(name));
        const folders = roots.map(r => groupFolderPath(dir.path.fsPath(), r.resource.path.fsPath()));
        await this.files.write(target, JSON.stringify(createWorkspaceFile(folders), undefined, 2) + '\n');
        await this.workspace.open(target, { preserveWindow: true });
        return target;
    }

    protected async parkEditors(project: string): Promise<void> {
        const open = this.editors.all.filter(e => isUnder(e.editor.uri.toString(), project));
        this.editorsByProject.set(project, open.map(e => e.editor.uri.toString()));
        for (const widget of open) {
            const saveable = Saveable.get(widget);
            if (saveable?.dirty) {
                await saveable.save();
            }
            widget.close();
        }
    }

    protected async restoreEditors(project: string): Promise<void> {
        for (const uri of this.editorsByProject.get(project) ?? []) {
            await this.editors.open(new URI(uri), { mode: 'open' });
        }
    }

    /** Detaches the project's terminals without killing their processes. */
    protected parkTerminals(project: string): void {
        const attached = this.terminals.all.filter(t => t.isAttached);
        this.terminalsByProject.set(project, attached);
        for (const terminal of attached) {
            terminal.parent = null;
        }
    }

    protected async restoreTerminals(project: string): Promise<void> {
        const parked = (this.terminalsByProject.get(project) ?? []).filter(t => !t.isDisposed);
        if (parked.length) {
            for (const terminal of parked) {
                await this.shell.addWidget(terminal, { area: 'bottom' });
            }
            this.shell.activateWidget(parked[0].id);
            return;
        }
        const name = this.items.find(p => p.uri === project)?.name ?? 'Local';
        const terminal = await this.terminals.newTerminal({ title: name, cwd: project, useServerTitle: false });
        await terminal.start();
        this.terminals.open(terminal, { mode: 'reveal' });
    }

    /** The Project tree shows only the active project's root inside a group. */
    protected async patchNavigator(): Promise<void> {
        if (this.navigatorPatched) {
            return;
        }
        const navigator = await this.widgets.getWidget<FileNavigatorWidget>(FILE_NAVIGATOR_ID);
        if (!navigator) {
            return;
        }
        const model = navigator.model as unknown as PatchableModel;
        const createRoot = model.createRoot.bind(model);
        model.createRoot = async () => {
            const root = await createRoot();
            if (this.isGroup && this.activeUri && CompositeTreeNode.is(root)) {
                const children = root.children.filter(c => (c as { uri?: URI }).uri?.toString() === this.activeUri);
                (root as { children: readonly unknown[] }).children = children.length ? children : root.children;
            }
            return root;
        };
        this.navigatorPatched = true;
    }

    protected async refreshNavigator(): Promise<void> {
        const navigator = await this.widgets.getWidget<FileNavigatorWidget>(FILE_NAVIGATOR_ID);
        if (!navigator || !this.navigatorPatched) {
            return;
        }
        const model = navigator.model as unknown as PatchableModel;
        await model.updateRoot();
        const root = model.root;
        if (this.isGroup && CompositeTreeNode.is(root) && root.children.length === 1) {
            const [child] = root.children;
            if (ExpandableTreeNode.is(child) && !child.expanded) {
                model.expandNode(child);
            }
            if (SelectableTreeNode.is(child)) {
                model.selectNode(child);
            }
        }
    }
}
