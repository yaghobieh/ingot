import * as React from '@theia/core/shared/react';
import type { AgentMode, AgentSession } from '../../common/agents/agents.types';
import { AGENT_MODE_INFO } from '../../common/agents/agent-modes';
import { chatTime, filterChats } from '../../common/agents/chat-history';
import { AUTO_MODEL_ID, AUTO_MODEL_LABEL, SIGN_IN_FOR_MODELS } from '../../common/models/models.consts';
import type { CatalogModel, ModelFamilyGroup } from '../../common/models/models.types';
import { groupModelsByFamily } from '../../common/models/models.utils';
import { MODEL_PICKER_TEXT } from './agents.consts';
import { DEFAULT_SCOPE, MEMORIES_DIR, MEMORY_KIND_LABELS, MEMORY_KINDS, type Memory, type MemoryKind, type MemoryScope } from '../../common/memories/memories';
import type { MemoryStore } from './memory-store';
import { formatTokens, usageRatio, type ContextSegment, type ContextUsage } from '../../common/agents/context-usage';

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
    /** Signed out (IDEA-101): show "Sign in to use Ingot models" at the top. */
    readonly onSignIn?: () => void;
    /** Ingot models the server lists but cannot run (IDEA-124): greyed out with this tooltip, not pickable. */
    readonly unavailableReason?: (id: string) => string | undefined;
}

interface ModelPickerState {
    readonly query: string;
    /** Family opened with its `>` arrow; the list then shows that family's models. */
    readonly open?: string;
}

/**
 * Model picker (IDEA-91): Auto, favorites, then one row per model family with a `>` arrow that opens the family's
 * models (with a back row), so it fits a narrow chat panel. No speed, context-size, thinking or cost labels. Typing in
 * the search box lists matching models directly.
 */
export class ModelPicker extends React.Component<ModelPickerProps, ModelPickerState> {
    override state: ModelPickerState = { query: '' };

    protected row(m: CatalogModel, section: string): React.ReactNode {
        const { current, configured, favorites } = this.props;
        const ready = configured(m.id);
        const hosted = m.provider === 'ingot';
        const reason = hosted && !this.props.onSignIn ? this.props.unavailableReason?.(m.id) : undefined;
        return <div key={`${section}-${m.id}`} role='option' aria-selected={current === m.id} aria-disabled={reason ? true : undefined} title={reason}
            id={`ingot-pick-${section}-${m.id}`} data-model={m.id}
            className={`ingot-pick-row${current === m.id ? ' selected' : ''}${ready ? '' : ' ingot-pick-nokey'}${reason ? ' ingot-pick-disabled' : ''}`}
            onClick={() => { if (!reason) { this.props.onPick(m.id); } }}>
            <span className='ingot-pick-label'>{m.label}</span>
            {current === m.id && <span className='codicon codicon-check ingot-pick-check' />}
            {!ready && !hosted && <button type='button' className='ingot-pick-addkey' onClick={e => { e.stopPropagation(); this.props.onAddKey(m.id); }}>{MODEL_PICKER_TEXT.addKey}</button>}
            {!ready && hosted && !this.props.onSignIn && <span className='ingot-pick-unavailable' title={reason ?? MODEL_PICKER_TEXT.unavailableHint}>{MODEL_PICKER_TEXT.unavailable}</span>}
            <button type='button' className={`ingot-pick-star codicon ${favorites.has(m.id) ? 'codicon-star-full' : 'codicon-star-empty'}`}
                aria-label={`${favorites.has(m.id) ? MODEL_PICKER_TEXT.unfavorite : MODEL_PICKER_TEXT.favorite} ${m.label}`} aria-pressed={favorites.has(m.id)}
                onClick={e => { e.stopPropagation(); this.props.onToggleFavorite(m.id); }} />
        </div>;
    }

    protected family(group: ModelFamilyGroup): React.ReactNode {
        const { family, models } = group;
        const active = models.find(m => m.id === this.props.current);
        return <div key={family.provider} role='option' aria-haspopup='listbox' aria-selected={!!active} id={`ingot-pick-family-${family.provider}`} data-family={family.provider}
            className={`ingot-pick-row ingot-pick-family${active ? ' has-current' : ''}`} tabIndex={0}
            onClick={() => this.setState({ open: family.provider })}
            onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.setState({ open: family.provider }); } }}>
            <span className={`codicon codicon-${family.icon} ingot-pick-family-icon`} />
            <span className='ingot-pick-label'>{family.label}</span>
            {active && <span className='ingot-dim ingot-pick-family-current'>{active.label}</span>}
            <span className='codicon codicon-chevron-right ingot-pick-arrow' aria-hidden />
        </div>;
    }

    protected familyModels(group: ModelFamilyGroup): React.ReactNode {
        return <div className='ingot-pick-section' id={`ingot-pick-sub-${group.family.provider}`} role='group' aria-label={group.family.label}>
            <div role='button' tabIndex={0} id='ingot-pick-back' className='ingot-pick-row ingot-pick-back' onClick={() => this.setState({ open: undefined })}
                onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'Enter' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); this.setState({ open: undefined }); } }}>
                <span className='codicon codicon-chevron-left' />
                <span className='ingot-pick-label'>{group.family.label}</span>
            </div>
            {group.models.map(m => this.row(m, group.family.provider))}
        </div>;
    }

    override render(): React.ReactNode {
        const { models, favorites, current, autoResolved, onClose } = this.props;
        const q = this.state.query.trim().toLowerCase();
        const matches = models.filter(m => m.label.toLowerCase().includes(q));
        const favs = models.filter(m => favorites.has(m.id));
        const groups = groupModelsByFamily(models);
        const openGroup = groups.find(g => g.family.provider === this.state.open);
        const showAuto = (!q && !openGroup) || (!!q && AUTO_MODEL_LABEL.toLowerCase().includes(q));
        const first = (showAuto ? AUTO_MODEL_ID : undefined) ?? (q ? matches[0]?.id : undefined);
        return <>
            <Backdrop onClose={onClose} />
            <div id='ingot-model-picker' className='ingot-popover ingot-model-picker' role='listbox' onKeyDown={onEscape(onClose)}>
                <input id='ingot-model-search' className='ingot-input ingot-popover-search' placeholder={MODEL_PICKER_TEXT.search} autoFocus value={this.state.query}
                    onChange={e => this.setState({ query: e.currentTarget.value, open: undefined })}
                    onKeyDown={e => { if (e.key === 'Enter' && first) { e.preventDefault(); this.props.onPick(first); } }} />
                <div className='ingot-pick-list'>
                    {this.props.onSignIn && !q && <button type='button' id='ingot-pick-sign-in' className='ingot-pick-row ingot-pick-sign-in' onClick={this.props.onSignIn}>
                        <span className='codicon codicon-account' />
                        <span className='ingot-pick-label'>{SIGN_IN_FOR_MODELS}</span>
                    </button>}
                    {showAuto && <div role='option' aria-selected={current === AUTO_MODEL_ID} id='ingot-pick-auto' className={`ingot-pick-row ingot-pick-auto${current === AUTO_MODEL_ID ? ' selected' : ''}`}
                        onClick={() => this.props.onPick(AUTO_MODEL_ID)}>
                        <span className='codicon codicon-sparkle' />
                        <span className='ingot-pick-label'>{AUTO_MODEL_LABEL}</span>
                        <span className='ingot-dim ingot-pick-auto-hint'>{autoResolved ? `${MODEL_PICKER_TEXT.uses} ${autoResolved}` : MODEL_PICKER_TEXT.autoHint}</span>
                    </div>}
                    {q
                        ? <div className='ingot-pick-section' id='ingot-pick-section-search'>{matches.map(m => this.row(m, 'search'))}</div>
                        : openGroup ? this.familyModels(openGroup) : <>
                            {favs.length > 0 && <div className='ingot-pick-section' id='ingot-pick-section-favorites'>
                                <div className='ingot-pick-heading'>{MODEL_PICKER_TEXT.favorites}</div>
                                {favs.map(m => this.row(m, 'favorites'))}
                            </div>}
                            <div className='ingot-pick-section' id='ingot-pick-section-models'>
                                <div className='ingot-pick-heading'>{MODEL_PICKER_TEXT.models}</div>
                                {groups.map(g => this.family(g))}
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
        let kind: MemoryKind = memory?.kind ?? 'fact';
        let scope: MemoryScope | undefined = memory?.scope;
        const save = async () => {
            if (memory) {
                await this.props.store.update(memory, { text, scope, kind });
            } else {
                await this.props.store.save(scope ?? DEFAULT_SCOPE[kind], text, undefined, kind);
            }
            done();
        };
        return <div className='ingot-memory-edit'>
            <textarea id='ingot-memory-text' className='ingot-input' rows={3} autoFocus defaultValue={text} onChange={e => { text = e.currentTarget.value; }}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } if (e.key === 'Escape') { e.stopPropagation(); done(); } }} />
            <div className='ingot-memory-edit-bar'>
                <select id='ingot-memory-kind' className='ingot-select' defaultValue={kind} aria-label='Kind' onChange={e => { kind = e.currentTarget.value as MemoryKind; }}>
                    {MEMORY_KINDS.map(k => <option key={k} value={k}>{MEMORY_KIND_LABELS[k]}</option>)}
                </select>
                <select id='ingot-memory-scope' className='ingot-select' defaultValue={scope ?? ''} aria-label='Scope' onChange={e => { scope = (e.currentTarget.value || undefined) as MemoryScope | undefined; }}>
                    {!memory && <option value=''>Default scope</option>}
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
                        <span className={`ingot-memory-kind ingot-memory-kind-${m.kind}`}>{MEMORY_KIND_LABELS[m.kind]}</span>
                        <span className='ingot-memory-text'>{m.text}</span>
                        <button type='button' className='codicon codicon-edit' aria-label='Edit memory' onClick={() => this.setState({ editing: m.id, adding: false })} />
                        <button type='button' className='codicon codicon-trash' aria-label='Delete memory' onClick={() => store.remove(m)} />
                    </div>)}
            </div>
            <div className='ingot-dim ingot-memories-note'>Repo facts live in <code>.ingot/{MEMORIES_DIR}</code> (git-ignored); preferences and other global ones in <code>~/.ingot/{MEMORIES_DIR}</code>. Agents read them at the start of every chat.</div>
        </div>;
    }
}

export interface ContextBreakdownProps {
    readonly usage: ContextUsage;
    readonly segments: readonly ContextSegment[];
    readonly busy: boolean;
    readonly onCompact: () => void;
    readonly onNewWithSummary: () => void;
    readonly onClose: () => void;
}

/** Context ring popover (IDEA-98): how the window is used, and ways to free it. */
export const ContextBreakdown = ({ usage, segments, busy, onCompact, onNewWithSummary, onClose }: ContextBreakdownProps): React.ReactElement => {
    const pct = Math.round(usageRatio(usage) * 100);
    return <>
        <Backdrop onClose={onClose} />
        <div id='ingot-context-popover' className='ingot-popover ingot-context-popover' role='dialog' aria-label='Context usage' tabIndex={-1}
            onKeyDown={onEscape(onClose)} ref={el => el?.focus()}>
            <div className='ingot-context-head'>
                <span className='ingot-context-title'>Context</span>
                <span className='ingot-flex' />
                <span id='ingot-context-total' className='ingot-context-total'>{formatTokens(usage.total)} / {formatTokens(usage.window)} · {pct}%</span>
            </div>
            <div className='ingot-context-bar' aria-hidden='true'>
                {segments.filter(s => s.tokens > 0).map(s => <span key={s.id} className={`ingot-context-seg seg-${s.id}`}
                    style={{ width: `${usage.window > 0 ? Math.max(0.5, (s.tokens / usage.window) * 100) : 0}%` }} />)}
            </div>
            <ul className='ingot-context-list'>
                {segments.map(s => <li key={s.id} id={`ingot-context-${s.id}`} className='ingot-context-row'>
                    <span className={`ingot-context-dot seg-${s.id}`} />
                    <span className='ingot-context-label'>{s.label}</span>
                    <span className='ingot-flex' />
                    <span className='ingot-context-tokens'>{formatTokens(s.tokens)}</span>
                </li>)}
            </ul>
            <div className='ingot-context-actions'>
                <button type='button' id='ingot-context-compact' className='ingot-btn-secondary' disabled={busy} onClick={onCompact}>
                    <span className='codicon codicon-fold' /> Summarize &amp; compact
                </button>
                <button type='button' id='ingot-context-new' className='ingot-btn-primary' disabled={busy} onClick={onNewWithSummary}>
                    <span className='codicon codicon-add' /> New chat with summary
                </button>
            </div>
        </div>
    </>;
};
