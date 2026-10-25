import * as React from '@theia/core/shared/react';
import type { AgentMode, AgentSession } from '../../common/agents/agents.types';
import { AGENT_MODE_INFO } from '../../common/agents/agent-modes';
import { chatTime, filterChats } from '../../common/agents/chat-history';
import { AUTO_MODEL_ID, AUTO_MODEL_LABEL } from '../../common/models/models.consts';
import type { CatalogModel, ModelFamilyGroup } from '../../common/models/models.types';
import { groupModelsByFamily } from '../../common/models/models.utils';
import { MODEL_PICKER_TEXT } from './agents.consts';
import type { Memory, MemoryScope } from '../../common/memories/memories';
import type { MemoryStore } from './memory-store';

/** Transparent layer that closes a popover on an outside click or Escape (wherever focus is). */
export const Backdrop = ({ onClose }: { onClose: () => void }): React.ReactElement => {
    const close = React.useRef(onClose);
    close.current = onClose;
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                close.current();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, []);
    return <div className='ingot-popover-backdrop' onMouseDown={e => { e.preventDefault(); onClose(); }} />;
};

const onEscape = (onClose: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
    }
};

export interface ModeMenuProps {
    readonly mode: AgentMode;
    readonly shortcut?: string;
    readonly onPick: (mode: AgentMode) => void;
    readonly onClose: () => void;
}

export const ModeMenu = ({ mode, shortcut, onPick, onClose }: ModeMenuProps): React.ReactElement => <>
    <Backdrop onClose={onClose} />
    <div id='ingot-mode-menu' className='ingot-popover ingot-mode-menu' role='menu' tabIndex={-1} onKeyDown={onEscape(onClose)}
        ref={el => el?.focus()}>
        {AGENT_MODE_INFO.map(m => (
            <button key={m.id} type='button' role='menuitemradio' aria-checked={m.id === mode} id={`ingot-mode-${m.id}`}
                className={`ingot-mode-item${m.id === mode ? ' selected' : ''}`} style={{ '--ingot-mode-color': m.color } as React.CSSProperties}
                onClick={() => onPick(m.id)}>
                <span className={`codicon codicon-${m.icon} ingot-mode-icon`} />
                <span className='ingot-mode-text'><span className='ingot-mode-label'>{m.label}</span><span className='ingot-mode-desc'>{m.description}</span></span>
                {m.id === mode && <span className='codicon codicon-check ingot-mode-check' />}
            </button>
        ))}
        {shortcut && <div className='ingot-popover-footer ingot-dim'>{shortcut} to switch modes</div>}
    </div>
</>;

export interface ModelPickerProps {
    readonly current: string;
    readonly models: readonly CatalogModel[];
    readonly autoResolved?: string;
    readonly configured: (id: string) => boolean;
    readonly favorites: ReadonlySet<string>;
    readonly onToggleFavorite: (id: string) => void;
    readonly onPick: (id: string) => void;
    readonly onAddKey: (id: string) => void;
    readonly onManage: () => void;
    readonly onClose: () => void;
}

interface ModelPickerState {
    readonly query: string;
    /** Family whose `>` submenu is open. */
    readonly open?: string;
    /** The submenu would overflow the window on the right: open it to the left. */
    readonly flip: boolean;
}

/**
 * Model picker (IDEA-91): Auto, favorites, then one row per model family with a `>` arrow that opens a submenu of its
 * models. No speed, context-size, thinking or cost labels. Typing in the search box lists matching models directly.
 */
export class ModelPicker extends React.Component<ModelPickerProps, ModelPickerState> {
    override state: ModelPickerState = { query: '', flip: false };

    protected row(m: CatalogModel, section: string): React.ReactNode {
        const { current, configured, favorites } = this.props;
        const ready = configured(m.id);
        return <div key={`${section}-${m.id}`} role='option' aria-selected={current === m.id} id={`ingot-pick-${section}-${m.id}`} data-model={m.id}
            className={`ingot-pick-row${current === m.id ? ' selected' : ''}${ready ? '' : ' ingot-pick-nokey'}`} onClick={() => this.props.onPick(m.id)}>
            <span className='ingot-pick-label'>{m.label}</span>
            {current === m.id && <span className='codicon codicon-check ingot-pick-check' />}
            {!ready && <button type='button' className='ingot-pick-addkey' onClick={e => { e.stopPropagation(); this.props.onAddKey(m.id); }}>{MODEL_PICKER_TEXT.addKey}</button>}
            <button type='button' className={`ingot-pick-star codicon ${favorites.has(m.id) ? 'codicon-star-full' : 'codicon-star-empty'}`}
                aria-label={`${favorites.has(m.id) ? MODEL_PICKER_TEXT.unfavorite : MODEL_PICKER_TEXT.favorite} ${m.label}`} aria-pressed={favorites.has(m.id)}
                onClick={e => { e.stopPropagation(); this.props.onToggleFavorite(m.id); }} />
        </div>;
    }

    protected openFamily(provider: string | undefined): void {
        if (provider !== this.state.open) {
            this.setState({ open: provider, flip: false });
        }
    }

    /** Flips the submenu to the left when it would leave the window. */
    protected placeSubmenu(el: HTMLDivElement | null): void {
        if (el && !this.state.flip && el.getBoundingClientRect().right > window.innerWidth - 4) {
            this.setState({ flip: true });
        }
    }

    protected family(group: ModelFamilyGroup): React.ReactNode {
        const { family, models } = group;
        const open = this.state.open === family.provider;
        const active = models.find(m => m.id === this.props.current);
        return <div key={family.provider} className='ingot-pick-family-anchor' onMouseEnter={() => this.openFamily(family.provider)}>
            <div role='option' aria-haspopup='listbox' aria-expanded={open} aria-selected={!!active} id={`ingot-pick-family-${family.provider}`} data-family={family.provider}
                className={`ingot-pick-row ingot-pick-family${open ? ' open' : ''}${active ? ' has-current' : ''}`}
                onClick={() => this.openFamily(open ? undefined : family.provider)}
                onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); this.openFamily(family.provider); } else if (e.key === 'ArrowLeft') { this.openFamily(undefined); } }}
                tabIndex={0}>
                <span className={`codicon codicon-${family.icon} ingot-pick-family-icon`} />
                <span className='ingot-pick-label'>{family.label}</span>
                {active && <span className='ingot-dim ingot-pick-family-current'>{active.label}</span>}
                <span className='codicon codicon-chevron-right ingot-pick-arrow' aria-hidden />
            </div>
            {open && <div id={`ingot-pick-sub-${family.provider}`} role='listbox' aria-label={family.label} ref={el => this.placeSubmenu(el)}
                className={`ingot-popover ingot-pick-submenu${this.state.flip ? ' flip' : ''}`}>
                <div className='ingot-pick-heading'>{family.label}</div>
                {models.map(m => this.row(m, family.provider))}
            </div>}
        </div>;
    }

    override render(): React.ReactNode {
        const { models, favorites, current, autoResolved, onClose } = this.props;
        const q = this.state.query.trim().toLowerCase();
        const matches = models.filter(m => m.label.toLowerCase().includes(q));
        const favs = models.filter(m => favorites.has(m.id));
        const showAuto = !q || AUTO_MODEL_LABEL.toLowerCase().includes(q);
        const first = (showAuto ? AUTO_MODEL_ID : undefined) ?? (q ? matches[0]?.id : undefined);
        return <>
            <Backdrop onClose={onClose} />
            <div id='ingot-model-picker' className='ingot-popover ingot-model-picker' role='listbox' onKeyDown={onEscape(onClose)}>
                <input id='ingot-model-search' className='ingot-input ingot-popover-search' placeholder={MODEL_PICKER_TEXT.search} autoFocus value={this.state.query}
                    onChange={e => this.setState({ query: e.currentTarget.value, open: undefined })}
                    onKeyDown={e => { if (e.key === 'Enter' && first) { e.preventDefault(); this.props.onPick(first); } }} />
                <div className='ingot-pick-list'>
                    {showAuto && <div role='option' aria-selected={current === AUTO_MODEL_ID} id='ingot-pick-auto' className={`ingot-pick-row ingot-pick-auto${current === AUTO_MODEL_ID ? ' selected' : ''}`}
                        onMouseEnter={() => this.openFamily(undefined)} onClick={() => this.props.onPick(AUTO_MODEL_ID)}>
                        <span className='codicon codicon-sparkle' />
                        <span className='ingot-pick-label'>{AUTO_MODEL_LABEL}</span>
                        <span className='ingot-dim ingot-pick-auto-hint'>{autoResolved ? `${MODEL_PICKER_TEXT.uses} ${autoResolved}` : MODEL_PICKER_TEXT.autoHint}</span>
                    </div>}
                    {q
                        ? <div className='ingot-pick-section' id='ingot-pick-section-search'>{matches.map(m => this.row(m, 'search'))}</div>
                        : <>
                            {favs.length > 0 && <div className='ingot-pick-section' id='ingot-pick-section-favorites' onMouseEnter={() => this.openFamily(undefined)}>
                                <div className='ingot-pick-heading'>{MODEL_PICKER_TEXT.favorites}</div>
                                {favs.map(m => this.row(m, 'favorites'))}
                            </div>}
                            <div className='ingot-pick-section' id='ingot-pick-section-models'>
                                <div className='ingot-pick-heading'>{MODEL_PICKER_TEXT.models}</div>
                                {groupModelsByFamily(models).map(g => this.family(g))}
                            </div>
                        </>}
                    {q && !showAuto && matches.length === 0 && <div className='ingot-dim ingot-pick-empty'>{MODEL_PICKER_TEXT.noMatch} “{this.state.query}”.</div>}
                </div>
                <button type='button' id='ingot-pick-manage' className='ingot-popover-footer ingot-pick-manage' onClick={this.props.onManage}>
                    <span className='codicon codicon-settings-gear' /> {MODEL_PICKER_TEXT.manage}
                </button>
            </div>
        </>;
    }
}

export interface HistoryProps {
    readonly chats: readonly AgentSession[];
    readonly current?: string;
    readonly onOpen: (id: string) => void;
    readonly onRename: (id: string, title: string) => void;
    readonly onDelete: (id: string) => void;
    readonly onPin: (id: string) => void;
    readonly onMemories?: () => void;
    readonly onClose: () => void;
}

export class ChatHistory extends React.Component<HistoryProps, { query: string; renaming?: string }> {
    override state: { query: string; renaming?: string } = { query: '' };

    override render(): React.ReactNode {
        const now = Date.now();
        const chats = filterChats(this.props.chats, this.state.query);
        return <>
            <Backdrop onClose={this.props.onClose} />
            <div id='ingot-chat-history' className='ingot-popover ingot-chat-history' onKeyDown={onEscape(this.props.onClose)}>
                <input id='ingot-history-search' className='ingot-input ingot-popover-search' placeholder='Search chats' autoFocus value={this.state.query}
                    onChange={e => this.setState({ query: e.currentTarget.value })} />
                <div className='ingot-history-list'>
                    {chats.length === 0 && <div className='ingot-dim ingot-pick-empty'>{this.state.query ? 'No chats match.' : 'No chats yet.'}</div>}
                    {chats.map(c => {
                        const mode = AGENT_MODE_INFO.find(m => m.id === c.mode);
                        return <div key={c.id} data-id={c.id} className={`ingot-history-row${c.id === this.props.current ? ' selected' : ''}`}
                            onClick={() => this.state.renaming !== c.id && this.props.onOpen(c.id)}>
                            <span className={`ingot-agent-status ingot-status-${c.status}`} />
                            {this.state.renaming === c.id
                                ? <input className='ingot-input ingot-history-rename' autoFocus defaultValue={c.title} aria-label='Chat title'
                                    onClick={e => e.stopPropagation()}
                                    onBlur={e => { this.props.onRename(c.id, e.currentTarget.value); this.setState({ renaming: undefined }); }}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') { this.props.onRename(c.id, e.currentTarget.value); this.setState({ renaming: undefined }); }
                                        if (e.key === 'Escape') { e.stopPropagation(); this.setState({ renaming: undefined }); }
                                    }} />
                                : <span className='ingot-history-title'>{c.pinned && <span className='codicon codicon-pinned ingot-history-pin-mark' />}{c.title}</span>}
                            <span className='ingot-history-meta ingot-dim'>{mode && <span className={`codicon codicon-${mode.icon}`} style={{ color: mode.color }} title={mode.label} />}{chatTime(c.updatedAt, now)}</span>
                            <span className='ingot-history-actions'>
                                <button type='button' className={`codicon ${c.pinned ? 'codicon-pinned' : 'codicon-pin'}`} aria-label={c.pinned ? 'Unpin' : 'Pin'} title={c.pinned ? 'Unpin' : 'Pin'}
                                    onClick={e => { e.stopPropagation(); this.props.onPin(c.id); }} />
                                <button type='button' className='codicon codicon-edit' aria-label='Rename' title='Rename' onClick={e => { e.stopPropagation(); this.setState({ renaming: c.id }); }} />
                                <button type='button' className='codicon codicon-trash' aria-label='Delete' title='Delete' onClick={e => { e.stopPropagation(); this.props.onDelete(c.id); }} />
                            </span>
                        </div>;
                    })}
                </div>
                {this.props.onMemories && <button type='button' id='ingot-agents-memories' className='ingot-popover-footer' onClick={this.props.onMemories}>
                    <span className='codicon codicon-lightbulb' />Manage memories…</button>}
            </div>
        </>;
    }
}

export interface MemoriesManagerProps {
    readonly store: MemoryStore;
    readonly onClose?: () => void;
}

interface MemoriesState {
    query: string;
    scope: 'all' | MemoryScope;
    editing?: string;
    adding: boolean;
}

/** List, search, add, edit, delete memories and switch "Generate memories" (Agents panel and Settings). */
export class MemoriesManager extends React.Component<MemoriesManagerProps, MemoriesState> {
    override state: MemoriesState = { query: '', scope: 'all', adding: false };
    protected listener?: { dispose(): void };

    override componentDidMount(): void {
        this.listener = this.props.store.onDidChange(() => this.forceUpdate());
        this.props.store.load();
    }

    override componentWillUnmount(): void {
        this.listener?.dispose();
    }

    protected editor(memory: Memory | undefined, done: () => void): React.ReactNode {
        let text = memory?.text ?? '';
        let scope: MemoryScope = memory?.scope ?? 'project';
        const save = async () => {
            if (memory) {
                await this.props.store.update(memory, text, scope);
            } else {
                await this.props.store.save(scope, text);
            }
            done();
        };
        return <div className='ingot-memory-edit'>
            <textarea id='ingot-memory-text' className='ingot-input' rows={3} autoFocus defaultValue={text} onChange={e => { text = e.currentTarget.value; }}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } if (e.key === 'Escape') { e.stopPropagation(); done(); } }} />
            <div className='ingot-memory-edit-bar'>
                <select id='ingot-memory-scope' className='ingot-select' defaultValue={scope} aria-label='Scope' onChange={e => { scope = e.currentTarget.value as MemoryScope; }}>
                    <option value='project'>Project</option>
                    <option value='global'>Global</option>
                </select>
                <span className='ingot-flex' />
                <button type='button' className='ingot-btn-ghost' onClick={done}>Cancel</button>
                <button type='button' id='ingot-memory-save' className='ingot-btn-primary' onClick={save}>Save</button>
            </div>
        </div>;
    }

    override render(): React.ReactNode {
        const { store, onClose } = this.props;
        const q = this.state.query.trim().toLowerCase();
        const list = store.memories.filter(m => (this.state.scope === 'all' || m.scope === this.state.scope) && (!q || m.text.toLowerCase().includes(q)));
        return <div id='ingot-memories' className='ingot-memories'>
            <div className='ingot-memories-head'>
                <span className='ingot-memories-title'>Memories</span>
                <span className='ingot-flex' />
                <label className='ingot-memories-generate' title='Let agents save facts and preferences they learn'>
                    <input id='ingot-memories-generate' type='checkbox' checked={store.generate} onChange={e => store.generate = e.currentTarget.checked} /> Generate memories
                </label>
                {onClose && <button type='button' id='ingot-memories-close' className='codicon codicon-close ingot-icon-button' aria-label='Close memories' onClick={onClose} />}
            </div>
            <div className='ingot-memories-filters'>
                <input id='ingot-memories-search' className='ingot-input' placeholder='Search memories' value={this.state.query} onChange={e => this.setState({ query: e.currentTarget.value })} />
                <select id='ingot-memories-scope' className='ingot-select' aria-label='Scope filter' value={this.state.scope} onChange={e => this.setState({ scope: e.currentTarget.value as MemoriesState['scope'] })}>
                    <option value='all'>All</option>
                    <option value='project'>Project</option>
                    <option value='global'>Global</option>
                </select>
                <button type='button' id='ingot-memories-add' className='ingot-btn-ghost' onClick={() => this.setState({ adding: true, editing: undefined })}>+ Add</button>
            </div>
            {this.state.adding && this.editor(undefined, () => this.setState({ adding: false }))}
            <div className='ingot-memories-list'>
                {list.length === 0 && <div className='ingot-dim ingot-pick-empty'>{store.memories.length ? 'No memories match.' : 'No memories yet. Agents save facts and preferences here as you work.'}</div>}
                {list.map(m => this.state.editing === m.id
                    ? <React.Fragment key={m.id}>{this.editor(m, () => this.setState({ editing: undefined }))}</React.Fragment>
                    : <div key={m.id} className='ingot-memory-row' data-id={m.id}>
                        <span className={`ingot-memory-scope ingot-memory-scope-${m.scope}`}>{m.scope === 'project' ? 'Project' : 'Global'}</span>
                        <span className='ingot-memory-text'>{m.text}</span>
                        <button type='button' className='codicon codicon-edit' aria-label='Edit memory' onClick={() => this.setState({ editing: m.id, adding: false })} />
                        <button type='button' className='codicon codicon-trash' aria-label='Delete memory' onClick={() => store.remove(m)} />
                    </div>)}
            </div>
            <div className='ingot-dim ingot-memories-note'>Project memories live in <code>.ingot/memories</code> (git-ignored); global ones in <code>~/.ingot/memories</code>.</div>
        </div>;
    }
}
