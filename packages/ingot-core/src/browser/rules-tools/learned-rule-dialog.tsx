import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import type { Message } from '@theia/core/lib/browser/widgets';
import { LEARNED_SOURCE_LABELS, renderLearnedRule } from '../../common/learned-rules';
import type { LearnedRuleProposal } from '../../common/learned-rules';

export interface LearnedRuleDialogProps {
    readonly list: () => Promise<LearnedRuleProposal[]>;
    readonly accept: (id: string, body: string) => Promise<string>;
    readonly dismiss: (id: string) => Promise<void>;
    /** Show this proposal first. */
    readonly focusId?: string;
}

/** IDEA-328: review a rule Ingot drafted from a rejected change or a repeated correction, as a diff of the new rule file. */
export class LearnedRuleDialog extends ReactDialog<number> {

    protected proposals: LearnedRuleProposal[] = [];
    protected index = 0;
    protected drafts = new Map<string, string>();
    protected loaded = false;
    protected busy = false;
    protected error?: string;
    protected notice?: string;
    protected added = 0;
    protected readonly addButton: HTMLButtonElement;
    protected readonly dismissButton: HTMLButtonElement;

    constructor(protected readonly learnedProps: LearnedRuleDialogProps) {
        super({ title: 'Learned Rule' });
        this.node.id = 'ingot-learned-dialog';
        this.node.classList.add('ingot-rules-dialog');
        this.appendCloseButton('Close');
        this.dismissButton = this.createButton('Dismiss');
        this.dismissButton.id = 'ingot-learned-dismiss';
        this.dismissButton.classList.add('secondary');
        this.controlPanel.appendChild(this.dismissButton);
        this.addAction(this.dismissButton, () => this.decide(false), 'click');
        this.addButton = this.createButton('Add Rule');
        this.addButton.id = 'ingot-learned-accept';
        this.addButton.classList.add('main');
        this.controlPanel.appendChild(this.addButton);
        this.addAction(this.addButton, () => this.decide(true), 'click');
    }

    /** How many rules were added. */
    get value(): number {
        return this.added;
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        void this.load();
    }

    protected async load(): Promise<void> {
        try {
            this.proposals = await this.learnedProps.list();
            const focus = this.proposals.findIndex(proposal => proposal.id === this.learnedProps.focusId);
            this.index = Math.max(focus, 0);
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        }
        this.loaded = true;
        this.update();
    }

    protected get current(): LearnedRuleProposal | undefined {
        return this.proposals[this.index];
    }

    protected body(proposal: LearnedRuleProposal): string {
        return this.drafts.get(proposal.id) ?? proposal.body;
    }

    protected async decide(accept: boolean): Promise<void> {
        const proposal = this.current;
        if (!proposal || this.busy) {
            return;
        }
        this.busy = true;
        this.update();
        try {
            if (accept) {
                const written = await this.learnedProps.accept(proposal.id, this.body(proposal));
                this.added++;
                this.notice = `Added ${written}. Agents follow it from the next message.`;
            } else {
                await this.learnedProps.dismiss(proposal.id);
                this.notice = `Dismissed. Ingot won't suggest "${proposal.title}" again.`;
            }
            this.proposals = this.proposals.filter(item => item.id !== proposal.id);
            this.index = Math.min(this.index, Math.max(this.proposals.length - 1, 0));
            this.error = undefined;
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        }
        this.busy = false;
        this.update();
    }

    protected override onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg);
        const proposal = this.current;
        this.addButton.disabled = this.busy || !proposal || !this.body(proposal).trim();
        this.dismissButton.disabled = this.busy || !proposal;
    }

    protected render(): React.ReactNode {
        const proposal = this.current;
        return <div className='ingot-rules-body'>
            {this.notice && <div className='ingot-rules-status ok' id='ingot-learned-notice'>{this.notice}</div>}
            {this.error && <div className='ingot-rules-status error'>{this.error}</div>}
            {this.loaded && !proposal && <p className='ingot-rules-lead' id='ingot-learned-empty'>
                No rules to review. When Learn Rules from Reviews is on, Ingot drafts one after you reject a change it recognises or repeat a correction.
            </p>}
            {proposal && this.renderProposal(proposal)}
        </div>;
    }

    protected renderProposal(proposal: LearnedRuleProposal): React.ReactNode {
        const body = this.body(proposal);
        const lines = renderLearnedRule(proposal, body || proposal.body).trimEnd().split('\n');
        return <>
            <p className='ingot-rules-lead'>Ingot drafted a rule from your reviews. Edit it, then add it to <code>.ingot/rules</code>, or dismiss it.</p>
            <div className='ingot-rules-item-head' id='ingot-learned-head' data-source={proposal.source}>
                <span className='ingot-rules-item-name' id='ingot-learned-title'>{proposal.title}</span>
                <span className={`ingot-rules-pill ${proposal.source === 'rejection' ? 'warn' : 'ok'}`}>{LEARNED_SOURCE_LABELS[proposal.source]}</span>
                {this.proposals.length > 1 && <span className='ingot-rules-row'>
                    <button type='button' className='theia-button secondary' id='ingot-learned-prev' disabled={this.index === 0} onClick={() => { this.index--; this.update(); }}>‹</button>
                    <span className='ingot-rules-item-meta' id='ingot-learned-position'>{this.index + 1} of {this.proposals.length}</span>
                    <button type='button' className='theia-button secondary' id='ingot-learned-next' disabled={this.index === this.proposals.length - 1} onClick={() => { this.index++; this.update(); }}>›</button>
                </span>}
            </div>
            <ul className='ingot-rules-findings' id='ingot-learned-evidence'>
                {proposal.evidence.map(item => <li key={item}><code>{item}</code></li>)}
            </ul>
            <label className='ingot-rules-row' htmlFor='ingot-learned-body'>Rule</label>
            <textarea id='ingot-learned-body' value={body} disabled={this.busy} spellCheck
                onChange={e => { this.drafts.set(proposal.id, e.currentTarget.value); this.update(); }} />
            <div className='ingot-rules-item-meta'>New file <code id='ingot-learned-path'>{proposal.path}</code></div>
            <pre className='ingot-rules-diff' id='ingot-learned-diff'>
                {lines.map((line, i) => <div key={i} className='add'>+ {line}</div>)}
            </pre>
        </>;
    }
}
