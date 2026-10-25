import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import type { DetectedExtension, ExtensionImportVia, ImportSource } from '../../common/import/editor-import.types';

export interface ImportChoice {
    readonly extensions: readonly DetectedExtension[];
    readonly settingsFiles: readonly string[];
    readonly keybindingFiles: readonly string[];
}

export type ImportRowState = { state: 'pending' } | { state: 'working' } | { state: 'done'; via: ExtensionImportVia } | { state: 'failed'; message: string };

const VIA_LABEL: Record<ExtensionImportVia, string> = { openvsx: 'Installed from Open VSX', local: 'Copied from the local folder' };

/**
 * IDEA-107 "Import from another editor": lists every extension found in the other editors' folders (by path only),
 * plus their settings and keybindings, then installs the picked ones (Open VSX first, the local copy otherwise).
 */
export class EditorImportDialog extends ReactDialog<ImportChoice | undefined> {
    protected readonly picked = new Set<string>();
    protected settings = new Set<string>();
    protected keybindings = new Set<string>();
    protected readonly rows = new Map<string, ImportRowState>();
    protected busy = false;
    protected done = false;
    protected summary = '';

    constructor(protected readonly sources: readonly ImportSource[], protected readonly run: (choice: ImportChoice, report: (id: string, state: ImportRowState) => void) => Promise<string>) {
        super({ title: 'Import from Another Editor' });
        this.node.classList.add('ingot-import-dialog');
        this.node.id = 'ingot-import-dialog';
        for (const source of sources) {
            source.extensions.forEach(e => this.picked.add(this.key(source, e)));
        }
        this.appendCloseButton('Cancel');
        this.appendAcceptButton('Import');
        this.closeButton!.id = 'ingot-import-cancel';
        this.acceptButton!.id = 'ingot-import-run';
    }

    get value(): ImportChoice | undefined {
        return this.choice();
    }

    protected key(source: ImportSource, extension: DetectedExtension): string {
        return `${source.path}\u0000${extension.id}`;
    }

    protected choice(): ImportChoice {
        const seen = new Set<string>();
        const extensions: DetectedExtension[] = [];
        for (const source of this.sources) {
            for (const extension of source.extensions) {
                if (this.picked.has(this.key(source, extension)) && !seen.has(extension.id)) {
                    seen.add(extension.id);
                    extensions.push(extension);
                }
            }
        }
        return { extensions, settingsFiles: [...this.settings], keybindingFiles: [...this.keybindings] };
    }

    /** Import runs inside the dialog so progress shows per extension; Import becomes Close when it finishes. */
    protected override async accept(): Promise<void> {
        if (this.done) {
            return super.accept();
        }
        if (this.busy) {
            return;
        }
        this.busy = true;
        this.acceptButton!.disabled = true;
        const choice = this.choice();
        choice.extensions.forEach(e => this.rows.set(e.id, { state: 'pending' }));
        this.update();
        this.summary = await this.run(choice, (id, state) => {
            this.rows.set(id, state);
            this.update();
        }).catch(error => `Import failed: ${error instanceof Error ? error.message : String(error)}`);
        this.busy = false;
        this.done = true;
        this.acceptButton!.disabled = false;
        this.acceptButton!.textContent = 'Close';
        this.closeButton!.style.display = 'none';
        this.update();
    }

    protected toggle(set: Set<string>, key: string): void {
        if (set.has(key)) {
            set.delete(key);
        } else {
            set.add(key);
        }
        this.update();
    }

    protected renderRow(source: ImportSource, extension: DetectedExtension): React.ReactNode {
        const key = this.key(source, extension);
        const row = this.rows.get(extension.id);
        const status = !row ? '' : row.state === 'pending' ? 'Waiting' : row.state === 'working' ? 'Installing…' : row.state === 'done' ? VIA_LABEL[row.via] : `Failed: ${row.message}`;
        return <li key={key} className={`ingot-import-ext${row ? ` ${row.state}` : ''}`} data-id={extension.id}>
            <label>
                <input type='checkbox' checked={this.picked.has(key)} disabled={this.busy || this.done} onChange={() => this.toggle(this.picked, key)} />
                <span className='ingot-import-ext-name'>{extension.displayName ?? extension.id}</span>
                <span className='ingot-import-ext-id'>{extension.id} {extension.version}</span>
            </label>
            {status && <span className='ingot-import-ext-status'>{status}</span>}
        </li>;
    }

    protected render(): React.ReactNode {
        if (!this.sources.length) {
            return <div className='ingot-import-empty' id='ingot-import-empty'>No other editor folders with extensions or settings were found in your home folder.</div>;
        }
        return <div className='ingot-import'>
            <p className='ingot-import-lead'>Ingot found these folders. Extensions are installed from Open VSX; one that is not there is copied from its folder.</p>
            {this.sources.map(source => <section key={source.path} className='ingot-import-source'>
                <div className='ingot-import-path' title={source.path}><span className='codicon codicon-folder' />{source.path}</div>
                {source.extensions.length > 0 && <ul className='ingot-import-list'>{source.extensions.map(e => this.renderRow(source, e))}</ul>}
                {source.settingsFile && <label className='ingot-import-extra'>
                    <input type='checkbox' id={`ingot-import-settings-${this.sources.indexOf(source)}`} checked={this.settings.has(source.settingsFile)} disabled={this.busy || this.done}
                        onChange={() => this.toggle(this.settings, source.settingsFile!)} />
                    Settings <span className='ingot-import-path-small' title={source.settingsFile}>{source.settingsFile}</span>
                </label>}
                {source.keybindingsFile && <label className='ingot-import-extra'>
                    <input type='checkbox' id={`ingot-import-keybindings-${this.sources.indexOf(source)}`} checked={this.keybindings.has(source.keybindingsFile)} disabled={this.busy || this.done}
                        onChange={() => this.toggle(this.keybindings, source.keybindingsFile!)} />
                    Keybindings <span className='ingot-import-path-small' title={source.keybindingsFile}>{source.keybindingsFile}</span>
                </label>}
            </section>)}
            {this.summary && <div className='ingot-import-summary' id='ingot-import-summary'>{this.summary}</div>}
        </div>;
    }
}
