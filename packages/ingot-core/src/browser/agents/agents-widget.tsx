import * as React from '@theia/core/shared/react';
import { ImageHoverService } from '../preview/image-hover-service';
import { actionLine, activityLine } from '../../common/agents/agent-actions';
import { exploredLine, extractThought } from '../../common/agents/tool-cards';
import { ThoughtRow, ToolCardView } from './tool-card';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { PRODUCT } from '../../common/product.consts';
import { COMPOSER_PLACEHOLDER, NO_MODEL_MESSAGE, SIGN_IN_MESSAGE } from '../../common/agents/agents.consts';
import { modeInfo, nextMode } from '../../common/agents/agent-modes';
import { CONTEXT_NEAR_FULL, contextSegments, formatTokens, messageWeights, usageRatio } from '../../common/agents/context-usage';
import { fileIconClass } from '../../common/icons/file-icon-map';
import { AUTO_MODEL_ID, AUTO_MODEL_LABEL, FAVORITE_MODELS_KEY } from '../../common/models/models.consts';
import { findModel } from '../../common/models/models.utils';
import { ContextKeyService, type ContextKey } from '@theia/core/lib/browser/context-key-service';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { ChatHistory, ContextBreakdown, MemoriesManager, ModeMenu, ModelPicker } from './chat-popovers';
import { Dictation } from './dictation';
import { IngotFeatureFlags } from '../config/feature-flags';
import { IDE_FLAGS } from '../../common/config/remote-config.consts';
import type { DictationState } from './dictation.types';
import { MessageService } from '@theia/core/lib/common/message-service';
import { IngotAccountService } from '../account/account-service';
import { AccountAvatar } from '../account/account-avatar';
import { SIGN_IN_FOR_MODELS } from '../../common/models/models.consts';
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
import { composerHeight, INGOT_REF_MIME, type ContextChip } from '../../common/agents/context-chips';
import { composeParts } from '../../common/agents/composer-parts';
import type { ImageChip, SentPart } from '../../common/agents/composer-parts.types';
import { tabContextLevel, tabLabel, UNTITLED_TAB_TOOLTIP } from '../../common/agents/chat-tabs';
import { InlineComposer, readImage } from './inline-composer';
import { COMPOSER_INPUT_ID, MAX_DROPPED_FILE_CHARS } from './inline-composer.consts';
import { AgentMarkdownRenderer } from './markdown-renderer';
import { COPIED_LABEL, COPY_LABEL } from './markdown.consts';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { ZAPREX_APP_URL, ZAPREX_LINK_LABEL } from './zaprex-link.consts';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { lineCount } from '../../common/agents/context-chips';
import type { AgentStep } from '../../common/agents/agents.types';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { EditorCopyTracker } from './editor-copy-tracker';
import { ContextMenuRenderer } from '@theia/core/lib/browser/context-menu-renderer';
import { LAYOUT_CONTEXT_MENU } from '../layout/layout.browser-consts';
import { ChangeTracker } from '../changes/change-tracker';
import { CodeChangeBlock } from '../changes/code-change-block';
import { changeStats, isPending } from '../../common/changes/changes.utils';
import { formatCountdown, reviewFileState } from '../../common/review/review';
import { ReviewComments } from '../review/review-comments';
import type { CodeChange } from '../../common/changes/changes.types';
import { AGENT_COMMANDS, AGENTS_FOCUS_KEY, AGENTS_WIDGET_ID, AGENTS_WIDGET_LABEL } from './agents.consts';
import { ProcessStore } from '../processes/process-store';
import { ProcessesPanel } from '../processes/processes-panel';
import { BROWSER_COMMANDS } from '../browser-tool/browser-contribution';
import { PROCESS_COMMANDS } from '../processes/processes.browser-consts';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { RUN_PREFS } from '../../common/processes/run-settings';

type Popover = 'mode' | 'model' | 'history' | 'context' | undefined;
const COMPOSER_HEIGHT_KEY = 'ingot.composer.height';

/** Right tool window: chats as tabs with History, conversation with plan and tool steps, composer with mode, model and context (IDEA-27/28, IDEA-77). */
@injectable()
export class IngotAgentsWidget extends ReactWidget {

    @inject(AgentStore) protected readonly store: AgentStore;
    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;
    @inject(ReviewComments) protected readonly reviewComments: ReviewComments;
    /** Code-change blocks the user collapsed (they start open). */
    protected readonly collapsedChanges = new Set<string>();
    @inject(IngotModelClient) protected readonly models: IngotModelClient;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(IngotAccountService) protected readonly account: IngotAccountService;
    @inject(IngotFeatureFlags) protected readonly flags: IngotFeatureFlags;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(MemoryStore) protected readonly memoryStore: MemoryStore;
    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;
    @inject(KeybindingRegistry) protected readonly keybindings: KeybindingRegistry;
    @inject(EditorCopyTracker) protected readonly copies: EditorCopyTracker;
    @inject(ContextMenuRenderer) protected readonly contextMenu: ContextMenuRenderer;
    @inject(WindowService) protected readonly windows: WindowService;
    @inject(FileService) protected readonly files: FileService;
    @inject(ProcessStore) protected readonly processes: ProcessStore;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(ImageHoverService) protected readonly imageHovers: ImageHoverService;

    protected readonly markdown = new AgentMarkdownRenderer(() => this.update());
    /** Expanded "Read rules" step rows, by session id + step index. */
    protected expandedSteps = new Set<string>();

    protected popover: Popover;
    protected showMemories = false;
    protected renamingTab?: string;
    protected focusKey?: ContextKey<boolean>;
    protected favorites = new Set<string>(JSON.parse(localStorage.getItem(FAVORITE_MODELS_KEY) ?? '[]') as string[]);
    /** Plain text of the composer (chips left out), mirrored for the `/` menu and the live tab name. */
    protected draft = '';
    protected composer?: HTMLDivElement | null;
    protected inline?: InlineComposer;
    protected composerEmpty = true;
    /** Enlarged image chip (click a thumbnail). */
    protected lightbox?: ImageChip;
    protected dictation?: Dictation;
    protected dictationState: DictationState = 'idle';
    protected dictationInterim = '';
    /** Right-click menu on a chat tab (IDEA-98). */
    protected tabMenu?: { id: string; x: number; y: number };
    protected dragTab?: string;
    protected tabStrip?: HTMLDivElement | null;
    protected tabOverflow = { left: false, right: false };
    protected slashIndex = 0;
    protected slashDismissed = false;
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
        this.slashIndex = 0;
        this.inline?.setText(`/${name} `);
        this.focusComposer();
    }

    protected focusComposer(): void {
        if (this.inline) {
            this.inline.focus();
        } else {
            this.focusComposer();
        }
    }

    /** Creates the inline editor once React has mounted its element (IDEA-98). */
    protected setComposer(el: HTMLDivElement | null): void {
        if (!el || el === this.composer) {
            return;
        }
        this.composer = el;
        this.inline?.dispose();
        this.inline = new InlineComposer(el, {
            onChange: () => this.composerChanged(),
            openCode: chip => this.openChip(chip),
            openImage: image => { this.lightbox = image; this.update(); },
            drop: data => this.onDrop(data)
        });
        el.classList.add('empty');
    }

    protected composerChanged(): void {
        const text = this.inline?.text ?? '';
        if (text === '/' && this.draft === '') {
            this.slashDismissed = false;
            this.slashIndex = 0;
            this.store.loadCommands();
        }
        this.draft = text;
        this.composerEmpty = this.inline?.empty ?? true;
        this.update();
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
        this.toDispose.push(this.account.onDidChange(() => this.update()));
        this.toDispose.push(this.processes.onDidChange(() => this.update()));
        this.toDispose.push(this.preferences.onPreferenceChanged(e => { if (e.preferenceName === RUN_PREFS.showProcesses) { this.update(); } }));
        this.toDispose.push(this.tracker.onDidChange(() => {
            // IDEA-105: deciding a file during a checkpoint is review activity, so the countdown stops.
            const current = this.store.current;
            if (current?.pause?.continueAt !== undefined && this.reviewTouched) {
                this.store.holdPause(current.id);
            }
            this.reviewTouched = false;
            this.update();
        }));
        const ticker = setInterval(() => { if (this.store.current?.pause?.continueAt !== undefined) { this.update(); } }, 500);
        this.toDispose.push({ dispose: () => clearInterval(ticker) });
        this.toDispose.push(this.models.onDidChange(() => this.update()));
        this.toDispose.push(this.reviewComments.onDidChange(() => this.update()));
        this.toDispose.push(this.flags.onDidChange(() => this.update()));
        this.toDispose.push(this.editors.onCurrentEditorChanged(() => this.update()));
        this.focusKey = this.contextKeys.createKey<boolean>(AGENTS_FOCUS_KEY, false);
        this.node.addEventListener('focusin', () => this.focusKey?.set(true));
        this.node.addEventListener('focusout', e => { if (!this.node.contains(e.relatedTarget as Node | null)) { this.focusKey?.set(false); } });
        this.toDispose.push({ dispose: () => this.inline?.dispose() });
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
        requestAnimationFrame(() => { this.fitComposer(); this.checkTabOverflow(); });
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

    /** Adds a code chip at the caret (Add to Chat ⌘L, editor paste) unless the same range is already in the composer. */
    addChip(data: Omit<ContextChip, 'id'>): void {
        const inline = this.inline;
        if (!inline) {
            return;
        }
        if (!inline.codeChips.some(c => c.uri === data.uri && c.start === data.start && c.end === data.end)) {
            inline.insertCode(data);
        }
        this.focusComposer();
    }

    /** Add to Chat: the current editor selection becomes a chip; returns false when nothing is selected. */
    addSelectionChip(): boolean {
        const selection = this.copies.selection();
        if (selection) {
            this.addChip(selection);
        }
        return !!selection;
    }

    protected openChip(chip: ContextChip): void {
        this.editors.open(new URI(chip.uri), { selection: { start: { line: chip.start - 1, character: 0 }, end: { line: chip.end - 1, character: Number.MAX_SAFE_INTEGER } } });
    }

    /** Images become thumbnail chips; lines copied from an editor become a code chip; anything else pastes as plain text. */
    protected onPaste(e: React.ClipboardEvent<HTMLDivElement>): void {
        const inline = this.inline;
        if (!inline) {
            return;
        }
        e.preventDefault();
        const files = Array.from(e.clipboardData.items).filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter((f): f is File => !!f);
        if (files.length) {
            this.addImages(files);
            return;
        }
        const text = e.clipboardData.getData('text/plain');
        const chip = this.copies.match(text, e.clipboardData.getData(INGOT_REF_MIME) || undefined);
        if (chip) {
            this.addChip(chip);
        } else if (text) {
            inline.insertText(text);
        }
    }

    protected async addImages(files: readonly File[]): Promise<void> {
        for (const [i, file] of files.entries()) {
            const image = await readImage(file, file.name && file.name !== 'image.png' ? file.name : `image-${Date.now().toString(36)}${i ? `-${i}` : ''}.png`);
            if (image) {
                this.inline?.insertImage(image);
            }
        }
        this.focusComposer();
    }

    /** Drop images (thumbnails) or files from the project tree / Finder (file chips) at the drop point (IDEA-100). */
    protected onDrop(data: DataTransfer): boolean {
        const all = Array.from(data.files);
        const images = all.filter(f => f.type.startsWith('image/'));
        const others = all.filter(f => !f.type.startsWith('image/'));
        const uris = ApplicationShell.getDraggedEditorUris(data);
        if (!images.length && !others.length && !uris.length) {
            return false;
        }
        this.dropFiles(images, others, uris);
        return true;
    }

    protected async dropFiles(images: readonly File[], others: readonly File[], uris: readonly URI[]): Promise<void> {
        await this.addImages(images);
        const root = this.workspace.tryGetRoots()[0]?.resource;
        for (const uri of uris) {
            const content = await this.files.read(uri).then(r => r.value, () => undefined);
            if (content !== undefined) {
                this.addFileChip(root?.relative(uri)?.toString() ?? uri.path.base, uri.toString(), content);
            }
        }
        for (const file of others) {
            const content = await file.text().catch(() => undefined);
            if (content !== undefined) {
                const path = (window as { electronTheiaCore?: { getPathForFile?(f: File): string } }).electronTheiaCore?.getPathForFile?.(file) ?? '';
                const uri = path ? URI.fromFilePath(path) : undefined;
                this.addFileChip(uri && root?.relative(uri)?.toString() || file.name, uri?.toString() ?? '', content);
            }
        }
    }

    protected addFileChip(path: string, uri: string, content: string): void {
        const text = content.length > MAX_DROPPED_FILE_CHARS ? `${content.slice(0, MAX_DROPPED_FILE_CHARS)}\n…` : content;
        this.inline?.insertCode({ path, uri, start: 1, end: Math.max(1, lineCount(text)), text, whole: true });
        this.focusComposer();
    }

    protected attachImages(input: HTMLInputElement): void {
        const files = Array.from(input.files ?? []);
        input.value = '';
        this.addImages(files);
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        if (this.composer) {
            this.focusComposer();
        } else {
            this.node.focus();
        }
    }

    /** Appends context such as `@src/a.ts:12 useCart` to the composer and focuses it (IDEA-56). */
    addContext(text: string): void {
        this.inline?.appendText(`${text} `);
        this.focusComposer();
    }

    /** Sends text and chips in the order they were typed (IDEA-98). */
    protected submit(): void {
        const inline = this.inline;
        if (!inline || inline.empty) {
            return;
        }
        const composed = composeParts(inline.parts);
        const prompt = composed.text.trim() || 'Explain this code.';
        this.store.send(prompt, composed.chips, composed.expanded ? composed : undefined);
        inline.clear();
        this.draft = '';
        this.composerEmpty = true;
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
        this.focusComposer();
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
        this.focusComposer();
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

    /** Right-click on the chat header: move the chat right or to the bottom (IDEA-85). */
    protected openLayoutMenu(event: React.MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.contextMenu.render({ menuPath: LAYOUT_CONTEXT_MENU, anchor: { x: event.clientX, y: event.clientY }, context: event.currentTarget as HTMLElement });
    }

    protected render(): React.ReactNode {
        const current = this.store.current;
        const tabs = this.store.tabs;
        const empty = !this.showMemories && !current?.messages.length;
        return <div className={`ingot-agents-root${empty ? ' ingot-agents-root-empty' : ''}`}>
            <div className='ingot-agents-header' onContextMenu={e => this.openLayoutMenu(e)}>
                {this.renderTabs(tabs, current)}
                <button type='button' id='ingot-agents-new' className='ingot-icon-button codicon codicon-add' aria-label='New chat'
                    title={`New chat${this.shortcut(AGENT_COMMANDS.newAgent.id) ? ` (${this.shortcut(AGENT_COMMANDS.newAgent.id)})` : ''}`} onClick={() => this.newChat()} />
                <button type='button' id='ingot-agents-processes' className={`ingot-icon-button codicon codicon-server-process${this.processes.pinned ? ' active' : ''}`}
                    aria-label='Processes' aria-pressed={this.processes.pinned} title={`Processes${this.processes.running.length ? ` · ${this.processes.running.length} running` : ''}`}
                    onClick={() => this.processes.setPinned(!this.processes.pinned)} />
                <button type='button' id='ingot-agents-history' className={`ingot-icon-button codicon codicon-history${this.popover === 'history' ? ' active' : ''}`} aria-label='Chat history'
                    title={`Chat history${this.shortcut(AGENT_COMMANDS.history.id) ? ` (${this.shortcut(AGENT_COMMANDS.history.id)})` : ''}`} onClick={() => this.toggleHistory()} />
                <button type='button' id='ingot-agents-zaprex' className='ingot-icon-button ingot-zaprex-link' aria-label={ZAPREX_LINK_LABEL} title={ZAPREX_LINK_LABEL}
                    onClick={() => this.windows.openNewWindow(ZAPREX_APP_URL, { external: true })}><span className='ingot-zaprex-link-icon' aria-hidden='true' /></button>
                {this.popover === 'history' && <ChatHistory chats={this.store.sessions} current={current?.id}
                    onOpen={id => { this.store.reopen(id); this.popover = undefined; this.update(); }}
                    onRename={(id, title) => this.store.rename(id, title)} onDelete={id => this.store.remove(id)} onPin={id => this.store.togglePin(id)}
                    onMemories={() => this.toggleMemories()}
                    onClose={() => this.closePopover()} />}
            </div>
            {this.tabMenu && this.renderTabMenu()}
            {this.lightbox && <div className='ingot-lightbox' id='ingot-lightbox' role='dialog' aria-label={this.lightbox.name} onClick={() => { this.lightbox = undefined; this.update(); }}>
                <img src={`data:${this.lightbox.mediaType};base64,${this.lightbox.data}`} alt={this.lightbox.name} />
                <span className='ingot-lightbox-name'>{this.lightbox.name}</span>
            </div>}
            {this.showMemories
                ? <div className='ingot-agents-chat ingot-agents-memories-pane'><MemoriesManager store={this.memoryStore} onClose={() => this.toggleMemories()} /></div>
                : <div className='ingot-agents-chat'>{current && current.messages.length ? this.renderSession(current)
                    : <div className='ingot-agents-empty-state' id='ingot-agents-empty-state'>
                        <div className='ingot-agents-empty-title'>{PRODUCT.name}</div>
                        <div className='ingot-agents-hint'>Describe a task and an agent will plan, edit and ask you to review.</div>
                    </div>}</div>}
            {!this.showMemories && this.renderProcesses()}
            {!this.showMemories && this.renderApproval(current)}
            {!this.showMemories && this.renderChangesBar(current)}
            {this.renderComposer()}
            {empty && <div className='ingot-agents-disclaimer'>AI can make mistakes. Review generated code before you keep it.</div>}
        </div>;
    }

    /** Open chats as one compact row of tabs (IDEA-98): pinned first, drag to reorder, middle-click closes, right-click menu. */
    protected renderTabs(tabs: readonly AgentSession[], current: AgentSession | undefined): React.ReactNode {
        return <div className='ingot-chat-tabs-wrap'>
            {this.tabOverflow.left && <button type='button' className='ingot-chat-tabs-scroll codicon codicon-chevron-left' aria-label='Scroll tabs left' onClick={() => this.scrollTabs(-1)} />}
            <div className='ingot-chat-tabs' id='ingot-chat-tabs' role='tablist' ref={el => { this.tabStrip = el; }}
                onWheel={e => { if (this.tabStrip && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { this.tabStrip.scrollLeft += e.deltaY; this.checkTabOverflow(); } }}
                onScroll={() => this.checkTabOverflow()}>
                {tabs.map(t => {
                    const active = current?.id === t.id;
                    const label = tabLabel(t.title, active && !t.messages.length ? this.draft : '');
                    const level = tabContextLevel(usageRatio(t.context?.usage));
                    return <div key={t.id} role='tab' tabIndex={0} aria-selected={active} data-id={t.id} title={label || UNTITLED_TAB_TOOLTIP} draggable={this.renamingTab !== t.id}
                        className={`ingot-chat-tab${active ? ' active' : ''}${t.pinned ? ' pinned' : ''}${level !== 'ok' ? ` context-${level}` : ''}${label ? '' : ' untitled'}`}
                        onClick={() => this.store.select(t.id)}
                        onMouseDown={e => { if (e.button === 1) { e.preventDefault(); this.store.closeTab(t.id); } }}
                        onDoubleClick={() => this.startRename(t.id)}
                        onKeyDown={e => { if (e.key === 'F2') { e.preventDefault(); this.startRename(t.id); } }}
                        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); this.tabMenu = { id: t.id, x: e.clientX, y: e.clientY }; this.update(); }}
                        onDragStart={e => { this.dragTab = t.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-ingot-tab', t.id); }}
                        onDragEnter={e => this.acceptTabDrag(e)}
                        onDragOver={e => this.acceptTabDrag(e)}
                        onDrop={e => { e.preventDefault(); if (this.dragTab && this.dragTab !== t.id) { this.store.moveTab(this.dragTab, t.id); } this.dragTab = undefined; }}
                        onDragEnd={() => { this.dragTab = undefined; }}>
                        {t.pinned && <span className='ingot-chat-tab-pin codicon codicon-pinned' aria-label='Pinned' />}
                        {this.store.isRunning(t.id) && <span className={`ingot-agent-status ingot-status-${t.status}`} />}
                        {this.renamingTab === t.id
                            ? <input className='ingot-input ingot-chat-tab-rename' autoFocus defaultValue={label} aria-label='Chat title'
                                onClick={e => e.stopPropagation()}
                                onBlur={e => { this.store.rename(t.id, e.currentTarget.value); this.renamingTab = undefined; this.update(); }}
                                onKeyDown={e => {
                                    e.stopPropagation();
                                    if (e.key === 'Enter') { e.currentTarget.blur(); }
                                    if (e.key === 'Escape') { this.renamingTab = undefined; this.update(); }
                                }} />
                            : label ? <span className='ingot-chat-tab-title'>{label}</span> : <span className='ingot-chat-tab-blank codicon codicon-comment' />}
                        {!t.pinned && <button type='button' className='ingot-chat-tab-close codicon codicon-close' aria-label={`Close ${label || 'chat'}`}
                            onClick={e => { e.stopPropagation(); this.store.closeTab(t.id); }} />}
                    </div>;
                })}
            </div>
            {this.tabOverflow.right && <button type='button' className='ingot-chat-tabs-scroll codicon codicon-chevron-right' aria-label='Scroll tabs right' onClick={() => this.scrollTabs(1)} />}
        </div>;
    }

    /** The workbench marks document drags as "no drop"; claim tab drags so reordering works in the desktop app. */
    protected acceptTabDrag(e: React.DragEvent): void {
        if (this.dragTab) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
        }
    }

    protected startRename(id: string): void {
        this.tabMenu = undefined;
        this.renamingTab = id;
        this.update();
    }

    protected scrollTabs(direction: number): void {
        this.tabStrip?.scrollBy({ left: direction * 160, behavior: 'smooth' });
        setTimeout(() => this.checkTabOverflow(), 300);
    }

    protected checkTabOverflow(): void {
        const el = this.tabStrip;
        if (!el) {
            return;
        }
        const left = el.scrollLeft > 1;
        const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
        if (left !== this.tabOverflow.left || right !== this.tabOverflow.right) {
            this.tabOverflow = { left, right };
            this.update();
        }
    }

    protected renderTabMenu(): React.ReactNode {
        const menu = this.tabMenu!;
        const tab = this.store.tabs.find(t => t.id === menu.id);
        if (!tab) {
            return undefined;
        }
        const close = (): void => { this.tabMenu = undefined; this.update(); };
        const item = (id: string, label: string, run: () => void, danger = false) =>
            <button type='button' role='menuitem' id={`ingot-tab-menu-${id}`} className={`ingot-tab-menu-item${danger ? ' danger' : ''}`} onClick={() => { close(); run(); }}>{label}</button>;
        return <div className='ingot-tab-menu-backdrop' onMouseDown={close} onContextMenu={e => { e.preventDefault(); close(); }}>
            <div className='ingot-tab-menu' id='ingot-tab-menu' role='menu' style={{ left: menu.x, top: menu.y }} onMouseDown={e => e.stopPropagation()}>
                {item('rename', 'Rename', () => this.startRename(tab.id))}
                {item('pin', tab.pinned ? 'Unpin' : 'Pin', () => this.store.togglePin(tab.id))}
                <div className='ingot-tab-menu-sep' />
                {item('close', 'Close', () => this.store.closeTab(tab.id))}
                {item('close-others', 'Close Others', () => this.store.closeOthers(tab.id))}
                <div className='ingot-tab-menu-sep' />
                {item('delete', 'Delete…', () => this.deleteChat(tab.id), true)}
            </div>
        </div>;
    }

    protected async deleteChat(id: string): Promise<void> {
        const tab = this.store.sessions.find(t => t.id === id);
        const name = tab ? tabLabel(tab.title) : '';
        const confirmed = await new ConfirmDialog({
            title: 'Delete chat', msg: `Delete ${name ? `"${name}"` : 'this chat'}? It is removed from History too.`, ok: 'Delete', cancel: 'Cancel'
        }).open();
        if (confirmed) {
            this.store.remove(id);
        }
    }

    /** A sent user message with its chips and images inline, in order (IDEA-98). */
    protected renderParts(parts: readonly SentPart[], images: readonly ImageChip[] = []): React.ReactNode {
        return <div className='ingot-chat-parts'>{parts.map((p, i) => {
            if (p.kind === 'text') {
                return <span key={i}>{p.text}</span>;
            }
            if (p.kind === 'code') {
                return <span key={i} className='ingot-chip ingot-chip-sent ingot-chip-code ingot-chip-inline' title={p.path}><span className={p.path ? fileIconClass(p.path.split('/').pop() ?? p.path) : 'codicon codicon-code'} />{p.label}</span>;
            }
            const image = images.find(img => img.id === p.id);
            return <span key={i} className='ingot-chip ingot-chip-sent ingot-chip-image ingot-chip-inline' title={p.name}
                onClick={() => { if (image?.data) { this.lightbox = image; this.update(); } }}>
                {image?.data ? <img className='ingot-chip-thumb' src={`data:${image.mediaType};base64,${image.data}`} alt={p.name} /> : <span className='codicon codicon-file-media' />}
                {p.name}
            </span>;
        })}</div>;
    }

    protected renderMessage(session: AgentSession, m: AgentSession['messages'][number], i: number): React.ReactNode {
        if (m.role === 'tool' && m.tool) {
            const key = `${session.id}:tool:${i}`;
            return <ToolCardView key={i} info={m.tool} text={m.text} from={m.from} expanded={this.expandedSteps.has(key)}
                onToggle={() => { if (!this.expandedSteps.delete(key)) { this.expandedSteps.add(key); } this.update(); }}
                openLink={url => this.windows.openNewWindow(url, { external: true })} />;
        }
        const thought = m.role === 'agent' && !m.parts ? extractThought(m.text) : undefined;
        if (thought?.thought !== undefined) {
            const key = `${session.id}:thought:${i}`;
            m = { ...m, text: thought.rest };
            return <React.Fragment key={i}>
                <ThoughtRow thought={thought.thought} thinking={thought.thinking && this.store.isRunning(session.id)} expanded={this.expandedSteps.has(key)}
                    onToggle={() => { if (!this.expandedSteps.delete(key)) { this.expandedSteps.add(key); } this.update(); }} />
                {this.renderMessageBody(session, m, i)}
            </React.Fragment>;
        }
        return this.renderMessageBody(session, m, i);
    }

    protected renderMessageBody(session: AgentSession, m: AgentSession['messages'][number], i: number): React.ReactNode {
        return m.memory
            ? <div key={i} className={`ingot-chat-memory${m.memory.undone ? ' undone' : ''}`}>
                    <span className='codicon codicon-lightbulb' />
                    <span className='ingot-chat-memory-text'>{m.memory.undone ? 'Memory removed' : 'Memory saved'} · <span className='ingot-dim'>{m.text}</span></span>
                    {!m.memory.undone && <button type='button' className='ingot-btn-ghost ingot-memory-undo' onClick={() => this.store.undoMemory(session.id, i)}>Undo</button>}
                </div>
                : (
                <div key={i} className={`ingot-chat-msg ingot-chat-${m.role}${m.role === 'user' && this.account.account ? ' ingot-chat-has-avatar' : ''}`}>
                    {m.role === 'user' && this.account.account && <AccountAvatar account={this.account.account} src={this.account.avatarSrc} className='ingot-chat-user-avatar' textless />}
                    {m.from && <div className='ingot-chat-from'>{m.from}</div>}
                    {m.parts ? this.renderParts(m.parts, m.images) : m.chips && m.chips.length > 0 && <div className='ingot-chat-chips'>{m.chips.map((c, j) => <span key={j} className={`ingot-chip ingot-chip-sent ingot-chip-${c.kind ?? 'code'}`} title={c.kind === 'memory' ? 'Memory' : c.kind === 'rule' ? `Rule ${c.path}` : c.path}>
                        {c.kind === 'memory' && <span className='codicon codicon-lightbulb' />}{c.kind === 'rule' && <span className='codicon codicon-law' />}{c.label}</span>)}</div>}
                    {m.role === 'agent' && <div className='ingot-chat-agent-head'><span className='ingot-chat-logo' aria-hidden='true'>&lt;/&gt;</span><b>Ingot</b><span className='ingot-dim'>· {this.replyModel(session)}</span></div>}
                    {m.parts ? '' : m.role === 'agent'
                        ? (m.text ? <div className='ingot-md' onClick={e => this.onMarkdownClick(e)} onMouseOver={e => this.onMarkdownHover(e)} onMouseOut={() => this.imageHovers.hide()} dangerouslySetInnerHTML={{ __html: this.markdown.render(m.text) }} />
                            : this.store.isRunning(session.id) ? <span className='ingot-chat-typing'>…</span> : '')
                        : m.text}
                    {m.role === 'tool' && !!m.images?.length && <div className='ingot-chat-tool-images'>{m.images.filter(img => img.data).map(img =>
                        <img key={img.id} className='ingot-chat-tool-image' src={`data:${img.mediaType};base64,${img.data}`} alt={img.name}
                            onClick={() => { this.lightbox = img; this.update(); }} />)}</div>}
                    {m.role === 'agent' && i === session.messages.length - 1 && session.status === 'editing' && session.activeFile && !this.tracker.forMessage(session.id, i).length && <div className='ingot-chat-editing'>Editing {session.activeFile}…</div>}
                    {m.role === 'agent' && this.tracker.forMessage(session.id, i).map(change => <CodeChangeBlock key={change.id} change={change}
                        expanded={!this.collapsedChanges.has(change.id)}
                        onToggle={() => { if (!this.collapsedChanges.delete(change.id)) { this.collapsedChanges.add(change.id); } this.update(); }}
                        onOpen={hunkId => this.tracker.reveal(change.id, hunkId)}
                        onDecide={(hunks, state) => this.tracker.decide(change.id, hunks, state)} />)}
                    {(m.role === 'user' || m.role === 'agent') && this.store.canRevertTo(session.id, i) && <button type='button' className='ingot-chat-revert' id={`ingot-revert-${i}`}
                        title={m.role === 'user' ? 'Restore files to before this message and drop the replies after it' : 'Restore files to right after this reply and drop what came later'}
                        onClick={() => this.store.revertTo(session.id, i)}><span className='codicon codicon-discard' /> Revert to here</button>}
                    {m.buildable && session.mode === 'plan' && <div><button type='button' id='ingot-plan-build' className='ingot-btn-primary ingot-chat-action'
                        onClick={() => this.store.build(session.id)}><span className='codicon codicon-play' /> Build</button></div>}
                    {m.text === SIGN_IN_MESSAGE && <div className='ingot-chat-sign-in'>
                        <button type='button' id='ingot-chat-sign-in' className='ingot-btn-primary ingot-chat-action' onClick={() => this.account.signIn(false)}>{SIGN_IN_FOR_MODELS}</button>
                        {this.account.devSignInAvailable && <button type='button' id='ingot-chat-sign-in-dev' className='ingot-btn-secondary ingot-chat-action' onClick={() => this.account.signIn(true)}>Dev: test@ingot.dev</button>}
                    </div>}
                    {m.text === NO_MODEL_MESSAGE && <div><button type='button' id='ingot-open-models' className='ingot-btn-primary ingot-chat-action' onClick={() => this.commands.executeCommand(MODELS_OPEN_COMMAND.id)}>Open Models</button></div>}
                </div>);
    }

    /** Collapsible "Read rules · AGENTS.md, engineering" row shown above the reply (IDEA-100). */
    protected renderReadStep(session: AgentSession, step: AgentStep, index: number): React.ReactNode {
        const key = `${session.id}:${index}`;
        const open = this.expandedSteps.has(key);
        const rules = step.target.startsWith('rules: ');
        const items = (rules ? step.target.slice('rules: '.length) : step.target).split(', ').filter(Boolean);
        return <div key={`read-${index}`} className={`ingot-chat-read${open ? ' open' : ''}`}>
            <button type='button' className='ingot-chat-read-row' aria-expanded={open}
                onClick={() => { if (open) { this.expandedSteps.delete(key); } else { this.expandedSteps.add(key); } this.update(); }}>
                <span className='codicon codicon-check ingot-chat-read-mark' />
                <span className='ingot-chat-read-label'>{rules ? 'Read rules' : 'Read'}</span>
                <span className='ingot-chat-read-items'>{items.map((item, j) => <code key={j}>{item}</code>)}</span>
                <span className='ingot-flex' />
                <span className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} />
            </button>
            {open && <ul className='ingot-chat-read-list'>{items.map((item, j) => <li key={j}><span className={`codicon codicon-${rules ? 'law' : 'file'}`} />{item}</li>)}</ul>}
        </div>;
    }

    protected replyModel(session: AgentSession): string {
        return this.modelLabel(this.store.resolveModel(session.model));
    }

    /** Copy buttons on code blocks and links in rendered replies. */
    /** IDEA-145: hovering an image path (inline code or link text) shows a thumbnail. */
    protected onMarkdownHover(e: React.MouseEvent<HTMLDivElement>): void {
        const target = (e.target as HTMLElement).closest('code, a');
        if (target instanceof HTMLElement && !target.closest('pre')) {
            void this.imageHovers.showFor(target);
        }
    }

    protected onMarkdownClick(e: React.MouseEvent<HTMLDivElement>): void {
        const target = e.target as HTMLElement;
        const copy = target.closest<HTMLElement>('[data-md-copy]');
        if (copy) {
            const code = copy.closest('.ingot-md-code')?.querySelector('code')?.textContent ?? '';
            navigator.clipboard.writeText(code).catch(() => undefined);
            copy.lastChild!.textContent = COPIED_LABEL;
            copy.classList.add('copied');
            setTimeout(() => { copy.lastChild!.textContent = COPY_LABEL; copy.classList.remove('copied'); }, 1200);
            return;
        }
        const link = target.closest<HTMLAnchorElement>('a[data-md-link]');
        if (link) {
            e.preventDefault();
            const href = link.getAttribute('href') ?? '';
            if (/^https?:/i.test(href)) {
                this.windows.openNewWindow(href, { external: true });
            }
        }
    }

    protected renderSession(session: AgentSession): React.ReactNode {
        const lastAgent = session.messages.map(m => m.role).lastIndexOf('agent');
        const readSteps = session.steps.map((step, index) => ({ step, index })).filter(({ step }) => step.kind === 'read');
        // IDEA-177: tool steps are drawn as cards; the muted "Explored N files, M searches" line sums up the run.
        const hasCards = session.messages.some(m => m.tool);
        const explored = hasCards ? exploredLine(session.steps, this.store.isRunning(session.id)) : undefined;
        return <>
            {session.messages.map((m, i) => i === lastAgent && readSteps.length > 0
                ? <React.Fragment key={i}>{readSteps.map(({ step, index }) => this.renderReadStep(session, step, index))}{this.renderMessage(session, m, i)}</React.Fragment>
                : this.renderMessage(session, m, i))}
            {lastAgent < 0 && readSteps.map(({ step, index }) => this.renderReadStep(session, step, index))}
            {session.plan.length > 0 && <div className='ingot-chat-plan'>
                <div className='ingot-chat-label'>Plan</div>
                {session.plan.map((p, i) => (
                    <div key={i} className={`ingot-plan-item ingot-plan-${p.state}`}><span className='ingot-plan-mark'>{p.state === 'done' ? '✓' : p.state === 'active' ? '●' : '○'}</span>{p.text}</div>
                ))}
            </div>}
            {explored && <div className='ingot-chat-explored' id='ingot-chat-explored'><span className='ingot-chat-explored-verb'>{explored.split(' ')[0]}</span> {explored.split(' ').slice(1).join(' ')}</div>}
            {session.steps.map((step, i) => step.kind === 'read' || (hasCards && step.kind === 'run' && !step.target.startsWith('/')) ? undefined : (
                <div key={i} className={`ingot-chat-step ${step.done ? 'done' : 'running'}`}>
                    <span className='ingot-step-mark'>{step.done ? '✓' : '●'}</span>
                    <span className='ingot-step-text'>{stepVerb(step)} {step.target}</span>
                    {step.added !== undefined && <span className='ingot-step-diff'><span className='ingot-plus'>+{step.added}</span> <span className='ingot-minus'>−{step.removed ?? 0}</span></span>}
                </div>
            ))}
            {session.changes.length > 0 && !this.tracker.pending(session.id).length && <div className='ingot-chat-changes'>
                <span>{changesSummary(session.changes.length)}</span>
                <span className='ingot-flex' />
                <span className='ingot-dim'>Kept</span>
            </div>}
        </>;
    }

    /** Set by review clicks so the tracker update that follows counts as interaction (stops the countdown). */
    protected reviewTouched = false;

    protected touchReview(session: AgentSession): void {
        this.reviewTouched = true;
        this.store.holdPause(session.id);
    }

    /**
     * IDEA-105 review panel above the composer: the checkpoint card (countdown, Continue now / Wait / Stop), the
     * changed-files list (+/−, status, per-file Accept / Reject, click opens the diff) and Accept All / Reject All.
     * With review off the list is information only.
     */
    protected renderChangesBar(session: AgentSession | undefined): React.ReactNode {
        if (!session) {
            return undefined;
        }
        const review = this.store.review;
        const run = this.tracker.lastRun(session.id).filter(c => c.status !== 'streaming');
        const pending = run.filter(isPending);
        const paused = session.status === 'paused' && session.pause;
        const drafts = this.reviewComments.drafts(session.id);
        if (!pending.length && !paused && !drafts.length && !(run.length && !review.enabled && this.lastRunVisible(session))) {
            return undefined;
        }
        const stats = pending.map(c => changeStats(c.hunks.filter(h => h.state === 'pending'))).reduce((a, b) => ({ added: a.added + b.added, removed: a.removed + b.removed }), { added: 0, removed: 0 });
        const hunks = pending.reduce((n, c) => n + c.hunks.filter(h => h.state === 'pending').length, 0);
        return <div className='ingot-review' id='ingot-review'>
            <div className='ingot-review-card'>
                {paused && session.pause && this.renderPause(session, session.pause)}
                {pending.length > 0 && review.enabled
                    ? <div className='ingot-changes-bar' id='ingot-changes-bar'>
                        <span id='ingot-changes-summary'>{changesSummary(pending.length)} · {hunks} {hunks === 1 ? 'change' : 'changes'} <span className='ingot-plus'>+{stats.added}</span> <span className='ingot-minus'>−{stats.removed}</span></span>
                        <span className='ingot-flex' />
                        <button type='button' className='ingot-icon-button codicon codicon-arrow-up ingot-changes-nav' title='Previous change (⌥↑)' aria-label='Previous change' onClick={() => this.tracker.navigate(-1)} />
                        <button type='button' className='ingot-icon-button codicon codicon-arrow-down ingot-changes-nav' title='Next change (⌥↓)' aria-label='Next change' onClick={() => this.tracker.navigate(1)} />
                        <button type='button' id='ingot-changes-reject-all' className='ingot-review-link' onClick={() => { this.touchReview(session); void this.tracker.decideAll('rejected', session.id); }}>Reject All</button>
                        <button type='button' id='ingot-changes-accept-all' className='ingot-review-link accept' onClick={() => { this.touchReview(session); void this.tracker.decideAll('accepted', session.id); }}>Accept All</button>
                    </div>
                    : <div className='ingot-review-files-head'>{run.length} {run.length === 1 ? 'file' : 'files'} changed{review.enabled ? '' : ' · review off'}</div>}
                <div className={`ingot-review-files${review.enabled ? '' : ' info'}`} id='ingot-review-files'>
                    {run.map((change, i) => this.renderReviewFile(session, change, i, review.enabled))}
                </div>
            </div>
            {drafts.length > 0 && <div className='ingot-review-comments-bar' id='ingot-review-comments-bar'>
                <span className='codicon codicon-comment' />
                <span id='ingot-review-comments-count'>{drafts.length} pending {drafts.length === 1 ? 'comment' : 'comments'}</span>
                <span className='ingot-flex' />
                <button type='button' id='ingot-review-submit' className='ingot-btn-primary' onClick={() => this.reviewComments.submit(session.id)}>Finish review</button>
            </div>}
        </div>;
    }

    /**
     * IDEA-109 approval card (design: docs/design/approval-card-reference.png): a muted activity line, then one
     * muted line "<action>: <detail…>" and Skip / Always Run / Run ⏎. Enter = Run, Esc = Skip; with a note typed in
     * the composer, Enter or Skip sends it to the agent as the reason.
     */
    protected renderApproval(session: AgentSession | undefined): React.ReactNode {
        const approval = session?.approval;
        if (!session || !approval) {
            return undefined;
        }
        const activity = activityLine(session.steps);
        const full = approval.detail ? `${approval.label}: ${approval.detail}` : approval.label;
        return <div className='ingot-approval-wrap' id='ingot-approval-wrap'>
            {activity && <div className='ingot-approval-activity' id='ingot-approval-activity'><span className='ingot-approval-activity-verb'>Exploring</span> {activity.replace(/^Exploring /, '')}</div>}
            <div className='ingot-approval' id='ingot-approval' role='alertdialog' aria-label={full} tabIndex={0} data-kind={approval.kind}
                ref={el => this.focusApproval(el, approval.id)}
                onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.store.decideApproval(session.id, 'run'); }
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.decideFromComposer('skip'); }
                }}>
                <div className='ingot-approval-line' id='ingot-approval-line' title={full} aria-label={actionLine(approval, 200)}>
                    <span className='ingot-approval-label'>{approval.label}{approval.detail ? ':' : ''}</span>{approval.detail && <span className='ingot-approval-detail'> {approval.detail.replace(/\s+/g, ' ').trim()}</span>}
                </div>
                <div className='ingot-approval-actions'>
                    {!this.composerEmpty && <span className='ingot-approval-note ingot-dim'>Your note is sent as the reason</span>}
                    <button type='button' id='ingot-approval-skip' className='ingot-approval-skip' title='Skip (Esc)' onClick={() => this.decideFromComposer('skip')}>Skip</button>
                    <button type='button' id='ingot-approval-always' className='ingot-approval-always' title={approval.command ? `Run "${approval.command}" now and every time in this project without asking` : `Run this and future ${approval.kind === 'mcp' ? 'MCP tool calls' : approval.kind} actions in this project without asking`}
                        onClick={() => this.store.decideApproval(session.id, 'always')}>Always Run</button>
                    <button type='button' id='ingot-approval-run' className='ingot-approval-run' title='Run (Enter)' onClick={() => this.store.decideApproval(session.id, 'run')}>Run <span className='ingot-approval-key'>⏎</span></button>
                </div>
            </div>
        </div>;
    }

    protected focusedApproval?: string;
    /** Takes focus when a new card appears and focus is already in the chat, so Enter / Esc answer it. */
    protected focusApproval(el: HTMLDivElement | null, id: string): void {
        if (!el || this.focusedApproval === id) {
            return;
        }
        this.focusedApproval = id;
        const active = document.activeElement;
        // The composer answers Enter / Esc itself, so it keeps focus (a note typed there becomes the Skip reason).
        if ((!active || active === document.body || this.node.contains(active)) && active?.id !== COMPOSER_INPUT_ID) {
            el.focus();
        }
    }

    /** Skip (with the composer text as the reason) or Run from the keyboard. */
    protected decideFromComposer(decision: 'run' | 'skip'): void {
        const session = this.store.current;
        if (!session?.approval) {
            return;
        }
        const reason = decision === 'skip' && this.inline && !this.inline.empty ? this.inline.text.trim() : undefined;
        if (reason !== undefined) {
            this.inline?.clear();
            this.draft = '';
            this.composerEmpty = true;
        }
        this.store.decideApproval(session.id, decision, reason);
        this.composer?.focus();
    }

    /** Review off: the info list stays until the next message. */
    protected lastRunVisible(session: AgentSession): boolean {
        const lastAgent = session.messages.map(m => m.role).lastIndexOf('agent');
        const lastUser = session.messages.map(m => m.role).lastIndexOf('user');
        return lastAgent > lastUser;
    }

    protected renderPause(session: AgentSession, pause: NonNullable<AgentSession['pause']>): React.ReactNode {
        const left = pause.continueAt === undefined ? undefined : (pause.continueAt - Date.now()) / 1000;
        return <div className='ingot-review-pause' id='ingot-review-pause' role='status'>
            <span className='codicon codicon-debug-pause' />
            <span className='ingot-review-pause-text'>Paused for review · {pause.applied} of {pause.total} files applied</span>
            {left !== undefined && <span className='ingot-review-countdown' id='ingot-review-countdown'>Continuing in {formatCountdown(left)}</span>}
            <span className='ingot-flex' />
            <button type='button' id='ingot-review-stop' className='ingot-review-link' onClick={() => this.store.stop(session.id)}>Stop</button>
            {left !== undefined && <button type='button' id='ingot-review-wait' className='ingot-review-link' onClick={() => this.store.holdPause(session.id)}>Wait</button>}
            <button type='button' id='ingot-review-continue' className='ingot-review-link accept' onClick={() => this.store.continueRun(session.id)}>Continue now</button>
        </div>;
    }

    protected renderReviewFile(session: AgentSession, change: CodeChange, index: number, enabled: boolean): React.ReactNode {
        const name = change.path.split('/').pop() ?? change.path;
        const stats = this.tracker.stats(change);
        const state = isPending(change) ? 'pending' : reviewFileState(change.status);
        const label = !enabled ? 'Applied' : state === 'pending' ? 'Pending' : state === 'accepted' ? 'Accepted' : state === 'rejected' ? 'Rejected' : 'Partly kept';
        return <div key={change.id} id={`ingot-review-file-${index}`} data-path={change.path} className={`ingot-review-file ${enabled ? state : 'applied'}`}
            role='button' tabIndex={0} title={change.path}
            onClick={() => { this.touchReview(session); void this.tracker.reveal(change.id); }}>
            <span className={fileIconClass(name)} />
            <span className='ingot-review-file-name'>{name}</span>
            <span className='ingot-review-file-dir'>{change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : ''}</span>
            <span className='ingot-flex' />
            <span className='ingot-review-file-stats'><span className='ingot-plus'>+{stats.added}</span> <span className='ingot-minus'>−{stats.removed}</span></span>
            <span className={`ingot-review-file-state ${enabled ? state : 'applied'}`}>{label}</span>
            {enabled && state === 'pending' && <>
                <button type='button' className='ingot-btn-ghost ingot-review-file-reject' title='Reject this file'
                    onClick={e => { e.stopPropagation(); this.touchReview(session); void this.tracker.decide(change.id, 'all', 'rejected'); }}><span className='codicon codicon-close' /></button>
                <button type='button' className='ingot-btn-ghost ingot-review-file-accept' title='Accept this file'
                    onClick={e => { e.stopPropagation(); this.touchReview(session); void this.tracker.decide(change.id, 'all', 'accepted'); }}><span className='codicon codicon-check' /></button>
            </>}
        </div>;
    }

    /** IDEA-132: processes started by the agent or the user, live, above the composer. */
    protected renderProcesses(): React.ReactNode {
        if (this.preferences.get<boolean>(RUN_PREFS.showProcesses, true) === false) {
            return undefined;
        }
        return <ProcessesPanel processes={this.processes.processes} pinned={this.processes.pinned}
            onStop={id => void this.processes.service.stop(id)}
            onRun={() => void this.commands.executeCommand(PROCESS_COMMANDS.run.id)}
            onClear={() => void this.processes.service.clearFinished()}
            onOpenPort={port => void this.commands.executeCommand(BROWSER_COMMANDS.open.id, `http://localhost:${port}`)}
            readOutput={id => this.processes.service.output(id)} />;
    }

    protected renderComposer(): React.ReactNode {
        const items = this.slashItems;
        return <div className='ingot-composer'>
            <div className='ingot-composer-resize' id='ingot-composer-resize' title='Drag to resize · double-click to reset' onMouseDown={e => this.startResize(e)} onDoubleClick={() => this.resetHeight()} />
            {this.renderSummarize()}
            {items.length > 0 && <div id='ingot-slash-menu' className='ingot-slash-menu' role='listbox'>
                {items.map((item, i) => (
                    <div key={item.name} id={`ingot-slash-item-${item.name}`} role='option' aria-selected={i === this.slashIndex}
                        className={`ingot-slash-item${i === this.slashIndex ? ' selected' : ''}`} onMouseDown={e => { e.preventDefault(); this.acceptSlash(item.name); }}>
                        <code>/{item.name}</code><span className='ingot-badge'>{item.kind}</span><span className='ingot-slash-desc'>{item.description}</span>
                    </div>
                ))}
            </div>}
            <div id={COMPOSER_INPUT_ID} ref={el => this.setComposer(el)} className='ingot-composer-input' data-placeholder={COMPOSER_PLACEHOLDER}
                aria-label='Message' suppressContentEditableWarning
                onPaste={e => this.onPaste(e)}
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
                    if (this.store.current?.approval && (e.key === 'Enter' && !e.shiftKey || e.key === 'Escape')) {
                        e.preventDefault();
                        this.decideFromComposer(e.key === 'Enter' && this.composerEmpty ? 'run' : 'skip');
                        return;
                    }
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submit(); }
                    if (e.key === 'Escape' && this.store.current && this.store.isRunning(this.store.current.id)) { e.preventDefault(); this.store.stop(this.store.current.id); }
                }} />
            <div className='ingot-composer-bar'>
                <label className='ingot-icon-button codicon codicon-attach ingot-composer-attach' id='ingot-composer-attach' title='Attach images (or paste / drop them)' aria-label='Attach images' tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.querySelector('input')?.click(); } }}>
                    <input type='file' accept='image/png,image/jpeg,image/gif,image/webp' multiple hidden onChange={e => this.attachImages(e.currentTarget)} />
                </label>
                {this.flags.enabled(IDE_FLAGS.micDictation) && this.renderMic()}
                <span className='ingot-composer-divider' aria-hidden='true' />
                {this.renderModePill()}
                {this.renderModelPill()}
                {this.renderReviewToggle()}
                <span className='ingot-flex' />
                {this.renderUsageRing()}
                {this.store.isRunning(this.store.current?.id)
                    ? <button type='button' id='ingot-composer-stop' className='ingot-composer-send ingot-composer-stop' aria-label='Stop' title='Stop (Esc)' onClick={() => this.store.stop(this.store.current!.id)}><span className='codicon codicon-debug-stop' /></button>
                    : <button type='button' id='ingot-composer-send' className='ingot-composer-send' aria-label='Send' title={this.composerEmpty ? 'Type a message to send' : 'Send (Enter)'} disabled={this.composerEmpty} onClick={() => this.submit()}><span className='codicon codicon-arrow-up' /></button>}
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

    /** IDEA-105 quick toggle: agent review on / off (Settings › Agent review has the rest). */
    protected renderReviewToggle(): React.ReactNode {
        const on = this.store.review.enabled;
        return <button type='button' id='ingot-composer-review' className={`ingot-icon-button codicon ${on ? 'codicon-eye' : 'codicon-eye-closed'} ingot-composer-review${on ? ' on' : ''}`}
            aria-pressed={on} title={on ? 'Agent review on: edits wait for Accept / Reject (click to apply edits right away)' : 'Agent review off: edits apply right away (click to review them)'}
            onClick={() => void this.store.setReviewEnabled(!on)} />;
    }

    protected renderModePill(): React.ReactNode {
        const info = modeInfo(this.store.mode);
        const key = this.shortcut(AGENT_COMMANDS.cycleMode.id);
        return <span className='ingot-pill-anchor'>
            <button type='button' id='ingot-composer-mode' className='ingot-pill ingot-mode-pill' data-mode={info.id} aria-haspopup='menu' aria-expanded={this.popover === 'mode'}
                style={{ '--ingot-mode-color': info.color } as React.CSSProperties} title={`Mode: ${info.label}. ${info.description}${key ? ` (${key} to switch)` : ''}`}
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
                aria-expanded={this.popover === 'model'} title={ready ? `Model: ${this.modelLabel(resolved)}` : this.account.signedIn ? 'This model is not ready yet: pick another or add a key' : 'Sign in to use Ingot models'}
                onClick={() => { this.popover = this.popover === 'model' ? undefined : 'model'; this.update(); }}>
                {!ready && <span className='ingot-pill-dot' aria-hidden='true' />}{this.modelLabel(model)}<span className='codicon codicon-chevron-down ingot-pill-caret' />
            </button>
            {this.popover === 'model' && <ModelPicker current={model} models={this.models.catalog}
                autoResolved={resolved !== AUTO_MODEL_ID && model === AUTO_MODEL_ID ? this.modelLabel(resolved) : undefined}
                configured={id => this.models.isModelConfigured(id)} unavailableReason={id => this.models.unavailableReason(id)} favorites={this.favorites}
                onToggleFavorite={id => this.toggleFavorite(id)}
                onPick={id => { this.store.model = id; this.store.changed(); this.closePopover(); }}
                onAddKey={() => { this.closePopover(); this.commands.executeCommand(MODELS_OPEN_COMMAND.id); }}
                onManage={() => { this.closePopover(); this.commands.executeCommand(MODELS_OPEN_COMMAND.id); }}
                onSignIn={this.account.signedIn ? undefined : () => { this.closePopover(); this.account.signIn(false); }}
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
        const current = this.store.current!;
        return <span className='ingot-pill-anchor'>
            <button type='button' id='ingot-context-ring' className={`ingot-context-ring${ratio >= CONTEXT_NEAR_FULL ? ' near-full' : ''}`} data-ratio={ratio.toFixed(3)}
                title={`Context: ${formatTokens(usage.total)} of ${formatTokens(usage.window)} tokens (${Math.round(ratio * 100)}%) · click for details`} aria-label={`Context ${Math.round(ratio * 100)}% used`} aria-haspopup='dialog' aria-expanded={this.popover === 'context'}
                onClick={() => { this.popover = this.popover === 'context' ? undefined : 'context'; this.update(); }}>
                <svg width='18' height='18' viewBox='0 0 18 18'>
                    <circle cx='9' cy='9' r={r} className='ingot-ring-track' />
                    <circle cx='9' cy='9' r={r} className='ingot-ring-value' strokeDasharray={`${c * ratio} ${c}`} transform='rotate(-90 9 9)' />
                </svg>
            </button>
            {this.popover === 'context' && <ContextBreakdown usage={usage} segments={contextSegments(usage, messageWeights(current.messages))}
                busy={this.store.isRunning(current.id) || current.status === 'thinking'} onClose={() => this.closePopover()}
                onCompact={() => { this.closePopover(); this.store.compact(current.id); }}
                onNewWithSummary={() => { this.closePopover(); this.store.summarizeAndContinue(current.id); }} />}
        </span>;
    }

    /** Voice dictation (IDEA-98): live transcript where the Web Speech API works, otherwise record and transcribe. */
    protected renderMic(): React.ReactNode {
        const state = this.dictationState;
        const label = state === 'listening' ? 'Stop dictation' : state === 'transcribing' ? 'Transcribing…' : 'Dictate';
        return <>
            <button type='button' id='ingot-composer-mic' className={`ingot-icon-button ingot-composer-mic codicon ${state === 'transcribing' ? 'codicon-loading codicon-modifier-spin' : 'codicon-mic'}${state === 'listening' ? ' listening' : ''}`}
                data-state={state} title={label} aria-label={label} aria-pressed={state === 'listening'} disabled={state === 'transcribing'}
                onClick={() => this.toggleDictation()} />
            {this.dictationInterim && <span id='ingot-dictation-interim' className='ingot-dictation-interim ingot-dim'>{this.dictationInterim}</span>}
        </>;
    }

    protected toggleDictation(): void {
        this.dictation ??= new Dictation({
            interim: text => { this.dictationInterim = text; this.update(); },
            final: text => {
                const value = text.trim();
                if (value) {
                    this.inline?.insertText(this.inline.empty ? value : ` ${value}`);
                }
            },
            state: state => { this.dictationState = state; if (state === 'idle') { this.dictationInterim = ''; } this.update(); },
            error: message => this.messages.warn(message)
        }, (audio, mime) => this.models.transcribe(audio, mime));
        this.dictation.toggle();
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
