import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { RulesInsightService } from '../../common/rules-insight/rules-insight.types';
import { EFFECTIVE_RULES_LABEL, EFFECTIVE_RULES_WIDGET_ID, FILE_SUGGESTION_LIMIT } from '../../common/rules-insight/rules-insight.consts';
import { formatTokens, globalRelative } from '../../common/rules-insight/rules-insight.utils';
import { STATUS_LABELS } from '../../common/rules-engine/rules-engine.consts';
import type { EffectiveEntry, EffectiveRules } from '../../common/rules-engine/rules-engine.types';
import { RulesDoctorContribution } from './rules-doctor-contribution';
import { EFFECTIVE_TEXT, HIT_ICONS, STATUS_ICONS } from './rules-insight.browser-consts';

/** Effective Rules tool window (IDEA-327): the merged rules for one file, root → package → folder, with override markers. */
@injectable()
export class EffectiveRulesWidget extends ReactWidget {

    @inject(RulesInsightService) protected readonly service: RulesInsightService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;
    @inject(RulesDoctorContribution) protected readonly doctor: RulesDoctorContribution;

    protected file = '';
    protected result?: EffectiveRules;
    protected error?: string;
    protected files: string[] = [];
    protected showMerged = false;
    protected request = 0;

    @postConstruct()
    protected init(): void {
        this.id = EFFECTIVE_RULES_WIDGET_ID;
        this.title.label = EFFECTIVE_RULES_LABEL;
        this.title.caption = EFFECTIVE_RULES_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-layers';
        this.addClass('ingot-toolwindow');
        this.node.tabIndex = 0;
        this.toDispose.push(this.doctor.onDidReport(() => { if (this.result) { this.load(); } }));
    }

    protected get root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    /** The active editor's file, relative to the project. */
    activeFile(): string | undefined {
        const uri = this.editors.currentEditor?.editor.uri;
        return uri && this.root?.isEqualOrParent(uri) ? this.root.relative(uri)?.toString() : undefined;
    }

    async showFile(file: string | undefined): Promise<void> {
        this.file = file ?? this.activeFile() ?? this.file;
        this.update();
        await this.load();
        if (!this.files.length && this.root) {
            this.files = await this.service.listFiles(this.root.path.fsPath()).catch(() => []);
            this.update();
        }
    }

    protected async load(): Promise<void> {
        const root = this.root;
        const file = this.file.trim();
        const request = ++this.request;
        if (!root || !file) {
            this.result = undefined;
            this.update();
            return;
        }
        try {
            const result = await this.service.effective(root.path.fsPath(), file);
            if (request === this.request) {
                this.result = result;
                this.error = undefined;
            }
        } catch (error) {
            if (request === this.request) {
                this.result = undefined;
                this.error = error instanceof Error ? error.message : String(error);
            }
        }
        this.update();
    }

    protected async openRule(path: string): Promise<void> {
        const global = globalRelative(path);
        const uri = global !== undefined ? new URI(await this.env.getConfigDirUri()).resolve(global) : this.root?.resolve(path);
        if (uri) {
            await open(this.opener, uri);
        }
    }

    protected render(): React.ReactNode {
        const query = this.file.toLowerCase();
        const suggestions = this.files.filter(f => f.toLowerCase().includes(query)).slice(0, FILE_SUGGESTION_LIMIT);
        return <div className='ingot-tw ingot-er' id='ingot-effective-rules'>
            <div className='ingot-tw-header'>
                <span className='ingot-tw-title'>{EFFECTIVE_RULES_LABEL}</span>
                {this.result && <span className='ingot-rh-tokens' title='Estimated tokens the agent reads for this file'>~{formatTokens(this.result.tokens)} tokens</span>}
            </div>
            <form className='ingot-er-picker' onSubmit={e => { e.preventDefault(); this.load(); }}>
                <input className='theia-input ingot-er-file' list='ingot-er-files' aria-label='File' placeholder={EFFECTIVE_TEXT.placeholder} value={this.file}
                    onChange={e => { this.file = e.currentTarget.value; this.update(); }} onBlur={() => this.load()} />
                <datalist id='ingot-er-files'>{suggestions.map(f => <option key={f} value={f} />)}</datalist>
                <button type='button' className='ingot-tw-icon-button' title={EFFECTIVE_TEXT.useActive} aria-label={EFFECTIVE_TEXT.useActive} onClick={() => this.showFile(this.activeFile())}>
                    <span className='codicon codicon-target' />
                </button>
            </form>
            {this.error && <div className='ingot-tw-empty ingot-er-error'>{this.error}</div>}
            {!this.result && !this.error && <div className='ingot-tw-empty'>{EFFECTIVE_TEXT.empty}</div>}
            {this.result && this.renderResult(this.result)}
        </div>;
    }

    protected renderResult(result: EffectiveRules): React.ReactNode {
        const byName = new Map(result.entries.map(e => [e.id, e]));
        return <>
            <ol className='ingot-er-layers' aria-label='Layers'>
                {result.layers.map(layer => <li key={layer.scope} className={`ingot-er-layer-chip ingot-er-${layer.kind}`}>{layer.label}</li>)}
            </ol>
            {!result.entries.length && <div className='ingot-tw-empty'>{EFFECTIVE_TEXT.noRules}</div>}
            {result.layers.map(layer => {
                const entries = result.entries.filter(e => e.layer === layer.scope);
                return entries.length ? <section key={layer.scope} className='ingot-er-layer' aria-label={layer.label}>
                    <div className='ingot-tw-section'>{layer.label}</div>
                    <ul className='ingot-tw-list'>{entries.map(e => this.renderEntry(e, byName))}</ul>
                </section> : undefined;
            })}
            {result.merged && <section className='ingot-er-merged'>
                <button type='button' className='ingot-tw-section ingot-er-merged-toggle' aria-expanded={this.showMerged} onClick={() => { this.showMerged = !this.showMerged; this.update(); }}>
                    <span className={`codicon codicon-chevron-${this.showMerged ? 'down' : 'right'}`} /> {EFFECTIVE_TEXT.merged}
                </button>
                {this.showMerged && <pre className='ingot-er-merged-text'>{result.merged}</pre>}
            </section>}
        </>;
    }

    protected renderEntry(entry: EffectiveEntry, byId: ReadonlyMap<string, EffectiveEntry>): React.ReactNode {
        const nameOf = (id: string) => byId.get(id)?.name ?? id;
        const live = entry.status === 'applied';
        return <li key={entry.id} className={`ingot-er-entry ingot-er-status-${entry.status}`}>
            <div className='ingot-tw-row' title={entry.reason}>
                <span className={`codicon codicon-${STATUS_ICONS[entry.status]}`} aria-hidden />
                <span className={`codicon codicon-${HIT_ICONS[entry.source]}`} aria-hidden />
                <button type='button' className={`ingot-tw-name ingot-tw-link${live ? '' : ' ingot-er-dim'}`} onClick={() => this.openRule(entry.path)}>{entry.name}</button>
                <span className={`ingot-er-status ingot-er-status-pill-${entry.status}`}>{STATUS_LABELS[entry.status]}</span>
                <span className='ingot-tw-detail'>{entry.reason}</span>
                <span className='ingot-rh-tokens'>~{formatTokens(entry.tokens)}</span>
            </div>
            {entry.overriddenBy && <div className='ingot-er-marker ingot-er-marker-down'><span className='codicon codicon-arrow-down' /> overridden by <code>{nameOf(entry.overriddenBy)}</code></div>}
            {entry.overrides.map(id => <div key={id} className='ingot-er-marker ingot-er-marker-up'><span className='codicon codicon-arrow-up' /> overrides <code>{nameOf(id)}</code></div>)}
            {entry.lineOverrides.map(o => <div key={`${o.line}:${o.by}`} className='ingot-er-line'>
                <s>{o.text}</s> <span className='ingot-er-arrow'>→</span> <span>{o.byText}</span> <code>{nameOf(o.by)}:{o.byLine + 1}</code>
            </div>)}
            {entry.conflicts.map(o => <div key={`c${o.line}:${o.by}`} className='ingot-er-line ingot-er-conflict'>
                <span className='codicon codicon-warning' /> {o.text} <span className='ingot-er-arrow'>vs</span> {o.byText} <code>{nameOf(o.by)}:{o.byLine + 1}</code>
            </div>)}
        </li>;
    }
}
