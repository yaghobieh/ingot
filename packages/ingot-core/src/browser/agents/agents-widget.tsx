import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { COMPOSER_PLACEHOLDER, NO_MODEL_MESSAGE } from '../../common/agents/agents.consts';
import { modeInfo, nextMode } from '../../common/agents/agent-modes';
import { CONTEXT_NEAR_FULL, usageBreakdown, usageRatio } from '../../common/agents/context-usage';
import { AUTO_MODEL_ID, AUTO_MODEL_LABEL, FAVORITE_MODELS_KEY } from '../../common/models/models.consts';
import { findModel } from '../../common/models/models.utils';
import { ContextKeyService, type ContextKey } from '@theia/core/lib/browser/context-key-service';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { ChatHistory, MemoriesManager, ModeMenu, ModelPicker } from './chat-popovers';
import { MemoryStore } from './memory-store';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { IngotModelClient } from '../models/model-client';
import { MODELS_OPEN_COMMAND } from '../models/models.browser-consts';
import type { AgentSession } from '../../common/agents/agents.types';
import { changesSummary, stepVerb } from '../../common/agents/agents.utils';
import { AgentStore } from './agent-store';
import { EditorManager } from '@theia/editor/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { agentSubtitle } from '../../common/agents/chat-history';
import { chipLabel, chipPreview, composerHeight, INGOT_REF_MIME, insertedText, type ContextChip } from '../../common/agents/context-chips';
import { EditorCopyTracker } from './editor-copy-tracker';
import { AgentEditReview } from './agent-edit-review';
import { AGENT_COMMANDS, AGENTS_FOCUS_KEY, AGENTS_WIDGET_ID, AGENTS_WIDGET_LABEL } from './agents.consts';

type Popover = 'mode' | 'model' | 'history' | undefined;
const COMPOSER_HEIGHT_KEY = 'ingot.composer.height';

/** Right tool window: chats as tabs with History, conversation with plan and tool steps, composer with mode, model and context (IDEA-27/28, IDEA-77). */
@injectable()
export class IngotAgentsWidget extends ReactWidget {

    @inject(AgentStore) protected readonly store: AgentStore;
    @inject(AgentEditReview) protected readonly review: AgentEditReview;
    @inject(IngotModelClient) protected readonly models: IngotModelClient;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(MemoryStore) protected readonly memoryStore: MemoryStore;
    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;
    @inject(KeybindingRegistry) protected readonly keybindings: KeybindingRegistry;
    @inject(EditorCopyTracker) protected readonly copies: EditorCopyTracker;

    protected popover: Popover;
    protected showMemories = false;
    protected renamingTab?: string;
    protected focusKey?: ContextKey<boolean>;
    protected favorites = new Set<string>(JSON.parse(localStorage.getItem(FAVORITE_MODELS_KEY) ?? '[]') as string[]);
    protected draft = '';
    protected composer?: HTMLTextAreaElement | null;
    protected slashIndex = 0;
    protected slashDismissed = false;
    /** Context chips waiting to be sent with the next message (IDEA-65). */
    protected chips: ContextChip[] = [];
    /** Height set by dragging the handle (IDEA-67); persisted. */
    protected manualHeight?: number;

    /** `/` menu entries matching the draft: project commands and skills (IDEA-30). */
    protected get slashItems(): { name: string; description?: string; kind: string }[] {
        const match = /^\/([\w-]*)$/.exec(this.draft);
        if (!match || this.slashDismissed) {
            return [];
        }
        return this.store.projectCommands
            .filter(c => c.name.startsWith(match[1].toLowerCase()))
            .map(c => ({ name: c.name, description: c.description, kind: c.kind === 'skill' ? 'skill' : c.source }));
    }

    protected acceptSlash(name: string): void {
        this.draft = `/${name} `;
        this.slashIndex = 0;
        this.update();
        this.composer?.focus();
    }

    @postConstruct()
    protected init(): void {
        this.id = AGENTS_WIDGET_ID;
        this.title.label = AGENTS_WIDGET_LABEL;
        this.title.caption = AGENTS_WIDGET_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'ingot-icon ingot-icon-ai';
        this.addClass('ingot-agents');
        this.toDispose.push(this.store.onDidChange(() => this.update()));
        this.toDispose.push(this.review.onDidChange(() => this.update()));
        this.toDispose.push(this.models.onDidChange(() => this.update()));
        this.toDispose.push(this.editors.onCurrentEditorChanged(() => this.update()));
        this.focusKey = this.contextKeys.createKey<boolean>(AGENTS_FOCUS_KEY, false);
        this.node.addEventListener('focusin', () => this.focusKey?.set(true));
        this.node.addEventListener('focusout', e => { if (!this.node.contains(e.relatedTarget as Node | null)) { this.focusKey?.set(false); } });
        const stored = Number(localStorage.getItem(COMPOSER_HEIGHT_KEY));
        this.manualHeight = stored > 0 ? stored : undefined;
        this.update();
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        const observer = new ResizeObserver(() => this.fitComposer());
        observer.observe(this.node);
        this.toDispose.push({ dispose: () => observer.disconnect() });
    }

    protected override onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg);
        requestAnimationFrame(() => this.fitComposer());
    }

    /** Min ~4 lines, grows with content up to half the panel then scrolls; a dragged height wins (IDEA-67). */
    protected fitComposer(): void {
        const el = this.composer;
        if (!el) {
            return;
        }
        el.style.height = 'auto';
        el.style.height = `${composerHeight(el.scrollHeight, this.node.clientHeight, this.manualHeight)}px`;
    }

    protected startResize(e: React.MouseEvent): void {
        e.preventDefault();
        const startY = e.clientY;
        const startHeight = this.composer?.offsetHeight ?? 0;
        const move = (ev: MouseEvent) => {
            this.manualHeight = composerHeight(0, this.node.clientHeight, startHeight + (startY - ev.clientY));
            this.fitComposer();
        };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            if (this.manualHeight) {
                localStorage.setItem(COMPOSER_HEIGHT_KEY, String(this.manualHeight));
            }
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    }

    protected resetHeight(): void {
        this.manualHeight = undefined;
        localStorage.removeItem(COMPOSER_HEIGHT_KEY);
        this.fitComposer();
    }

    /** Adds a chip (Add to Chat ⌘L, editor paste) unless the same range is already attached. */
    addChip(data: Omit<ContextChip, 'id'>): void {
        if (!this.chips.some(c => c.uri === data.uri && c.start === data.start && c.end === data.end)) {
            this.chips = [...this.chips, { ...data, id: `${Date.now()}-${this.chips.length}` }];
        }
        this.update();
        this.composer?.focus();
    }

    /** Add to Chat: the current editor selection becomes a chip; returns false when nothing is selected. */
    addSelectionChip(): boolean {
        const selection = this.copies.selection();
        if (selection) {
            this.addChip(selection);
        }
        return !!selection;
    }

    protected removeChip(id: string): void {
        this.chips = this.chips.filter(c => c.id !== id);
        this.update();
        this.composer?.focus();
    }

    protected openChip(chip: ContextChip): void {
        this.editors.open(new URI(chip.uri), { selection: { start: { line: chip.start - 1, character: 0 }, end: { line: chip.end - 1, character: Number.MAX_SAFE_INTEGER } } });
    }

    /** Multi-line text copied from an editor pastes as a chip; anything else pastes as plain text. */
    protected onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>): void {
        const chip = this.copies.match(e.clipboardData.getData('text/plain'), e.clipboardData.getData(INGOT_REF_MIME) || undefined);
        if (chip) {
            e.preventDefault();
            this.addChip(chip);
        }
    }

    /**
     * The desktop app's paste command (⌘V, Edit > Paste) inserts clipboard text with `execCommand('insertText')`, which
     * fires neither `paste` nor `beforeinput`; only the resulting change. A multi-line insertion that matches the last
     * editor copy is therefore taken back out of the draft and becomes a chip.
     */
    protected pastedChip(e: React.ChangeEvent<HTMLTextAreaElement>): ContextChip | Omit<ContextChip, 'id'> | undefined {
        const inputType = (e.nativeEvent as InputEvent).inputType;
        if (inputType !== 'insertText' && inputType !== 'insertFromPaste') {
            return undefined;
        }
        const inserted = insertedText(this.draft, e.currentTarget.value);
        return inserted && inserted.includes('\n') ? this.copies.match(inserted) : undefined;
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        (this.composer ?? this.node).focus();
    }

    /** Appends context such as `@src/a.ts:12 useCart` to the composer and focuses it (IDEA-56). */
    addContext(text: string): void {
        this.draft = this.draft.trim() ? `${this.draft.trimEnd()} ${text} ` : `${text} `;
        this.update();
        this.composer?.focus();
    }

    protected submit(): void {
        if (!this.draft.trim() && !this.chips.length) {
            return;
        }
        this.store.send(this.draft.trim() || 'Explain this code.', this.chips);
        this.draft = '';
        this.chips = [];
        this.update();
    }

    /** Keybinding label for a command, for tooltips (follows the user's keymap). */
    protected shortcut(commandId: string): string {
        const binding = this.keybindings.getKeybindingsForCommand(commandId)[0];
        return binding ? this.keybindings.acceleratorFor(binding, '+').join(' ') : '';
    }

    newChat(): void {
        this.popover = undefined;
        this.showMemories = false;
        this.store.create();
        this.update();
        this.composer?.focus();
    }

    cycleMode(): void {
        this.store.mode = nextMode(this.store.mode);
        this.store.changed();
    }

    toggleHistory(): void {
        this.popover = this.popover === 'history' ? undefined : 'history';
        this.update();
    }

    toggleMemories(): void {
        this.showMemories = !this.showMemories;
        this.popover = undefined;
        this.update();
    }

    protected closePopover(): void {
        this.popover = undefined;
        this.update();
        this.composer?.focus();
    }

    protected toggleFavorite(id: string): void {
        if (this.favorites.has(id)) {
            this.favorites.delete(id);
        } else {
            this.favorites.add(id);
        }
        localStorage.setItem(FAVORITE_MODELS_KEY, JSON.stringify([...this.favorites]));
        this.update();
    }

    protected modelLabel(id: string): string {
        return id === AUTO_MODEL_ID ? AUTO_MODEL_LABEL : findModel(id)?.label ?? id;
    }

    protected render(): React.ReactNode {
        const current = this.store.current;
        const tabs = this.store.tabs;
        return <div className='ingot-agents-root'>
            <div className='ingot-agents-header'>
                <button type='button' className={`ingot-agents-tab${this.popover !== 'history' ? ' active' : ''}`} id='ingot-agents-tab-agents'
                    onClick={() => { this.popover = undefined; this.showMemories = false; this.update(); }}>Agents</button>
                <button type='button' className={`ingot-agents-tab${this.popover === 'history' ? ' active' : ''}`} id='ingot-agents-tab-history'
                    onClick={() => this.toggleHistory()}>History</button>
                <span className='ingot-flex' />
                <button type='button' id='ingot-agents-new' className='ingot-icon-button codicon codicon-add' aria-label='New chat'
                    title={`New chat${this.shortcut(AGENT_COMMANDS.newAgent.id) ? ` (${this.shortcut(AGENT_COMMANDS.newAgent.id)})` : ''}`} onClick={() => this.newChat()} />
                <button type='button' id='ingot-agents-history' className={`ingot-icon-button codicon codicon-history${this.popover === 'history' ? ' active' : ''}`} aria-label='Chat history'
                    title={`Chat history${this.shortcut(AGENT_COMMANDS.history.id) ? ` (${this.shortcut(AGENT_COMMANDS.history.id)})` : ''}`} onClick={() => this.toggleHistory()} />
                {this.popover === 'history' && <ChatHistory chats={this.store.sessions} current={current?.id}
                    onOpen={id => { this.store.reopen(id); this.popover = undefined; this.update(); }}
                    onRename={(id, title) => this.store.rename(id, title)} onDelete={id => this.store.remove(id)} onPin={id => this.store.togglePin(id)}
                    onMemories={() => this.toggleMemories()}
                    onClose={() => this.closePopover()} />}
            </div>
            {tabs.length > 0 && <div className='ingot-agents-list ingot-chat-tabs' role='tablist'>
                {tabs.map(t => (
                    <div key={t.id} role='tab' aria-selected={current?.id === t.id} data-id={t.id} title={t.title}
                        className={`ingot-agent-item ingot-chat-tab${current?.id === t.id ? ' active selected' : ''}`}
                        onClick={() => this.store.select(t.id)}
                        onMouseDown={e => { if (e.button === 1) { e.preventDefault(); this.store.closeTab(t.id); } }}
                        onDoubleClick={() => { this.renamingTab = t.id; this.update(); }}>
                        <span className={`ingot-agent-status ingot-status-${t.status}`} />
                        <span className='ingot-agent-item-text'>
                            {this.renamingTab === t.id
                                ? <input className='ingot-input ingot-chat-tab-rename' autoFocus defaultValue={t.title} aria-label='Chat title'
                                    onBlur={e => { this.store.rename(t.id, e.currentTarget.value); this.renamingTab = undefined; this.update(); }}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') { e.currentTarget.blur(); }
                                        if (e.key === 'Escape') { this.renamingTab = undefined; this.update(); }
                                    }} />
                                : <span className='ingot-agent-item-title ingot-chat-tab-title'>{t.title}</span>}
                            <span className='ingot-agent-item-sub'>{agentSubtitle(t, Date.now(), current?.id === t.id && this.review.pending ? this.review.queued + 1 : 0)}</span>
                        </span>
                        <button type='button' className='ingot-chat-tab-close codicon codicon-close' aria-label={`Close ${t.title}`}
                            onClick={e => { e.stopPropagation(); this.store.closeTab(t.id); }} />
                    </div>
                ))}
            </div>}
            {this.showMemories
                ? <div className='ingot-agents-chat ingot-agents-memories-pane'><MemoriesManager store={this.memoryStore} onClose={() => this.toggleMemories()} /></div>
                : <div className='ingot-agents-chat'>{current && current.messages.length ? this.renderSession(current)
                    : <div className='ingot-agents-hint'>Describe a task and an agent will plan, edit and ask you to review.</div>}</div>}
            {this.renderComposer()}
        </div>;
    }

    protected renderSession(session: AgentSession): React.ReactNode {
        const pending = this.review.pending;
        // While edits wait in the inline review, the card already counts the files under review.
        const reviewing = pending ? new Set(session.steps.filter(st => st.kind === 'edit').map(st => st.target)).size + this.review.queued - session.changes.length : 0;
        return <>
            {session.messages.map((m, i) => m.memory
                ? <div key={i} className={`ingot-chat-memory${m.memory.undone ? ' undone' : ''}`}>
                    <span className='codicon codicon-lightbulb' />
                    <span className='ingot-chat-memory-text'>{m.memory.undone ? 'Memory removed' : 'Memory saved'} · <span className='ingot-dim'>{m.text}</span></span>
                    {!m.memory.undone && <button type='button' className='ingot-btn-ghost ingot-memory-undo' onClick={() => this.store.undoMemory(session.id, i)}>Undo</button>}
                </div>
                : (
                <div key={i} className={`ingot-chat-msg ingot-chat-${m.role}`}>
                    {m.from && <div className='ingot-chat-from'>{m.from}</div>}
                    {m.chips && m.chips.length > 0 && <div className='ingot-chat-chips'>{m.chips.map((c, j) => <span key={j} className={`ingot-chip ingot-chip-sent ingot-chip-${c.kind ?? 'code'}`} title={c.kind === 'memory' ? 'Memory' : c.kind === 'rule' ? `Rule ${c.path}` : c.path}>
                        {c.kind === 'memory' && <span className='codicon codicon-lightbulb' />}{c.kind === 'rule' && <span className='codicon codicon-law' />}{c.label}</span>)}</div>}
                    {m.text || (m.role === 'agent' && this.store.isRunning(session.id) ? <span className='ingot-chat-typing'>…</span> : '')}
                    {m.role === 'agent' && i === session.messages.length - 1 && session.status === 'editing' && session.activeFile && <div className='ingot-chat-editing'>Editing {session.activeFile}…</div>}
                    {m.buildable && session.mode === 'plan' && <div><button type='button' id='ingot-plan-build' className='ingot-btn-primary ingot-chat-action'
                        onClick={() => this.store.build(session.id)}><span className='codicon codicon-play' /> Build</button></div>}
                    {m.text === NO_MODEL_MESSAGE && <div><button type='button' id='ingot-open-models' className='ingot-btn-primary ingot-chat-action' onClick={() => this.commands.executeCommand(MODELS_OPEN_COMMAND.id)}>Open Models</button></div>}
                </div>
            ))}
            {session.plan.length > 0 && <div className='ingot-chat-plan'>
                <div className='ingot-chat-label'>Plan</div>
                {session.plan.map((p, i) => (
                    <div key={i} className={`ingot-plan-item ingot-plan-${p.state}`}><span className='ingot-plan-mark'>{p.state === 'done' ? '✓' : p.state === 'active' ? '●' : '○'}</span>{p.text}</div>
                ))}
            </div>}
            {session.steps.map((step, i) => (
                <div key={i} className={`ingot-chat-step ${step.done ? 'done' : 'running'}`}>
                    <span className='ingot-step-mark'>{step.done ? '✓' : '●'}</span>
                    <span className='ingot-step-text'>{stepVerb(step)} {step.target}</span>
                    {step.added !== undefined && <span className='ingot-step-diff'><span className='ingot-plus'>+{step.added}</span> <span className='ingot-minus'>−{step.removed ?? 0}</span></span>}
                </div>
            ))}
            {(reviewing > 0 || session.changes.length > 0) && <div className='ingot-chat-changes'>
                <span>{changesSummary(reviewing || session.changes.length)}</span>
                <span className='ingot-flex' />
                {pending ? <>
                    <button type='button' id='ingot-agents-undo' className='ingot-btn-ghost' onClick={() => this.review.reject()}>Undo</button>
                    <button type='button' id='ingot-agents-keep' className='ingot-btn-primary' onClick={() => this.keepAll()}>Keep all</button>
                </> : <span className='ingot-dim'>Kept</span>}
            </div>}
        </>;
    }

    /** Accepts the edit under review and every edit queued behind it. */
    protected async keepAll(): Promise<void> {
        for (let i = 0; i < 200 && (this.review.pending || this.review.queued); i++) {
            if (this.review.pending) {
                await this.review.accept();
            } else {
                await new Promise(resolve => setTimeout(resolve, 25));
            }
        }
    }

    protected renderComposer(): React.ReactNode {
        const items = this.slashItems;
        return <div className='ingot-composer'>
            <div className='ingot-composer-resize' id='ingot-composer-resize' title='Drag to resize · double-click to reset' onMouseDown={e => this.startResize(e)} onDoubleClick={() => this.resetHeight()} />
            {this.renderSummarize()}
            <div className='ingot-composer-chips' id='ingot-composer-chips'>
                {this.renderContextChips()}
                {this.chips.map(chip => (
                    <span key={chip.id} className='ingot-chip ingot-chip-code' data-path={chip.path}>
                        <button type='button' className='ingot-chip-remove' aria-label={`Remove ${chipLabel(chip)}`} onClick={() => this.removeChip(chip.id)}>✕</button>
                        <button type='button' className='ingot-chip-label' onClick={() => this.openChip(chip)}>{chipLabel(chip)}</button>
                        <span className='ingot-chip-preview' role='tooltip'>
                            <span className='ingot-chip-preview-path'>{chip.path}:{chip.start}-{chip.end}</span>
                            <pre>{chipPreview(chip.text)}</pre>
                        </span>
                    </span>
                ))}
            </div>
            {items.length > 0 && <div id='ingot-slash-menu' className='ingot-slash-menu' role='listbox'>
                {items.map((item, i) => (
                    <div key={item.name} id={`ingot-slash-item-${item.name}`} role='option' aria-selected={i === this.slashIndex}
                        className={`ingot-slash-item${i === this.slashIndex ? ' selected' : ''}`} onMouseDown={e => { e.preventDefault(); this.acceptSlash(item.name); }}>
                        <code>/{item.name}</code><span className='ingot-badge'>{item.kind}</span><span className='ingot-slash-desc'>{item.description}</span>
                    </div>
                ))}
            </div>}
            <textarea id='ingot-composer-input' ref={el => { this.composer = el; }} className='ingot-composer-input' placeholder={COMPOSER_PLACEHOLDER} value={this.draft} rows={2}
                onPaste={e => this.onPaste(e)}
                onChange={e => {
                    const pasted = this.pastedChip(e);
                    if (pasted) {
                        e.currentTarget.value = this.draft;
                        this.addChip(pasted);
                        return;
                    }
                    const value = e.currentTarget.value;
                    if (value === '/' && this.draft === '') {
                        this.slashDismissed = false;
                        this.slashIndex = 0;
                        this.store.loadCommands();
                    }
                    this.draft = value;
                    this.update();
                }}
                onKeyDown={e => {
                    const items = this.slashItems;
                    if (items.length) {
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                            e.preventDefault();
                            this.slashIndex = (this.slashIndex + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
                            this.update();
                            return;
                        }
                        if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault();
                            this.acceptSlash(items[Math.min(this.slashIndex, items.length - 1)].name);
                            return;
                        }
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            this.slashDismissed = true;
                            this.update();
                            return;
                        }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submit(); }
                    if (e.key === 'Escape' && this.store.current && this.store.isRunning(this.store.current.id)) { e.preventDefault(); this.store.stop(this.store.current.id); }
                }} />
            <div className='ingot-composer-bar'>
                {this.renderModePill()}
                {this.renderModelPill()}
                <span className='ingot-flex' />
                {this.renderUsageRing()}
                {this.store.isRunning(this.store.current?.id)
                    ? <button type='button' id='ingot-composer-stop' className='ingot-composer-send ingot-composer-stop' aria-label='Stop' title='Stop (Esc)' onClick={() => this.store.stop(this.store.current!.id)}>■</button>
                    : <button type='button' id='ingot-composer-send' className='ingot-composer-send' aria-label='Send' disabled={!this.draft.trim() && !this.chips.length} onClick={() => this.submit()}>↑</button>}
            </div>
        </div>;
    }

    /** Rules and memories the last request used (IDEA-77). Files come only from pasted code and @ mentions. */
    protected renderContextChips(): React.ReactNode {
        const current = this.store.current;
        return <>
            {current?.context?.rules.map(r => <span key={`r-${r}`} className='ingot-chip ingot-chip-rule' title={`Rule applied: ${r}`}><span className='codicon codicon-law' />{r}</span>)}
            {current?.context?.memories.map(m => <span key={`m-${m.id}`} className='ingot-chip ingot-chip-memory' title={m.text}><span className='codicon codicon-lightbulb' />{m.text.length > 28 ? `${m.text.slice(0, 27)}…` : m.text}</span>)}
        </>;
    }

    protected renderModePill(): React.ReactNode {
        const info = modeInfo(this.store.mode);
        const key = this.shortcut(AGENT_COMMANDS.cycleMode.id);
        return <span className='ingot-pill-anchor'>
            <button type='button' id='ingot-composer-mode' className='ingot-pill ingot-mode-pill' data-mode={info.id} aria-haspopup='menu' aria-expanded={this.popover === 'mode'}
                style={{ '--ingot-mode-color': info.color } as React.CSSProperties} title={`${info.description}${key ? ` (${key} to switch)` : ''}`}
                onClick={() => { this.popover = this.popover === 'mode' ? undefined : 'mode'; this.update(); }}>
                <span className={`codicon codicon-${info.icon}`} />{info.label}<span className='codicon codicon-chevron-down ingot-pill-caret' />
            </button>
            {this.popover === 'mode' && <ModeMenu mode={info.id} shortcut={key} onClose={() => this.closePopover()}
                onPick={mode => { this.store.mode = mode; this.store.changed(); this.closePopover(); }} />}
        </span>;
    }

    protected renderModelPill(): React.ReactNode {
        const model = this.store.model;
        const resolved = this.store.resolveModel(model);
        const ready = this.models.isModelConfigured(resolved);
        return <span className='ingot-pill-anchor'>
            <button type='button' id='ingot-composer-model' className={`ingot-pill ingot-model-pill${ready ? '' : ' ingot-pill-warn'}`} data-model={model} aria-haspopup='listbox'
                aria-expanded={this.popover === 'model'} title={ready ? this.modelLabel(resolved) : 'No key for this model yet'}
                onClick={() => { this.popover = this.popover === 'model' ? undefined : 'model'; this.update(); }}>
                {this.modelLabel(model)}<span className='codicon codicon-chevron-down ingot-pill-caret' />
            </button>
            {this.popover === 'model' && <ModelPicker current={model} models={this.models.catalog}
                autoResolved={resolved !== AUTO_MODEL_ID && model === AUTO_MODEL_ID ? this.modelLabel(resolved) : undefined}
                configured={id => this.models.isModelConfigured(id)} favorites={this.favorites}
                onToggleFavorite={id => this.toggleFavorite(id)}
                onPick={id => { this.store.model = id; this.store.changed(); this.closePopover(); }}
                onAddKey={() => { this.closePopover(); this.commands.executeCommand(MODELS_OPEN_COMMAND.id); }}
                onManage={() => { this.closePopover(); this.commands.executeCommand(MODELS_OPEN_COMMAND.id); }}
                onClose={() => this.closePopover()} />}
        </span>;
    }

    /** Ring showing how full the context window was on the last request; hover for the breakdown. */
    protected renderUsageRing(): React.ReactNode {
        const usage = this.store.current?.context?.usage;
        const ratio = usageRatio(usage);
        const r = 7;
        const c = 2 * Math.PI * r;
        if (!usage || ratio <= 0) {
            // Nothing sent yet: no ring (an empty ring reads as a spinner).
            return undefined;
        }
        return <span id='ingot-context-ring' className={`ingot-context-ring${ratio >= CONTEXT_NEAR_FULL ? ' near-full' : ''}`} data-ratio={ratio.toFixed(3)}
            title={usage ? usageBreakdown(usage) : 'Context usage appears after the first message'} aria-label={`Context ${Math.round(ratio * 100)}% used`}>
            <svg width='18' height='18' viewBox='0 0 18 18'>
                <circle cx='9' cy='9' r={r} className='ingot-ring-track' />
                <circle cx='9' cy='9' r={r} className='ingot-ring-value' strokeDasharray={`${c * ratio} ${c}`} transform='rotate(-90 9 9)' />
            </svg>
        </span>;
    }

    protected renderSummarize(): React.ReactNode {
        const current = this.store.current;
        if (!current || usageRatio(current.context?.usage) < CONTEXT_NEAR_FULL || this.store.isRunning(current.id)) {
            return undefined;
        }
        return <div className='ingot-summarize' id='ingot-summarize'>
            <span className='codicon codicon-warning' /> Context is nearly full.
            <span className='ingot-flex' />
            <button type='button' id='ingot-summarize-continue' className='ingot-btn-primary' onClick={() => this.store.summarizeAndContinue(current.id)}>Summarize &amp; continue</button>
        </div>;
    }
}
