import { inject, injectable } from '@theia/core/shared/inversify';
import * as monaco from '@theia/monaco-editor-core';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { QuickInputService, type QuickPickItem } from '@theia/core/lib/common/quick-pick-service';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import { Emitter } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { ProblemManager } from '@theia/markers/lib/browser/problem/problem-manager';
import { RulesInsightService, type GlobAtPosition, type SchemaSuggestion } from '../../common/rules-insight/rules-insight.types';
import { RULES_INSIGHT_COMMANDS, SCHEMA_DEBOUNCE_MS, SCHEMA_MARKER_OWNER } from '../../common/rules-insight/rules-insight.consts';
import { ruleCostHint, schemaToDiagnostic } from '../../common/rules-insight/rules-insight.utils';
import { frontmatterCompletions, globAt, globPreview, globPreviews, jsonCompletions } from '../../common/rules-insight/schema-completion.utils';
import { schemaAt, schemaForPath, validateIngotFile } from '../../common/rules-engine/schema-validate.utils';
import { classifyRulePath } from '../../common/rules-engine/rule-docs.utils';
import { parseFrontmatterBlock } from '../../common/rules-engine/frontmatter.utils';
import { locationAt, parseJsonTree } from '../../common/rules-engine/json-tree.utils';
import { GLOB_PREVIEW_LIMIT } from '../../common/rules-engine/rules-engine.consts';
import type { IngotFileSchema, TextRange } from '../../common/rules-engine/rules-engine.types';
import { RulesDoctorContribution } from './rules-doctor-contribution';
import { SCHEMA_LANGUAGES, SCHEMA_TRIGGER_CHARACTERS } from './rules-insight.browser-consts';

const FILE_SCHEME = 'file';
const DEFAULT_PREVIEW_GLOB = '**/*.ts';

const SUGGESTION_KINDS: Readonly<Record<SchemaSuggestion['kind'], monaco.languages.CompletionItemKind>> = {
    key: monaco.languages.CompletionItemKind.Property,
    value: monaco.languages.CompletionItemKind.Value,
    glob: monaco.languages.CompletionItemKind.File,
    template: monaco.languages.CompletionItemKind.Snippet
};

const toMonacoRange = (r: TextRange): monaco.IRange => ({ startLineNumber: r.line + 1, startColumn: r.column + 1, endLineNumber: r.endLine + 1, endColumn: r.endColumn + 1 });

const matchCount = (preview: GlobAtPosition): string =>
    preview.error ? ' invalid glob' : preview.matches.length ? ` ${preview.matches.length} file${preview.matches.length === 1 ? '' : 's'}` : ' no files';

/**
 * Schemas for every `.ingot` file (IDEA-321): live validation in the Problems view, key/value completion, hovers, and a
 * live preview of what each rule glob matches.
 */
@injectable()
export class IngotSchemaContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(ProblemManager) protected readonly problems: ProblemManager;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(RulesInsightService) protected readonly service: RulesInsightService;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(RulesDoctorContribution) protected readonly doctor: RulesDoctorContribution;

    protected files: string[] = [];
    protected readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    protected readonly onDidChangeHints = new Emitter<void>();

    onStart(): void {
        const languages = [...SCHEMA_LANGUAGES];
        monaco.languages.registerCompletionItemProvider(languages, {
            triggerCharacters: [...SCHEMA_TRIGGER_CHARACTERS],
            provideCompletionItems: (model, position) => this.complete(model, position)
        });
        monaco.languages.registerHoverProvider(languages, { provideHover: (model, position) => this.hover(model, position) });
        monaco.languages.registerInlayHintsProvider(languages, {
            onDidChangeInlayHints: this.onDidChangeHints.event,
            provideInlayHints: model => ({ hints: this.inlayHints(model), dispose: () => undefined })
        });
        monaco.editor.getModels().forEach(m => this.watch(m));
        monaco.editor.onDidCreateModel(m => this.watch(m));
        this.workspace.ready.then(() => this.refreshFiles()).catch(() => undefined);
        this.doctor.onDidReport(() => this.refreshFiles());
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(RULES_INSIGHT_COMMANDS.globPreview, { execute: (glob?: string) => this.previewGlob(typeof glob === 'string' ? glob : undefined) });
    }

    protected get root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    protected async refreshFiles(): Promise<void> {
        const root = this.root;
        this.files = root ? await this.service.listFiles(root.path.fsPath()).catch(() => this.files) : [];
        this.onDidChangeHints.fire();
    }

    /** Project-relative path (absolute for files outside the project, e.g. `~/.ingot/rules`). */
    protected pathOf(model: monaco.editor.ITextModel): string | undefined {
        if (model.uri.scheme !== FILE_SCHEME) {
            return undefined;
        }
        const uri = new URI(model.uri.toString());
        return this.root?.relative(uri)?.toString() ?? uri.path.toString();
    }

    protected schemaOf(model: monaco.editor.ITextModel): { path: string; schema: IngotFileSchema } | undefined {
        const path = this.pathOf(model);
        const schema = path ? schemaForPath(path) : undefined;
        return path && schema ? { path, schema } : undefined;
    }

    protected watch(model: monaco.editor.ITextModel): void {
        if (!this.schemaOf(model)) {
            return;
        }
        const key = model.uri.toString();
        this.validate(model);
        const listener = model.onDidChangeContent(() => {
            clearTimeout(this.timers.get(key));
            this.timers.set(key, setTimeout(() => this.validate(model), SCHEMA_DEBOUNCE_MS));
        });
        model.onWillDispose(() => {
            listener.dispose();
            clearTimeout(this.timers.get(key));
            this.timers.delete(key);
        });
    }

    protected validate(model: monaco.editor.ITextModel): void {
        const path = this.pathOf(model);
        if (!path || model.isDisposed()) {
            return;
        }
        const { diagnostics } = validateIngotFile(path, model.getValue());
        this.problems.setMarkers(new URI(model.uri.toString()), SCHEMA_MARKER_OWNER, diagnostics.map(schemaToDiagnostic));
        this.onDidChangeHints.fire();
    }

    protected complete(model: monaco.editor.ITextModel, position: monaco.Position): monaco.languages.CompletionList {
        const found = this.schemaOf(model);
        if (!found) {
            return { suggestions: [] };
        }
        const text = model.getValue();
        const json = found.schema.format === 'json';
        const suggestions = json
            ? jsonCompletions(text, model.getOffsetAt(position), found.schema)
            : frontmatterCompletions(text, position.lineNumber - 1, position.column - 1, found.schema, this.files);
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        const line = model.getLineContent(position.lineNumber);
        const inQuotes = line[word.startColumn - 2] === '"';
        return {
            suggestions: suggestions.map((s, i) => ({
                label: s.label,
                kind: SUGGESTION_KINDS[s.kind],
                detail: s.detail,
                documentation: s.documentation,
                sortText: String(i).padStart(3, '0'),
                range: s.kind === 'template' ? model.getFullModelRange() : range,
                ...this.insertion(s, json, inQuotes)
            }))
        };
    }

    protected insertion(s: SchemaSuggestion, json: boolean, inQuotes: boolean): Pick<monaco.languages.CompletionItem, 'insertText' | 'insertTextRules'> {
        if (s.kind !== 'key') {
            return { insertText: s.insertText ?? s.label };
        }
        const choice = s.values?.length ? `\${1|${s.values.join(',')}|}` : '$1';
        if (!json) {
            return { insertText: `${s.label}: ${choice}`, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet };
        }
        if (inQuotes) {
            return { insertText: s.label };
        }
        const value = s.detail?.startsWith('object') ? '{$1}' : s.detail?.startsWith('array') ? '[$1]' : s.detail?.startsWith('string') ? '"$1"' : choice;
        return { insertText: `"${s.label}": ${value}`, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet };
    }

    protected scopeOf(path: string): string {
        return classifyRulePath(path)?.scope ?? '';
    }

    protected hover(model: monaco.editor.ITextModel, position: monaco.Position): monaco.languages.Hover | undefined {
        const found = this.schemaOf(model);
        if (!found) {
            return undefined;
        }
        const text = model.getValue();
        if (found.schema.format === 'frontmatter') {
            const glob = globAt(text, position.lineNumber - 1, position.column - 1, this.scopeOf(found.path), this.files);
            if (glob) {
                return { range: toMonacoRange(glob.range), contents: [{ value: this.globMarkdown(glob) }] };
            }
            const entry = parseFrontmatterBlock(text).entries.find(e => e.keyRange.line === position.lineNumber - 1 && position.column - 1 <= e.keyRange.endColumn);
            const doc = entry && found.schema.schema.properties?.[entry.key]?.description;
            return doc ? { range: toMonacoRange(entry.keyRange), contents: [{ value: `**${entry.key}** — ${doc}` }] } : undefined;
        }
        const offset = model.getOffsetAt(position);
        const location = locationAt(parseJsonTree(text).root, offset);
        const property = location.inKey ? location.node?.properties?.find(p => offset >= p.keyOffset && offset <= p.keyOffset + p.keyLength) : undefined;
        const doc = property && schemaAt(found.schema.schema, [...location.path, property.key])?.description;
        return doc && property ? { contents: [{ value: `**${property.key}** — ${doc}` }] } : undefined;
    }

    protected globMarkdown(preview: GlobAtPosition): string {
        if (preview.error) {
            return `\`${preview.glob}\` — ${preview.error}`;
        }
        if (!preview.matches.length) {
            return `\`${preview.glob}\` matches no files, so this part of the rule never loads.`;
        }
        const shown = preview.matches.slice(0, GLOB_PREVIEW_LIMIT).map(f => `- \`${f}\``).join('\n');
        const more = preview.matches.length > GLOB_PREVIEW_LIMIT ? `\n\n…and ${preview.matches.length - GLOB_PREVIEW_LIMIT} more` : '';
        return `\`${preview.glob}\` matches ${preview.matches.length} file${preview.matches.length === 1 ? '' : 's'}:\n\n${shown}${more}`;
    }

    protected inlayHints(model: monaco.editor.ITextModel): monaco.languages.InlayHint[] {
        const found = this.schemaOf(model);
        if (!found || found.schema.format !== 'frontmatter' || model.isDisposed()) {
            return [];
        }
        const text = model.getValue();
        const hints: monaco.languages.InlayHint[] = globPreviews(text, this.scopeOf(found.path), this.files).map(p => ({
            position: { lineNumber: p.range.endLine + 1, column: p.range.endColumn + 1 },
            label: matchCount(p),
            kind: monaco.languages.InlayHintKind.Type,
            paddingLeft: true,
            tooltip: { value: this.globMarkdown(p) }
        }));
        const report = this.doctor.report;
        const cost = report?.rules.find(r => r.path === found.path);
        if (report && cost && model.getLineCount() > 0) {
            hints.push({ position: { lineNumber: 1, column: model.getLineMaxColumn(1) }, label: ` ${ruleCostHint(cost, report)}`, paddingLeft: true });
        }
        return hints;
    }

    protected cursorGlob(): string | undefined {
        const editor = this.editors.currentEditor?.editor;
        if (!editor) {
            return undefined;
        }
        const rel = this.root?.relative(editor.uri)?.toString();
        if (!rel || !schemaForPath(rel)) {
            return undefined;
        }
        return globAt(editor.document.getText(), editor.cursor.line, editor.cursor.character, this.scopeOf(rel), this.files)?.glob;
    }

    async previewGlob(glob?: string): Promise<void> {
        await this.refreshFiles();
        const pattern = glob ?? this.cursorGlob() ?? await this.quickInput.input({ prompt: 'Glob to preview (relative to the project)', value: DEFAULT_PREVIEW_GLOB });
        if (!pattern) {
            return;
        }
        const editor = this.editors.currentEditor?.editor;
        const rel = editor ? this.root?.relative(editor.uri)?.toString() : undefined;
        const preview = globPreview(pattern, rel ? this.scopeOf(rel) : '', this.files);
        const items: QuickPickItem[] = preview.matches.map(f => ({ label: f, description: '' }));
        const picked = await this.quickInput.showQuickPick(items, {
            title: preview.error ? `${pattern}: ${preview.error}` : `${pattern} — ${preview.matches.length} file${preview.matches.length === 1 ? '' : 's'}`,
            placeholder: preview.matches.length ? 'Open a matching file' : 'No files match this glob'
        });
        const root = this.root;
        if (picked && root) {
            await open(this.opener, root.resolve(picked.label));
        }
    }
}
