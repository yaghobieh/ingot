import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { open, OpenerService } from '@theia/core/lib/browser/opener-service';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import type { LockedPack } from '../../common/ingot-kit';
import { RulePacksModel } from './rule-packs-model';
import { RulePackRemover } from './rule-packs.types';
import { RULE_PACKS_COMMANDS, RULE_PACKS_TEXT, RULE_PACKS_WIDGET_ID, RULE_PACKS_WIDGET_LABEL } from './rule-packs.consts';

/** IDEA-322: Rule Packs tool window: the packs in .ingot/ingot-lock.json, org and enforced badges, and their files. */
@injectable()
export class IngotRulePacksWidget extends ReactWidget {

    @inject(RulePacksModel) protected readonly model: RulePacksModel;
    @inject(CommandService) protected readonly commands: CommandService;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(RulePackRemover) protected readonly remover: RulePackRemover;

    protected expanded = new Set<string>();

    @postConstruct()
    protected init(): void {
        this.id = RULE_PACKS_WIDGET_ID;
        this.title.label = RULE_PACKS_WIDGET_LABEL;
        this.title.caption = RULE_PACKS_TEXT.caption;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-package';
        this.addClass('ingot-rule-packs');
        this.node.tabIndex = 0;
        this.toDispose.push(this.model.onDidChange(() => this.update()));
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        this.model.reload();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected toggle(key: string): void {
        if (this.expanded.has(key)) {
            this.expanded.delete(key);
        } else {
            this.expanded.add(key);
        }
        this.update();
    }

    protected async openFile(file: string): Promise<void> {
        const root = this.model.rootUri();
        if (root) {
            await open(this.opener, root.resolve(file));
        }
    }

    protected render(): React.ReactNode {
        const root = this.model.root();
        const packs = Object.entries(this.model.lock.packs);
        const busy = this.model.busy;
        return <div className='ingot-rule-packs-root'>
            <div className='ingot-dot-toolbar'>
                <span className='ingot-dot-title'>{RULE_PACKS_WIDGET_LABEL}</span>
                <span className='ingot-beta-pill'>{RULE_PACKS_TEXT.beta}</span>
                <span className='ingot-dot-spacer' />
                <button type='button' id='ingot-packs-add' className='ingot-dot-button primary' disabled={!root || busy}
                    onClick={() => this.commands.executeCommand(RULE_PACKS_COMMANDS.add.id)}>
                    <span className='codicon codicon-add' /> {RULE_PACKS_TEXT.add}
                </button>
                <button type='button' id='ingot-packs-sync' className='ingot-dot-button' disabled={!root || busy}
                    onClick={() => this.commands.executeCommand(RULE_PACKS_COMMANDS.syncOrg.id)}>
                    <span className='codicon codicon-organization' /> {RULE_PACKS_TEXT.sync}
                </button>
                <button type='button' id='ingot-packs-verify' className='ingot-dot-iconbtn' title={RULE_PACKS_TEXT.verify} aria-label={RULE_PACKS_TEXT.verify} disabled={!root || busy}
                    onClick={() => this.commands.executeCommand(RULE_PACKS_COMMANDS.verify.id)}>
                    <span className='codicon codicon-verified' />
                </button>
            </div>
            {busy && <div className='ingot-dot-muted' id='ingot-packs-busy'><span className='codicon codicon-loading codicon-modifier-spin' /> {RULE_PACKS_TEXT.working}</div>}
            {!root && <div className='ingot-dot-empty'>{RULE_PACKS_TEXT.noProject}</div>}
            {root && !packs.length && <div className='ingot-dot-empty' id='ingot-packs-empty'>{RULE_PACKS_TEXT.empty}</div>}
            {this.model.issues.length > 0 && <ul className='ingot-dot-list' id='ingot-packs-issues'>
                {this.model.issues.map(issue => <li key={`${issue.kind}-${issue.pack}-${issue.path ?? ''}`} className='ingot-dot-error'>{issue.message}</li>)}
            </ul>}
            <ul className='ingot-dot-list' id='ingot-packs-list'>
                {packs.map(([key, pack]) => this.renderPack(key, pack))}
            </ul>
            {this.model.lock.org && <div className='ingot-dot-muted' id='ingot-packs-org'>
                {RULE_PACKS_TEXT.synced} “{this.model.lock.org.team}” · {new Date(this.model.lock.org.syncedAt).toLocaleString()}
            </div>}
        </div>;
    }

    protected renderPack(key: string, pack: LockedPack): React.ReactNode {
        const open = this.expanded.has(key);
        return <li key={key} className={`ingot-pack ${pack.enforced ? 'enforced' : ''}`} data-pack={key}>
            <div className='ingot-pack-row'>
                <button type='button' className='ingot-dot-iconbtn' aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} files of ${key}`} onClick={() => this.toggle(key)}>
                    <span className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} />
                </button>
                <span className='ingot-pack-name'>{key}</span>
                <span className='ingot-pack-version'>{pack.version}</span>
                <span className='ingot-dot-muted'>{pack.range}</span>
                {pack.source === 'org' && <span className='ingot-dot-badge'>{RULE_PACKS_TEXT.org}</span>}
                {pack.enforced && <span className='ingot-dot-badge enforced' title={RULE_PACKS_TEXT.enforcedTooltip}><span className='codicon codicon-lock' /> {RULE_PACKS_TEXT.enforced}</span>}
                <span className='ingot-dot-spacer' />
                <span className='ingot-dot-muted'>{pack.files.length} {RULE_PACKS_TEXT.files}</span>
                <button type='button' className='ingot-dot-iconbtn danger ingot-pack-remove' disabled={pack.enforced || this.model.busy}
                    title={pack.enforced ? RULE_PACKS_TEXT.enforcedTooltip : RULE_PACKS_TEXT.remove} aria-label={`${RULE_PACKS_TEXT.remove} ${key}`}
                    onClick={() => this.remover.removePack(key)}>
                    <span className='codicon codicon-trash' />
                </button>
            </div>
            {open && <ul className='ingot-pack-files'>
                {pack.files.map(file => <li key={file}>
                    <button type='button' className='ingot-dot-link' onClick={() => this.openFile(file)}>
                        {pack.enforced && <span className='codicon codicon-lock' />} {file}
                    </button>
                </li>)}
            </ul>}
        </li>;
    }
}
