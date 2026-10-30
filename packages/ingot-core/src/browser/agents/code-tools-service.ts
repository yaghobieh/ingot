import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import type { Reference } from '@theia/core/lib/common/reference';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { ProblemManager } from '@theia/markers/lib/browser/problem/problem-manager';
import type { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import * as monaco from '@theia/monaco-editor-core';
import { CancellationToken } from '@theia/monaco-editor-core/esm/vs/base/common/cancellation';
import { Position } from '@theia/monaco-editor-core/esm/vs/editor/common/core/position';
import type { LanguageFeatureRegistry } from '@theia/monaco-editor-core/esm/vs/editor/common/languageFeatureRegistry';
import type { CodeActionTriggerType, LocationLink, WorkspaceEdit } from '@theia/monaco-editor-core/esm/vs/editor/common/languages';
import type { ITextModel } from '@theia/monaco-editor-core/esm/vs/editor/common/model';
import { ILanguageFeaturesService } from '@theia/monaco-editor-core/esm/vs/editor/common/services/languageFeatures';
import { getCodeActions } from '@theia/monaco-editor-core/esm/vs/editor/contrib/codeAction/browser/codeAction';
import { CodeActionKind, CodeActionTriggerSource } from '@theia/monaco-editor-core/esm/vs/editor/contrib/codeAction/common/types';
import { getDefinitionsAtPosition, getReferencesAtPosition } from '@theia/monaco-editor-core/esm/vs/editor/contrib/gotoSymbol/browser/goToSymbol';
import { rename } from '@theia/monaco-editor-core/esm/vs/editor/contrib/rename/browser/rename';
import { StandaloneServices } from '@theia/monaco-editor-core/esm/vs/editor/standalone/browser/standaloneServices';
import { ICommandService } from '@theia/monaco-editor-core/esm/vs/platform/commands/common/commands';
import { Progress } from '@theia/monaco-editor-core/esm/vs/platform/progress/common/progress';
import { previewLine, severityOf } from '../../common/agents/code-tools';
import {
    CODE_ACTION_INVOKE, DIAGNOSTICS_SETTLE_MS, DIAGNOSTICS_WAIT_MS, NO_PROVIDER, PROVIDER_POLL_MS, PROVIDER_WAIT_MS
} from '../../common/agents/code-tools.consts';
import type { CodeDiagnostic, CodeLocation, CodePosition, CodeTextEdit } from '../../common/agents/code-tools.types';

/** Edits per file URI, plus what the language server could not do as a text edit. */
export interface CodeEditResult {
    readonly edits: ReadonlyMap<string, readonly CodeTextEdit[]>;
    readonly skipped: readonly string[];
    /** Organize imports ran as a command (the server wrote the file itself). */
    readonly ranCommand?: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * IDEA-259: the agent's language-server tools. Runs the same providers the editor uses (definition, references,
 * rename, organize imports) on a model of the file, and reads the Problems list for diagnostics.
 */
@injectable()
export class CodeToolsService {

    @inject(MonacoTextModelService) protected readonly textModels: MonacoTextModelService;
    @inject(FileService) protected readonly files: FileService;
    @inject(ProblemManager) protected readonly problems: ProblemManager;

    protected get features(): ILanguageFeaturesService {
        return StandaloneServices.get(ILanguageFeaturesService);
    }

    /** The file's current text (the editor buffer when it is open). */
    async text(uri: URI): Promise<string> {
        return this.withModel(uri, model => Promise.resolve(model.getValue()));
    }

    async definitions(root: URI, uri: URI, at: CodePosition): Promise<CodeLocation[]> {
        return this.withModel(uri, async model => {
            await this.waitForProvider(this.features.definitionProvider, model);
            const links = await getDefinitionsAtPosition(this.features.definitionProvider, model, new Position(at.line, at.column), false, CancellationToken.None);
            return this.locations(root, links);
        });
    }

    async references(root: URI, uri: URI, at: CodePosition): Promise<CodeLocation[]> {
        return this.withModel(uri, async model => {
            await this.waitForProvider(this.features.referenceProvider, model);
            const links = await getReferencesAtPosition(this.features.referenceProvider, model, new Position(at.line, at.column), false, false, CancellationToken.None);
            return this.locations(root, links);
        });
    }

    async renameEdits(uri: URI, at: CodePosition, newName: string): Promise<CodeEditResult> {
        return this.withModel(uri, async model => {
            await this.waitForProvider(this.features.renameProvider, model);
            const edit = await rename(this.features.renameProvider, model, new Position(at.line, at.column), newName);
            if (edit.rejectReason) {
                throw new Error(edit.rejectReason);
            }
            return this.textEdits(edit);
        });
    }

    async organizeImportsEdits(uri: URI): Promise<CodeEditResult> {
        return this.withModel(uri, async model => {
            await this.waitForProvider(this.features.codeActionProvider, model);
            const set = await getCodeActions(this.features.codeActionProvider, model, model.getFullModelRange(), {
                type: CODE_ACTION_INVOKE as CodeActionTriggerType,
                triggerAction: CodeActionTriggerSource.OrganizeImports,
                filter: { include: CodeActionKind.SourceOrganizeImports, includeSourceActions: true }
            }, Progress.None, CancellationToken.None);
            try {
                const item = set.validActions[0];
                if (!item) {
                    return { edits: new Map(), skipped: [] };
                }
                await item.resolve(CancellationToken.None);
                if (item.action.edit?.edits.length) {
                    return this.textEdits(item.action.edit);
                }
                if (item.action.command) {
                    await StandaloneServices.get(ICommandService).executeCommand(item.action.command.id, ...(item.action.command.arguments ?? []));
                    return { edits: new Map(), skipped: [], ranCommand: true };
                }
                return { edits: new Map(), skipped: [] };
            } finally {
                set.dispose();
            }
        });
    }

    /** Problems for one file (opened and checked first) or for every file under the root. */
    async diagnostics(root: URI, uri?: URI): Promise<CodeDiagnostic[]> {
        if (uri) {
            const known = !!monaco.editor.getModel(monaco.Uri.parse(uri.toString()));
            const reference = await this.textModels.createModelReference(uri);
            try {
                if (!known) {
                    await this.waitForMarkers(uri);
                }
                return this.markers(root, uri);
            } finally {
                reference.dispose();
            }
        }
        return this.markers(root);
    }

    protected markers(root: URI, uri?: URI): CodeDiagnostic[] {
        return this.problems.findMarkers(uri ? { uri } : {}).flatMap(marker => {
            const path = root.relative(new URI(marker.uri))?.toString();
            if (!path) {
                return [];
            }
            const d = marker.data;
            return [{
                path, line: d.range.start.line + 1, column: d.range.start.character + 1, severity: severityOf(d.severity), message: d.message,
                ...(d.source ? { source: d.source } : {}), ...(d.code !== undefined ? { code: String(d.code) } : {})
            }];
        });
    }

    /** The first diagnostics update for a file just opened, then a quiet moment (syntax and semantic checks come apart). */
    protected waitForMarkers(uri: URI): Promise<void> {
        const key = uri.toString();
        return new Promise(resolve => {
            let settle: ReturnType<typeof setTimeout> | undefined;
            const done = (): void => {
                clearTimeout(limit);
                clearTimeout(settle);
                listener.dispose();
                resolve();
            };
            const limit = setTimeout(done, DIAGNOSTICS_WAIT_MS);
            const listener = this.problems.onDidChangeMarkers(changed => {
                if (changed.toString() === key) {
                    clearTimeout(settle);
                    settle = setTimeout(done, DIAGNOSTICS_SETTLE_MS);
                }
            });
        });
    }

    protected async withModel<T>(uri: URI, run: (model: ITextModel) => Promise<T>): Promise<T> {
        const reference: Reference<MonacoEditorModel> = await this.textModels.createModelReference(uri);
        try {
            return await run(reference.object.textEditorModel as unknown as ITextModel);
        } finally {
            reference.dispose();
        }
    }

    /** Language servers register when their first file opens; wait for that before asking. */
    protected async waitForProvider(registry: LanguageFeatureRegistry<unknown>, model: ITextModel): Promise<void> {
        const until = Date.now() + PROVIDER_WAIT_MS;
        while (!registry.has(model)) {
            if (Date.now() > until) {
                throw new Error(NO_PROVIDER);
            }
            await sleep(PROVIDER_POLL_MS);
        }
    }

    protected async locations(root: URI, links: readonly LocationLink[]): Promise<CodeLocation[]> {
        const lines = new Map<string, Promise<string[]>>();
        const linesOf = (uri: URI): Promise<string[]> => {
            const key = uri.toString();
            let pending = lines.get(key);
            if (!pending) {
                const open = monaco.editor.getModel(monaco.Uri.parse(key));
                pending = open ? Promise.resolve(open.getLinesContent()) : this.files.read(uri).then(file => file.value.split('\n'), () => []);
                lines.set(key, pending);
            }
            return pending;
        };
        const out: CodeLocation[] = [];
        for (const link of links) {
            const uri = new URI(link.uri.toString());
            const path = root.relative(uri)?.toString() ?? uri.path.fsPath();
            const range = link.targetSelectionRange ?? link.range;
            const text = (await linesOf(uri))[range.startLineNumber - 1] ?? '';
            out.push({
                path, preview: previewLine(text),
                range: { startLine: range.startLineNumber, startColumn: range.startColumn, endLine: range.endLineNumber, endColumn: range.endColumn }
            });
        }
        return out;
    }

    protected textEdits(edit: WorkspaceEdit): CodeEditResult {
        const edits = new Map<string, CodeTextEdit[]>();
        const skipped: string[] = [];
        for (const item of edit.edits) {
            if ('textEdit' in item) {
                const key = item.resource.toString();
                const r = item.textEdit.range;
                edits.set(key, [...(edits.get(key) ?? []), {
                    range: { startLine: r.startLineNumber, startColumn: r.startColumn, endLine: r.endLineNumber, endColumn: r.endColumn }, text: item.textEdit.text
                }]);
            } else {
                skipped.push('newResource' in item || 'oldResource' in item ? 'a file rename' : 'a custom edit');
            }
        }
        return { edits, skipped };
    }
}
