import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import type { Reference } from '@theia/core/lib/common/reference';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
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
    CODE_ACTION_INVOKE, DIAGNOSTICS_DELAY_MS, DIAGNOSTICS_SETTLE_MS, DIAGNOSTICS_WAIT_MS, LANGUAGE_WARMUP_MS, NO_PROVIDER, PROVIDER_POLL_MS, PROVIDER_WAIT_MS
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
    @inject(EditorManager) protected readonly editors: EditorManager;
    /** Model version of each file when a language server last reported on it (an empty report is still a report). */
    protected readonly reported = new Map<string, number | undefined>();
    /** Languages whose server has reported (or that had their one long wait). */
    protected readonly warmLanguages = new Set<string>();
    /** When each model's text last changed. */
    protected readonly changedAt = new Map<string, number>();

    @postConstruct()
    protected init(): void {
        const watch = (model: monaco.editor.ITextModel): void => {
            model.onDidChangeContent(() => this.changedAt.set(model.uri.toString(), Date.now()));
        };
        monaco.editor.getModels().forEach(watch);
        monaco.editor.onDidCreateModel(watch);
        this.problems.onDidChangeMarkers(uri => {
            if (this.isStale(uri)) {
                return;
            }
            const model = this.modelOf(uri);
            this.reported.set(uri.toString(), model?.getVersionId());
            if (model) {
                this.warmLanguages.add(model.getLanguageId());
            }
        });
    }

    /** Servers wait a moment after an edit before checking: a report sooner than that is for the text before it. */
    protected isStale(uri: URI): boolean {
        const model = this.modelOf(uri);
        return !!model && Date.now() - (this.changedAt.get(model.uri.toString()) ?? 0) < DIAGNOSTICS_DELAY_MS;
    }

    protected modelOf(uri: URI): monaco.editor.ITextModel | null {
        return monaco.editor.getModel(monaco.Uri.parse(uri.toString()));
    }

    protected versionOf(uri: URI): number | undefined {
        return this.modelOf(uri)?.getVersionId();
    }

    protected get features(): ILanguageFeaturesService {
        return StandaloneServices.get(ILanguageFeaturesService);
    }

    /** The file's current text (the editor buffer when it is open). */
    async text(uri: URI): Promise<string> {
        const reference = await this.textModels.createModelReference(uri);
        try {
            return reference.object.textEditorModel.getValue();
        } finally {
            reference.dispose();
        }
    }

    async definitions(root: URI, uri: URI, at: CodePosition): Promise<CodeLocation[]> {
        return this.query(uri, this.features.definitionProvider, async model => {
            const links = await getDefinitionsAtPosition(this.features.definitionProvider, model, new Position(at.line, at.column), false, CancellationToken.None);
            return this.locations(root, links);
        });
    }

    async references(root: URI, uri: URI, at: CodePosition): Promise<CodeLocation[]> {
        return this.query(uri, this.features.referenceProvider, async model => {
            const links = await getReferencesAtPosition(this.features.referenceProvider, model, new Position(at.line, at.column), false, false, CancellationToken.None);
            return this.locations(root, links);
        });
    }

    async renameEdits(uri: URI, at: CodePosition, newName: string): Promise<CodeEditResult> {
        return this.query(uri, this.features.renameProvider, async model => {
            const edit = await rename(this.features.renameProvider, model, new Position(at.line, at.column), newName);
            if (edit.rejectReason) {
                throw new Error(edit.rejectReason);
            }
            return this.textEdits(edit);
        });
    }

    async organizeImportsEdits(uri: URI): Promise<CodeEditResult> {
        return this.query(uri, this.features.codeActionProvider, async model => {
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
        if (!uri) {
            return this.markers(root);
        }
        return this.withModel(uri, async model => {
            const key = uri.toString();
            if (!this.reported.has(key) || this.reported.get(key) !== model.getVersionId()) {
                // Language servers (TypeScript) only check files open in an editor: open it in the background.
                await this.editors.open(uri, { mode: 'open' });
                const language = model.getLanguageId();
                await this.waitForMarkers(uri, this.warmLanguages.has(language) ? DIAGNOSTICS_WAIT_MS : LANGUAGE_WARMUP_MS);
                this.warmLanguages.add(language);
            }
            return this.markers(root, uri);
        });
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

    /** The next diagnostics update for the file (or any file), up to `limitMs`, then a quiet moment (syntax and semantic checks come apart). */
    protected waitForMarkers(uri: URI | undefined, limitMs: number): Promise<void> {
        const key = uri?.toString();
        return new Promise(resolve => {
            let settle: ReturnType<typeof setTimeout> | undefined;
            const done = (): void => {
                clearTimeout(limit);
                clearTimeout(settle);
                listener.dispose();
                resolve();
            };
            const limit = setTimeout(done, limitMs);
            const listener = this.problems.onDidChangeMarkers(changed => {
                if ((key === undefined || changed.toString() === key) && !this.isStale(changed)) {
                    clearTimeout(settle);
                    settle = setTimeout(done, DIAGNOSTICS_SETTLE_MS);
                }
            });
        });
    }

    /**
     * Asks the file's language server. The first time for a language the request only starts the server loading the
     * project (until then it may answer from syntax alone, e.g. TypeScript resolves a definition to the import line), so
     * it is asked again once the server has reported something.
     */
    protected query<T>(uri: URI, registry: LanguageFeatureRegistry<unknown>, run: (model: ITextModel) => Promise<T>): Promise<T> {
        return this.withModel(uri, async model => {
            await this.waitForProvider(registry, model);
            const language = model.getLanguageId();
            if (!this.warmLanguages.has(language)) {
                await run(model).catch(() => undefined);
                await this.waitForMarkers(undefined, LANGUAGE_WARMUP_MS);
                this.warmLanguages.add(language);
            }
            return run(model);
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
