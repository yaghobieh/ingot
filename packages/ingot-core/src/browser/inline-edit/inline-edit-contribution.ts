import { inject, injectable } from '@theia/core/shared/inversify';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AgentStore } from '../agents/agent-store';
import { ChangeTracker } from '../changes/change-tracker';
import { IngotModelClient } from '../models/model-client';
import { AUTO_MODEL_ID } from '../../common/models/models.consts';
import {
    INLINE_EDIT_COMMANDS, INLINE_EDIT_CONTEXT_LINES, INLINE_EDIT_FEATURE, INLINE_EDIT_MAX_TOKENS, INLINE_EDIT_SESSION_PREFIX, INLINE_EDIT_TEMPERATURE, INLINE_EDIT_TEXT
} from '../../common/inline-edit/inline-edit.consts';
import { buildInlineEditMessages, cleanReply, replaceSpan, selectionLineSpan, splitAroundSpan } from '../../common/inline-edit/inline-edit.utils';
import { InlineEditWidget } from './inline-edit-widget';

interface ActiveEdit {
    readonly widget: InlineEditWidget;
    readonly editor: MonacoEditor;
    cancel?: () => void;
}

/**
 * Inline edit (IDEA-262): Cmd+K on a selection asks for an instruction, the chat's model rewrites the selected
 * lines, and the result opens in the agent change review (per-hunk Accept / Reject in the editor, Ctrl+Y / Ctrl+N).
 */
@injectable()
export class InlineEditContribution implements CommandContribution {

    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(IngotModelClient) protected readonly models: IngotModelClient;
    @inject(AgentStore) protected readonly store: AgentStore;
    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;

    protected active?: ActiveEdit;
    protected counter = 0;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(INLINE_EDIT_COMMANDS.start, { execute: () => this.start(), isEnabled: () => !!this.currentEditor() });
    }

    protected currentEditor(): MonacoEditor | undefined {
        const widget = this.editors.currentEditor;
        return widget ? MonacoEditor.get(widget) : undefined;
    }

    start(): void {
        const editor = this.currentEditor();
        const selection = editor?.getControl().getSelection();
        if (!editor || !selection || selection.isEmpty()) {
            this.messages.info(INLINE_EDIT_TEXT.noSelection);
            return;
        }
        this.close();
        const span = selectionLineSpan(selection);
        const active: ActiveEdit = {
            editor,
            widget: new InlineEditWidget(editor.getControl(), span, {
                submit: instruction => void this.submit(active, instruction),
                cancel: () => this.close(active)
            })
        };
        this.active = active;
    }

    protected close(active = this.active): void {
        if (!active) {
            return;
        }
        active.cancel?.();
        active.widget.dispose();
        if (this.active === active) {
            this.active = undefined;
            active.editor.focus();
        }
    }

    protected async submit(active: ActiveEdit, instruction: string): Promise<void> {
        const { editor, widget } = active;
        const model = editor.getControl().getModel();
        const modelId = this.store.resolveModel(this.store.current?.model ?? AUTO_MODEL_ID);
        if (!model) {
            return;
        }
        if (modelId === AUTO_MODEL_ID || !this.models.isModelConfigured(modelId)) {
            widget.setError(INLINE_EDIT_TEXT.noModel);
            return;
        }
        const span = widget.span;
        const parts = splitAroundSpan(model.getValue(), span, INLINE_EDIT_CONTEXT_LINES);
        const path = this.relativePath(editor);
        widget.setBusy(INLINE_EDIT_TEXT.generating);
        const stream = this.models.stream(modelId, buildInlineEditMessages({ path, languageId: model.getLanguageId(), instruction, ...parts }), () => undefined,
            { feature: INLINE_EDIT_FEATURE, maxTokens: INLINE_EDIT_MAX_TOKENS, temperature: INLINE_EDIT_TEMPERATURE });
        active.cancel = stream.cancel;
        try {
            const reply = cleanReply(await stream.done);
            if (this.active !== active) {
                return;
            }
            if (!reply.trim() || reply === parts.selection) {
                widget.setError(INLINE_EDIT_TEXT.unchanged);
                return;
            }
            const next = replaceSpan(model.getValue(), span, reply);
            active.cancel = undefined;
            this.close(active);
            await this.tracker.finalize({ sessionId: `${INLINE_EDIT_SESSION_PREFIX}${++this.counter}`, messageIndex: 0, userIndex: 0 }, path, editor.uri, next);
        } catch (error) {
            if (this.active === active) {
                widget.setError(`${INLINE_EDIT_TEXT.failed}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    protected relativePath(editor: MonacoEditor): string {
        const root = this.workspace.tryGetRoots().find(r => r.resource.isEqualOrParent(editor.uri))?.resource;
        return root?.relative(editor.uri)?.toString() ?? editor.uri.path.base;
    }
}
