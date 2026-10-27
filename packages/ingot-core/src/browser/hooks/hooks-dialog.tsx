import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import type { Message } from '@theia/core/lib/browser/widgets';
import { hookCardInfo } from '../../common/git/hooks';
import { ToolCardView } from '../agents/tool-card';
import type { HooksRun } from './agent-hooks-service';

export type HooksChoice = 'fix' | 'bypass';

export interface HooksDialogProps {
    readonly run: HooksRun;
    readonly action: 'commit' | 'push';
    readonly openLink: (url: string) => void;
}

/** IDEA-178: a failing `.ingot/hooks.json` step blocks the commit / push; this shows why, with Fix with agent or Bypass. */
export class HooksDialog extends ReactDialog<HooksChoice | undefined> {

    protected choice: HooksChoice | undefined;
    protected expanded = new Set<number>();

    constructor(protected readonly hooksProps: HooksDialogProps) {
        super({ title: `${hooksProps.run.stage === 'pre-push' ? 'Push' : 'Commit'} blocked by .ingot hooks` });
        this.node.classList.add('ingot-hooks-dialog');
        this.node.id = 'ingot-hooks-dialog';
        hooksProps.run.results.forEach((r, i) => r.state === 'failed' && this.expanded.add(i));
        this.appendCloseButton('Cancel');
        const fix = this.createButton('Fix with agent');
        fix.id = 'ingot-hooks-fix';
        fix.classList.add('main');
        this.controlPanel.appendChild(fix);
        this.addAction(fix, () => this.pick('fix'), 'click');
        const bypass = this.createButton(`Bypass and ${hooksProps.action}`);
        bypass.id = 'ingot-hooks-bypass';
        bypass.classList.add('secondary');
        this.controlPanel.appendChild(bypass);
        this.addAction(bypass, () => this.pick('bypass'), 'click');
    }

    get value(): HooksChoice | undefined {
        return this.choice;
    }

    protected pick(choice: HooksChoice): void {
        this.choice = choice;
        this.accept();
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.update();
    }

    protected render(): React.ReactNode {
        const { run } = this.hooksProps;
        const failed = run.results.filter(r => r.state === 'failed');
        return <div className='ingot-hooks-body' id='ingot-hooks-body'>
            <p className='ingot-hooks-summary' id='ingot-hooks-summary'>
                {failed.length ? `${failed.map(r => `"${r.step.name}"`).join(', ')} failed. ` : ''}
                {run.errors.length ? `.ingot/hooks.json has problems: ${run.errors.join(' ')} ` : ''}
                Fix it with the agent, or bypass the hooks this once.
            </p>
            <div className='ingot-hooks-cards'>
                {run.results.map((r, i) => {
                    if (r.state === 'skipped') {
                        return <div key={i} className='ingot-hooks-step skipped' data-step={r.step.name}>
                            <span className='codicon codicon-circle-slash' aria-hidden='true' />
                            <span className='ingot-hooks-step-name'>{run.stage} · {r.step.name}</span>
                            <span className='ingot-hooks-step-note'>not run (an earlier step failed)</span>
                        </div>;
                    }
                    const { info, text } = hookCardInfo(r, run.stage);
                    return <div key={i} className={`ingot-hooks-step ${r.state}`} data-step={r.step.name}>
                        <ToolCardView info={info} text={text} expanded={this.expanded.has(i)} openLink={this.hooksProps.openLink}
                            onToggle={() => { if (!this.expanded.delete(i)) { this.expanded.add(i); } this.update(); }} />
                    </div>;
                })}
            </div>
        </div>;
    }
}
