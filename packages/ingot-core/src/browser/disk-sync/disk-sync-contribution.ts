import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChangeType } from '@theia/filesystem/lib/common/files';
import type { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { ChangeTracker } from '../changes/change-tracker';
import { DISK_SYNC_COMMANDS, DISK_SYNC_TEXT } from './disk-sync.consts';

/**
 * IDEA-268: files changed on disk outside the editor (a terminal, git, another agent's worktree) show up live.
 * Clean editors reload right away and again whenever the window gets focus; an editor with unsaved edits asks first.
 * Files with agent hunks waiting for review are left to the change tracker, which re-diffs them after a reload.
 */
@injectable()
export class DiskSyncContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(FileService) protected readonly files: FileService;
    @inject(MonacoTextModelService) protected readonly textModels: MonacoTextModelService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;
    /** Files whose "changed on disk" question is on screen. */
    protected readonly asking = new Set<string>();
    /** Text each file had when Ingot last saved it, so our own saves are not taken for outside changes. */
    protected readonly saved = new Map<string, string>();

    onStart(): void {
        this.textModels.models.forEach(model => this.watchSaves(model));
        this.textModels.onDidCreate(model => this.watchSaves(model));
        this.files.onDidFilesChange(event => {
            for (const model of this.textModels.models) {
                const uri = new URI(model.uri);
                if (event.contains(uri, FileChangeType.UPDATED) || event.contains(uri, FileChangeType.ADDED)) {
                    void this.reload(model, true);
                }
            }
        });
        window.addEventListener('focus', () => void this.reloadAll(false));
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(DISK_SYNC_COMMANDS.reloadAll, { execute: () => this.reloadAll(true) });
    }

    /** Reloads every open file that changed on disk; `askDirty` also asks about files with unsaved edits. */
    async reloadAll(askDirty: boolean): Promise<void> {
        await Promise.all(this.textModels.models.map(model => this.reload(model, askDirty)));
    }

    protected watchSaves(model: MonacoEditorModel): void {
        model.onDidSaveModel(text => this.saved.set(model.uri, text.getValue()));
        model.onDispose(() => this.saved.delete(model.uri));
    }

    protected reviewing(model: MonacoEditorModel): boolean {
        return this.tracker.pending().some(change => change.uri === model.uri);
    }

    protected async reload(model: MonacoEditorModel, askDirty: boolean): Promise<void> {
        if (model.readOnly || this.reviewing(model)) {
            return;
        }
        if (!model.dirty) {
            await model.sync();
            return;
        }
        if (!askDirty || this.asking.has(model.uri)) {
            return;
        }
        const disk = await this.files.read(new URI(model.uri)).then(content => content.value, () => undefined);
        if (disk === undefined || disk === this.saved.get(model.uri)) {
            return;
        }
        if (disk === model.textEditorModel.getValue()) {
            await model.revert({ soft: true });
            return;
        }
        await this.ask(model);
    }

    protected async ask(model: MonacoEditorModel): Promise<void> {
        this.asking.add(model.uri);
        try {
            const choice = await this.messages.warn(DISK_SYNC_TEXT.changed(new URI(model.uri).path.base), DISK_SYNC_TEXT.reload, DISK_SYNC_TEXT.keep);
            if (choice === DISK_SYNC_TEXT.reload) {
                await model.revert();
            }
        } finally {
            this.asking.delete(model.uri);
        }
    }
}
