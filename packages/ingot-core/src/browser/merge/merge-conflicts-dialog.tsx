import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';

export type ConflictAction = { kind: 'merge' | 'ours' | 'theirs'; paths: string[] };

/** Lists conflicted files: Accept Yours / Accept Theirs / Merge… (IDEA-33). */
export class MergeConflictsDialog extends ReactDialog<ConflictAction | undefined> {
    protected selected = new Set<string>();
    protected action: ConflictAction | undefined;

    constructor(protected readonly files: readonly string[], protected readonly yours: string, protected readonly theirs: string) {
        super({ title: 'Conflicts' });
        this.node.classList.add('ingot-merge-conflicts-dialog');
        this.selected = new Set(files.slice(0, 1));
        this.appendCloseButton('Close');
        this.closeButton!.id = 'ingot-conflicts-close';
    }

    get value(): ConflictAction | undefined {
        return this.action;
    }

    protected pick(kind: ConflictAction['kind']): void {
        const paths = [...this.selected];
        if (paths.length) {
            this.action = { kind, paths };
            this.accept();
        }
    }

    protected render(): React.ReactNode {
        return <div className='ingot-conflicts'>
            <div className='ingot-conflicts-body'>
                <table className='ingot-conflicts-table'>
                    <thead><tr><th>Name</th><th>Yours ({this.yours})</th><th>Theirs ({this.theirs})</th></tr></thead>
                    <tbody>
                        {this.files.map(f => <tr key={f} data-path={f} className={this.selected.has(f) ? 'selected' : ''}
                            onClick={e => {
                                if (e.metaKey || e.ctrlKey) {
                                    if (this.selected.has(f)) { this.selected.delete(f); } else { this.selected.add(f); }
                                } else {
                                    this.selected = new Set([f]);
                                }
                                this.update();
                            }}
                            onDoubleClick={() => { this.selected = new Set([f]); this.pick('merge'); }}>
                            <td className='ingot-conflicts-name'><span className='codicon codicon-warning' /> {f}</td><td>Modified</td><td>Modified</td>
                        </tr>)}
                    </tbody>
                </table>
                <div className='ingot-conflicts-actions'>
                    <button type='button' id='ingot-conflicts-ours' className='theia-button secondary' disabled={!this.selected.size} onClick={() => this.pick('ours')}>Accept Yours</button>
                    <button type='button' id='ingot-conflicts-theirs' className='theia-button secondary' disabled={!this.selected.size} onClick={() => this.pick('theirs')}>Accept Theirs</button>
                    <button type='button' id='ingot-conflicts-merge' className='theia-button' disabled={this.selected.size !== 1} onClick={() => this.pick('merge')}>Merge…</button>
                </div>
            </div>
        </div>;
    }
}
