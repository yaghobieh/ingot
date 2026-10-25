import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ContextMenuRenderer } from '@theia/core/lib/browser/context-menu-renderer';
import { ContextKeyService, type ContextKey } from '@theia/core/lib/browser/context-key-service';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { splitPath, STATUS_LABEL, type ChangeEntry } from '../../common/git/changes';
import { badgeClasses } from '../../common/icons/file-icons.utils';
import { LocalChangesModel } from './local-changes-model';
import { COMMIT_COMMANDS, DEFAULT_CHANGELIST, LOCAL_CHANGES_CONTEXT_MENU, LOCAL_CHANGES_FOCUS, LOCAL_CHANGES_LABEL, LOCAL_CHANGES_WIDGET_ID, UNVERSIONED_GROUP } from './commit.consts';

interface Group {
    readonly name: string;
    readonly entries: ChangeEntry[];
}

/**
 * Local Changes tool window (IDEA-74, design reference docs/design/commit-reference.png): changelists with
 * checkboxes, status-colored names, commit message with history, Amend, and Commit / Commit and Push….
 */
@injectable()
export class LocalChangesWidget extends ReactWidget {

    @inject(LocalChangesModel) readonly model: LocalChangesModel;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(ContextMenuRenderer) protected readonly contextMenu: ContextMenuRenderer;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;

    message = '';
    amend = false;
    signoff = false;
    runHooks = true;
    groupByDirectory = false;
    collapsed = new Set<string>();
    /** Rows selected for the context menu / ⌘D / F4. */
    selection: string[] = [];
    protected busy = false;
    protected showOptions = false;
    protected showCommitMenu = false;
    protected history: string[] | undefined;
    protected historyIndex = -1;
    protected messageInput: HTMLTextAreaElement | null = null;
    protected focusKey: ContextKey<boolean>;

    @postConstruct()
    protected init(): void {
        this.id = LOCAL_CHANGES_WIDGET_ID;
        this.title.label = LOCAL_CHANGES_LABEL;
        this.title.caption = 'Commit (⌘K)';
        this.title.iconClass = 'codicon codicon-git-commit';
        this.title.closable = true;
        this.addClass('ingot-local-changes');
        this.node.tabIndex = 0;
        this.focusKey = this.contextKeys.createKey<boolean>(LOCAL_CHANGES_FOCUS, false);
        this.node.addEventListener('focusin', () => this.focusKey.set(true));
        this.node.addEventListener('focusout', () => this.focusKey.set(false));
        this.toDispose.push(this.model.onDidChange(() => this.update()));
        this.update();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.model.refresh();
        (this.messageInput ?? this.node).focus();
    }

    focusMessage(): void {
        this.messageInput?.focus();
    }

    protected get groups(): Group[] {
        const tracked = this.model.entries.filter(e => e.status !== 'untracked');
        const names = this.model.changelistNames;
        const groups: Group[] = names.map(name => ({ name, entries: tracked.filter(e => this.model.changelistOf(e.path) === name) }))
            .filter(g => g.name === DEFAULT_CHANGELIST || g.entries.length);
        const unversioned = this.model.entries.filter(e => e.status === 'untracked');
        if (unversioned.length) {
            groups.push({ name: UNVERSIONED_GROUP, entries: unversioned });
        }
        return groups;
    }

    protected toggleCollapsed(key: string): void {
        if (this.collapsed.has(key)) { this.collapsed.delete(key); } else { this.collapsed.add(key); }
        this.update();
    }

    expandAll(expand: boolean): void {
        this.collapsed = expand ? new Set() : new Set(this.groups.flatMap(g => [g.name, ...this.dirsOf(g).map(d => `${g.name}/${d}`)]));
        this.update();
    }

    protected dirsOf(group: Group): string[] {
        return [...new Set(group.entries.map(e => splitPath(e.path).dir))].sort();
    }

    protected select(path: string, e: React.MouseEvent): void {
        if (e.metaKey || e.ctrlKey) {
            this.selection = this.selection.includes(path) ? this.selection.filter(p => p !== path) : [...this.selection, path];
        } else if (!(e.button === 2 && this.selection.includes(path))) {
            this.selection = [path];
        }
        this.update();
    }

    protected async run(action: () => Promise<void>): Promise<void> {
        this.busy = true;
        this.update();
        try {
            await action();
        } catch (error) {
            this.messages.error(`Commit failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.busy = false;
            this.update();
        }
    }

    async commit(andPush: boolean): Promise<boolean> {
        let ok = false;
        await this.run(async () => {
            const count = this.model.included.length;
            await this.model.commit({ message: this.message, amend: this.amend, signoff: this.signoff, runHooks: this.runHooks });
            this.messages.info(this.amend ? 'Amended the last commit.' : `Committed ${count} file${count === 1 ? '' : 's'}.`);
            this.message = '';
            this.amend = false;
            this.history = undefined;
            ok = true;
        });
        if (ok && andPush) {
            await this.commands.executeCommand(COMMIT_COMMANDS.push.id);
        }
        return ok;
    }

    protected async toggleAmend(): Promise<void> {
        this.amend = !this.amend;
        if (this.amend && !this.message.trim()) {
            this.message = await this.model.headMessage();
        }
        this.update();
    }

    /** ⌥↑ / ⌥↓ (Ctrl+Alt on other platforms via the keymap) walk the message history. */
    async cycleHistory(step: number): Promise<void> {
        this.history ??= await this.model.recentMessages();
        if (!this.history.length) {
            return;
        }
        this.historyIndex = Math.max(-1, Math.min(this.history.length - 1, this.historyIndex + step));
        this.message = this.historyIndex < 0 ? '' : this.history[this.historyIndex];
        this.update();
    }

    protected async pickHistory(): Promise<void> {
        await this.commands.executeCommand('ingot.commit.messageHistory');
    }

    protected renderEntry(entry: ChangeEntry, indent: number): React.ReactNode {
        const { dir, name } = splitPath(entry.path);
        const checked = this.model.isChecked(entry);
        const partial = !!this.model.excludedHunks.get(entry.path)?.size;
        const selected = this.selection.includes(entry.path);
        return <div key={entry.path} className={`ingot-lc-row ingot-lc-file ${selected ? 'selected' : ''}`} style={{ paddingLeft: 8 + indent * 14 }}
            data-path={entry.path} role='treeitem' aria-selected={selected} title={`${entry.path} — ${STATUS_LABEL[entry.status]}${entry.oldPath ? ` (from ${entry.oldPath})` : ''}`}
            onMouseDown={e => this.select(entry.path, e)}
            onDoubleClick={() => this.commands.executeCommand(COMMIT_COMMANDS.showDiff.id, entry.path)}
            onContextMenu={e => { e.preventDefault(); this.contextMenu.render({ menuPath: LOCAL_CHANGES_CONTEXT_MENU, anchor: e.nativeEvent, args: [this.selection], context: this.node }); }}>
            <input type='checkbox' className={`ingot-lc-check ${partial ? 'partial' : ''}`} checked={checked} aria-label={`Include ${entry.path}`}
                ref={el => { if (el) { el.indeterminate = checked && partial; } }}
                onMouseDown={e => e.stopPropagation()} onChange={e => this.model.setChecked([entry.path], e.currentTarget.checked)} />
            <span className={`ingot-lc-badge ${badgeClasses(name, false)}`} />
            <span className={`ingot-lc-name ingot-lc-${entry.status}`}>{name}</span>
            {!this.groupByDirectory && dir && <span className='ingot-lc-dir'>{dir}</span>}
        </div>;
    }

    protected renderGroup(group: Group): React.ReactNode {
        const open = !this.collapsed.has(group.name);
        const checkedCount = group.entries.filter(e => this.model.isChecked(e)).length;
        const all = group.entries.length > 0 && checkedCount === group.entries.length;
        const paths = group.entries.map(e => e.path);
        return <div key={group.name} className='ingot-lc-group' role='group' aria-label={group.name}>
            <div className='ingot-lc-row ingot-lc-group-row' onClick={() => this.toggleCollapsed(group.name)}>
                <span className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} />
                <input type='checkbox' className='ingot-lc-check' checked={all} aria-label={`Include ${group.name}`}
                    ref={el => { if (el) { el.indeterminate = checkedCount > 0 && !all; } }}
                    onClick={e => e.stopPropagation()} onChange={e => this.model.setChecked(paths, e.currentTarget.checked)} />
                <span className='ingot-lc-group-name'>{group.name}</span>
                <span className='ingot-lc-count'>{group.entries.length} file{group.entries.length === 1 ? '' : 's'}</span>
            </div>
            {open && (this.groupByDirectory
                ? this.dirsOf(group).map(dir => {
                    const key = `${group.name}/${dir}`;
                    const dirOpen = !this.collapsed.has(key);
                    const entries = group.entries.filter(e => splitPath(e.path).dir === dir);
                    return <React.Fragment key={key}>
                        <div className='ingot-lc-row ingot-lc-dir-row' style={{ paddingLeft: 22 }} onClick={() => this.toggleCollapsed(key)}>
                            <span className={`codicon codicon-chevron-${dirOpen ? 'down' : 'right'}`} />
                            <input type='checkbox' className='ingot-lc-check' checked={entries.every(e => this.model.isChecked(e))} aria-label={`Include ${dir || 'root'}`}
                                onClick={e => e.stopPropagation()} onChange={e => this.model.setChecked(entries.map(x => x.path), e.currentTarget.checked)} />
                            <span className='ingot-lc-dirname'>{dir || '.'}</span>
                            <span className='ingot-lc-count'>{entries.length}</span>
                        </div>
                        {dirOpen && entries.map(e => this.renderEntry(e, 3))}
                    </React.Fragment>;
                })
                : group.entries.map(e => this.renderEntry(e, 1)))}
        </div>;
    }

    protected toolbarButton(id: string, icon: string, title: string, onClick: () => void, active = false): React.ReactNode {
        return <button type='button' id={`ingot-lc-${id}`} className={`ingot-lc-tool ${active ? 'active' : ''}`} title={title} aria-label={title} onClick={onClick}>
            <span className={`codicon codicon-${icon}`} />
        </button>;
    }

    protected render(): React.ReactNode {
        const included = this.model.included.length;
        const modified = this.model.entries.filter(e => e.status !== 'untracked').length;
        const canCommit = !this.busy && (included > 0 || this.amend) && !!this.message.trim();
        return <div className='ingot-lc-root'>
            <div className='ingot-lc-toolbar' role='toolbar'>
                {this.toolbarButton('refresh', 'refresh', 'Refresh', () => this.model.refresh())}
                {this.toolbarButton('rollback', 'discard', 'Rollback…', () => this.commands.executeCommand(COMMIT_COMMANDS.rollback.id, this.selection))}
                {this.toolbarButton('move', 'arrow-swap', 'Move to Another Changelist…', () => this.commands.executeCommand(COMMIT_COMMANDS.moveToChangelist.id, this.selection))}
                {this.toolbarButton('diff', 'diff', 'Show Diff (⌘D)', () => this.commands.executeCommand(COMMIT_COMMANDS.showDiff.id, this.selection[0]))}
                <span className='ingot-lc-sep' />
                {this.toolbarButton('group', 'list-tree', 'Group by Directory', () => { this.groupByDirectory = !this.groupByDirectory; this.update(); }, this.groupByDirectory)}
                {this.toolbarButton('expand', 'expand-all', 'Expand All', () => this.expandAll(true))}
                {this.toolbarButton('collapse', 'collapse-all', 'Collapse All', () => this.expandAll(false))}
                <span className='ingot-flex' />
                {this.toolbarButton('hide', 'close', 'Hide', () => this.close())}
            </div>
            <div className='ingot-lc-tree' role='tree' aria-label='Local changes'>
                {this.model.error && <div className='ingot-lc-empty'>{this.model.error}</div>}
                {!this.model.error && this.model.entries.length === 0 && <div className='ingot-lc-empty'>{this.model.loading ? 'Loading…' : 'No local changes.'}</div>}
                {this.model.entries.length > 0 && this.groups.map(g => this.renderGroup(g))}
            </div>
            <div className='ingot-lc-message'>
                <textarea id='ingot-commit-message' ref={el => { this.messageInput = el; }} placeholder={this.amend ? 'Amend commit message' : 'Commit message'}
                    value={this.message} spellCheck
                    onChange={e => { this.message = e.currentTarget.value; this.historyIndex = -1; this.update(); }}
                    onKeyDown={e => {
                        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            this.cycleHistory(e.key === 'ArrowUp' ? 1 : -1);
                        }
                    }} />
                <button type='button' id='ingot-commit-history' className='ingot-lc-tool ingot-lc-history' title='Recent messages (⌘⌥↑ / ⌘⌥↓)' aria-label='Recent messages'
                    onClick={() => this.pickHistory()}><span className='codicon codicon-history' /></button>
            </div>
            {this.showOptions && <div className='ingot-lc-options' id='ingot-commit-options'>
                <label><input type='checkbox' id='ingot-commit-signoff' checked={this.signoff} onChange={e => { this.signoff = e.currentTarget.checked; this.update(); }} /> Sign-off commit</label>
                <label><input type='checkbox' id='ingot-commit-hooks' checked={this.runHooks} onChange={e => { this.runHooks = e.currentTarget.checked; this.update(); }} /> Run Git hooks (gate)</label>
            </div>}
            <div className='ingot-lc-bottom'>
                <button type='button' id='ingot-commit-amend' className={`ingot-lc-tool ingot-lc-amend ${this.amend ? 'active' : ''}`} aria-pressed={this.amend} title='Amend last commit' aria-label='Amend' onClick={() => this.toggleAmend()}>
                    <span className='codicon codicon-edit' />
                </button>
                <div className='ingot-lc-split'>
                    <button type='button' id='ingot-commit-button' className='ingot-btn-primary ingot-lc-commit' disabled={!canCommit} onClick={() => this.commit(false)}>{this.amend ? 'Amend Commit' : 'Commit'}</button>
                    <button type='button' id='ingot-commit-menu' className='ingot-btn-primary ingot-lc-commit-arrow' aria-label='More commit actions' disabled={!canCommit}
                        onClick={() => { this.showCommitMenu = !this.showCommitMenu; this.update(); }}><span className='codicon codicon-chevron-down' /></button>
                    {this.showCommitMenu && <div className='ingot-lc-popup' role='menu'>
                        <button type='button' role='menuitem' id='ingot-commit-and-push' onClick={() => { this.showCommitMenu = false; this.commit(true); }}>
                            Commit and Push… <span className='ingot-lc-key'>⇧⌘K</span>
                        </button>
                    </div>}
                </div>
                <span className='ingot-lc-branch' title='Current branch'><span className='codicon codicon-git-branch' /> {this.model.branch || '—'}</span>
                <span className='ingot-lc-modified' id='ingot-commit-count'>{modified} modified</span>
                <span className='ingot-flex' />
                <button type='button' id='ingot-commit-settings' className={`ingot-lc-tool ${this.showOptions ? 'active' : ''}`} title='Commit options' aria-label='Commit options'
                    onClick={() => { this.showOptions = !this.showOptions; this.update(); }}><span className='codicon codicon-settings-gear' /></button>
            </div>
        </div>;
    }
}
