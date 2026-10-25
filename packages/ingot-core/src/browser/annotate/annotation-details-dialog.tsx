import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import type { CommitInfo, LineHistoryEntry } from '../../common/git/annotate.utils';
import { relativeDate } from '../../common/git/git.utils';

export type AnnotationAction = { kind: 'log' | 'previous' | 'copy'; hash: string };

export interface AnnotationDetails {
    readonly title: string;
    readonly hash: string;
    readonly history: readonly LineHistoryEntry[];
    readonly load: (hash: string) => Promise<CommitInfo | undefined>;
}

/** Click on an annotation: the commit's details plus the line's history back to the commit that introduced it (IDEA-83). */
export class AnnotationDetailsDialog extends ReactDialog<AnnotationAction | undefined> {
    protected selected: string;
    protected info: CommitInfo | undefined;
    protected action: AnnotationAction | undefined;

    constructor(protected readonly details: AnnotationDetails) {
        super({ title: details.title });
        this.node.classList.add('ingot-annotation-dialog');
        this.selected = details.hash;
        this.appendCloseButton('Close');
        this.closeButton!.id = 'ingot-annotation-close';
        void this.showCommit(details.hash);
    }

    get value(): AnnotationAction | undefined {
        return this.action;
    }

    protected async showCommit(hash: string): Promise<void> {
        this.selected = hash;
        this.info = undefined;
        this.update();
        const info = await this.details.load(hash);
        if (this.selected === hash) {
            this.info = info;
            this.update();
        }
    }

    protected pick(kind: AnnotationAction['kind']): void {
        this.action = { kind, hash: this.info?.hash ?? this.selected };
        this.accept();
    }

    protected render(): React.ReactNode {
        const info = this.info;
        const history = this.details.history;
        return <div className='ingot-annotation-details'>
            <div className='ingot-annotation-commit' id='ingot-annotation-commit'>
                {info ? <>
                    <div className='ingot-annotation-meta'>
                        <span className='ingot-annotation-hash' title={info.hash}>{info.hash.slice(0, 8)}</span>
                        <span>{info.author}{info.email ? ` <${info.email}>` : ''}</span>
                        <span className='ingot-annotation-date' title={info.date}>{relativeDate(info.date)}</span>
                    </div>
                    <pre className='ingot-annotation-message'>{info.message}</pre>
                    <div className='ingot-annotation-actions'>
                        <button type='button' id='ingot-annotation-log' className='theia-button secondary' onClick={() => this.pick('log')}>Show in Git Log</button>
                        <button type='button' id='ingot-annotation-previous' className='theia-button secondary' onClick={() => this.pick('previous')}>Annotate Previous Revision</button>
                        <button type='button' id='ingot-annotation-copy' className='theia-button secondary' onClick={() => this.pick('copy')}>Copy Revision</button>
                    </div>
                </> : <div className='ingot-annotation-loading'>Loading…</div>}
            </div>
            <div className='ingot-annotation-history-title'>Line history ({history.length} {history.length === 1 ? 'commit' : 'commits'})</div>
            <ul className='ingot-annotation-history' id='ingot-annotation-history'>
                {history.map((h, i) => <li key={h.hash} data-hash={h.hash} className={`ingot-annotation-history-row${h.hash === this.selected ? ' selected' : ''}`}
                    onClick={() => void this.showCommit(h.hash)}>
                    <span className='ingot-annotation-hash'>{h.short}</span>
                    <span className='ingot-annotation-subject'>{h.subject}{i === history.length - 1 ? <em className='ingot-annotation-first'> · introduced</em> : undefined}</span>
                    <span className='ingot-annotation-author'>{h.author}</span>
                    <span className='ingot-annotation-date'>{relativeDate(h.date)}</span>
                </li>)}
            </ul>
        </div>;
    }
}
