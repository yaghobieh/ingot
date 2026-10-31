import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { open, OpenerService } from '@theia/core/lib/browser/opener-service';
import { EditorManager } from '@theia/editor/lib/browser';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { describePolicy, policyDirOf } from '../../common/ingot-kit';
import type { EffectivePolicy, PolicyLayer } from '../../common/ingot-kit';
import { AgentPolicyGate } from './agent-policy-gate';
import { IngotPolicyService } from './ingot-policy-service';
import { INGOT_POLICY_COMMANDS, POLICY_TEXT, POLICY_WIDGET_ID, POLICY_WIDGET_LABEL } from './ingot-policy.consts';
import type { PolicyScan } from './ingot-policy.types';

const LABEL_SEPARATOR = ': ';

/** IDEA-325 / IDEA-326: the Policy tool window: effective policy for the current file's folder, the policy files, and recent violations. */
@injectable()
export class IngotPolicyWidget extends ReactWidget {

    @inject(IngotPolicyService) protected readonly policies: IngotPolicyService;
    @inject(AgentPolicyGate) protected readonly gate: AgentPolicyGate;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(CommandService) protected readonly commands: CommandService;
    @inject(EditorManager) protected readonly editors: EditorManager;

    protected scan: PolicyScan = { layers: [], errors: [] };
    protected folder = '';
    protected effective?: EffectivePolicy;

    @postConstruct()
    protected init(): void {
        this.id = POLICY_WIDGET_ID;
        this.title.label = POLICY_WIDGET_LABEL;
        this.title.caption = POLICY_TEXT.caption;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-shield';
        this.addClass('ingot-policy');
        this.node.tabIndex = 0;
        this.toDispose.push(this.policies.onDidChange(() => this.refresh()));
        this.toDispose.push(this.gate.onDidViolate(() => this.update()));
        this.toDispose.push(this.editors.onCurrentEditorChanged(() => this.refresh()));
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        this.refresh();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    async refresh(): Promise<void> {
        const active = this.editors.currentEditor?.editor.uri;
        const path = active ? this.policies.relative(active) : undefined;
        this.folder = path ? path.split('/').slice(0, -1).join('/') : '';
        this.scan = await this.policies.scan();
        this.effective = await this.policies.effective(this.folder, true);
        this.update();
    }

    protected async openLayer(file: string): Promise<void> {
        const root = this.policies.root();
        if (root) {
            await open(this.opener, root.resolve(file));
        }
    }

    protected render(): React.ReactNode {
        const root = this.policies.root();
        const hasRoot = this.scan.layers.some(layer => !layer.dir);
        return <div className='ingot-policy-root'>
            <div className='ingot-dot-toolbar'>
                <span className='ingot-beta-pill'>{POLICY_TEXT.beta}</span>
                <span className='ingot-dot-spacer' />
                {!hasRoot && <button type='button' id='ingot-policy-create' className='ingot-dot-button primary' disabled={!root}
                    onClick={() => this.commands.executeCommand(INGOT_POLICY_COMMANDS.create.id)}>
                    <span className='codicon codicon-add' /> {POLICY_TEXT.create}
                </button>}
                <button type='button' id='ingot-policy-folder' className='ingot-dot-button' disabled={!root}
                    onClick={() => this.commands.executeCommand(INGOT_POLICY_COMMANDS.folder.id)}>
                    <span className='codicon codicon-folder' /> {POLICY_TEXT.folder}
                </button>
            </div>
            {!root && <div className='ingot-dot-empty'>{POLICY_TEXT.noProject}</div>}
            {root && !this.scan.layers.length && <div className='ingot-dot-empty' id='ingot-policy-empty'>{POLICY_TEXT.noPolicy}</div>}
            {root && this.effective && this.scan.layers.length > 0 && this.renderEffective(this.effective)}
            {this.scan.layers.length > 0 && this.renderFiles(this.scan.layers)}
            {root && this.renderViolations()}
        </div>;
    }

    protected renderEffective(policy: EffectivePolicy): React.ReactNode {
        return <section className='ingot-dot-card' id='ingot-policy-effective'>
            <div className='ingot-dot-card-title'>{POLICY_TEXT.effective} <code>{this.folder || POLICY_TEXT.root}</code></div>
            <dl className='ingot-policy-grid'>
                {describePolicy(policy).slice(1).map(line => {
                    const at = line.indexOf(LABEL_SEPARATOR);
                    const label = line.slice(0, at);
                    return <React.Fragment key={label}>
                        <dt>{label}</dt>
                        <dd data-policy-row={label}>{line.slice(at + LABEL_SEPARATOR.length)}</dd>
                    </React.Fragment>;
                })}
            </dl>
        </section>;
    }

    protected renderFiles(layers: readonly PolicyLayer[]): React.ReactNode {
        return <section className='ingot-dot-card'>
            <div className='ingot-dot-card-title'>{POLICY_TEXT.files}</div>
            <ul className='ingot-dot-list' id='ingot-policy-files'>
                {layers.map(layer => {
                    const errors = this.scan.errors.find(entry => entry.file === layer.file)?.errors ?? [];
                    const active = this.effective?.layers.includes(layer.file);
                    return <li key={layer.file} className={`ingot-policy-file ${active ? 'active' : ''}`} data-file={layer.file}>
                        <button type='button' className='ingot-dot-link' onClick={() => this.openLayer(layer.file)}>
                            <span className='codicon codicon-shield' /> {layer.file}
                        </button>
                        <span className='ingot-dot-muted'>{policyDirOf(layer.file) || POLICY_TEXT.root}</span>
                        {errors.map(error => <div key={error} className='ingot-dot-error'>{error}</div>)}
                    </li>;
                })}
            </ul>
        </section>;
    }

    protected renderViolations(): React.ReactNode {
        const items = this.gate.violations;
        return <section className='ingot-dot-card'>
            <div className='ingot-dot-card-title'>{POLICY_TEXT.violations}</div>
            {!items.length && <div className='ingot-dot-muted'>{POLICY_TEXT.noViolations}</div>}
            <ul className='ingot-dot-list' id='ingot-policy-violations'>
                {items.map(item => <li key={`${item.at}-${item.subject}`} className='ingot-policy-violation' data-rule={item.rule}>
                    <span className='ingot-policy-rule'>{item.rule}</span>
                    <span className='ingot-policy-message'>{item.message}</span>
                    <span className='ingot-dot-muted'>{new Date(item.at).toLocaleTimeString()} · {item.tool}</span>
                </li>)}
            </ul>
        </section>;
    }
}
