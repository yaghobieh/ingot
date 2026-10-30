import * as React from '@theia/core/shared/react';
import { ImageHoverService } from '../preview/image-hover-service';
import { actionLine, activityLine } from '../../common/agents/agent-actions';
import { isWorkspaceTool, SKIPPED_DIRS } from '../../common/agents/workspace-tools';
import { mentionQuery, rankFiles, SLASH_BUILTINS, SlashBuiltinAction } from '../../common/agents/composer-menus';
import { commandFolder, findRule, ruleMentionItems } from '../../common/project-config/project-config.utils';
import { RULE_MENTION_PREFIX } from '../../common/project-config/project-config.consts';
import type { ProjectRule } from '../../common/project-config/project-config.types';
import { RuleMentionItem } from './rule-mention-item';
import { exploredItems, exploredLine, extractThought } from '../../common/agents/tool-cards';
import { tabRunState } from '../../common/agents/chat-round';
import { REACTION_HEART, REACTION_LIKE } from '../../common/agents/chat-round.consts';
import { ThoughtRow, ToolCardView } from './tool-card';
import { SUBAGENT_PREFS, subagentsView } from '../../common/agents/subagents';
import { SubagentsStrip } from './subagents-strip';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { PRODUCT } from '../../common/product.consts';
import { ACCEPT_ALL, AGENT_TITLE, COMPOSER_PLACEHOLDER, NO_MODEL_MESSAGE, REJECT_ALL, REVIEW_WORD, SIGN_IN_MESSAGE, WORKED_FOR } from '../../common/agents/agents.consts';
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
import { changesSummary, editedFilesLabel, fileBadge, fileWord, formatWorked, stepVerb } from '../../common/agents/agents.utils';
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
import { isSafeRelativePath } from '../../common/groups/channel.utils';
import { composerBarWidthClass } from '../../common/agents/composer-bar';
import { followAfterScroll, latestUserIndex, scrollTopAfterUpdate, userJumpTargets } from '../../common/agents/chat-thread';
type Popover = 'mode' | 'model' | 'history' | 'context' | 'more' | 'jumps' | undefined;
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
    /** IDEA-187: `@` file picker state. */
    protected mention?: { query: string; index: number };
    protected mentionDismissed?: string;
    protected mentionFiles?: { root: string; at: number; files: string[]; loading?: Promise<void> };
    protected mentionRules: readonly ProjectRule[] = [];
    /** Height set by dragging the handle (IDEA-67); persisted. */
    protected manualHeight?: number;
    /** In-place edit of a sent user message. */
    protected editingIndex?: number;
    protected editDraft = '';
    protected chatScroll?: HTMLDivElement | null;
    protected stickToLatest = true;
    /** scrollTop to put back when the reader is not following the latest line. */
    protected savedScroll = 0;
    /** scrollTop at the previous scroll event, so a move up (the reader) is told apart from text growing below. */
    protected lastScrollTop = 0;
    /** Follow flag captured before the next render. */
    protected pendingFollow = true;
    /** Ignores the scroll event caused by restoring or following. */
    protected applyingScroll = false;
    protected chatSize?: ResizeObserver;
    /** The review file list starts open; the summary button collapses it. */
    protected reviewListOpen = true;
    protected showJump = false;

    /** `/` menu entries matching the draft: project commands and skills (IDEA-30), then built-ins (IDEA-187). */
    protected get slashItems(): { name: string; description?: string; kind: string; args?: string; action?: SlashBuiltinAction }[] {
        const match = /^\/([\w-]*)$/.exec(this.draft);
        if (!match || this.slashDismissed) {
            return [];
        }
        const prefix = match[1].toLowerCase();
        const project = this.store.projectCommands
            .filter(c => c.name.startsWith(prefix))
            .map(c => ({ name: c.name, description: c.description, kind: c.kind === 'skill' ? `skill · ${commandFolder(c)}` : commandFolder(c), args: c.args }));
        const taken = new Set(this.store.projectCommands.map(c => c.name));
        const builtins = SLASH_BUILTINS.filter(c => c.name.startsWith(prefix) && !taken.has(c.name))
            .map(c => ({ name: c.name, description: c.description, kind: 'built-in', action: c.action }));
        return [...project, ...builtins];
    }

    protected acceptSlash(item: { name: string; action?: SlashBuiltinAction }): void {
        this.slashIndex = 0;
        if (!item.action) {
            this.inline?.setText(`/${item.name} `);
            this.focusComposer();
            return;
        }
        this.inline?.clear();
        this.runSlashBuiltin(item.action);
    }

    /** Built-in `/` commands run right away (IDEA-187). */
    protected runSlashBuiltin(action: SlashBuiltinAction): void {
        switch (action.kind) {
            case 'mode':
                this.store.mode = action.mode;
                this.store.changed();
                break;
            case 'new':
                this.newChat();
                return;
            case 'compact':
                if (this.store.current) {
                    this.store.compact(this.store.current.id);
                }
                break;
            case 'model':
                this.popover = 'model';
                break;
            case 'history':
                this.popover = 'history';
                break;
            case 'memories':
                this.toggleMemories();
                return;
            case 'prompt':
                this.store.send(action.prompt);
                break;
        }
        this.update();
        this.focusComposer();
    }

    /** `@` picker entries: project files ranked for the query (IDEA-187). */
    protected get mentionItems(): string[] {
        if (!this.mention || this.mentionDismissed === this.mention.query) {
            return [];
        }
        return [...ruleMentionItems(this.mentionRules, this.mention.query), ...rankFiles(this.mentionFiles?.files ?? [], this.mention.query)];
    }

    protected updateMention(): void {
        const query = this.inline ? mentionQuery(this.inline.textBeforeCaret()) : undefined;
        if (query === undefined) {
            this.mention = undefined;
            this.mentionDismissed = undefined;
            return;
        }
        if (this.mention?.query !== query) {
            this.mention = { query, index: 0 };
        }
        this.loadMentionFiles();
    }

    /** Walks the project once (refreshed after 30s), skipping build output and dependencies. */
    protected loadMentionFiles(): void {
        const root = this.workspace.tryGetRoots()[0]?.resource;
        if (!root) {
            return;
        }
        const cached = this.mentionFiles;
        if (cached && cached.root === root.toString() && (cached.loading || Date.now() - cached.at < 30_000)) {
            return;
        }
        const entry: { root: string; at: number; files: string[]; loading?: Promise<void> } = { root: root.toString(), at: Date.now(), files: cached?.root === root.toString() ? cached.files : [] };
        const files: string[] = [];
        const walk = async (dir: URI, depth: number): Promise<void> => {
            if (files.length >= 5000 || depth > 12) {
                return;
            }
            const stat = await this.files.resolve(dir).catch(() => undefined);
            for (const child of stat?.children ?? []) {
                if (child.isDirectory) {
                    if (!SKIPPED_DIRS.has(child.name)) {
                        await walk(child.resource, depth + 1);
                    }
                } else if (files.length < 5000) {
                    files.push(root.relative(child.resource)?.toString() ?? child.name);
                }
            }
        };
        void this.store.mentionRules().then(rules => { this.mentionRules = rules; this.update(); });
        entry.loading = Promise.all([walk(root, 0), this.store.agentIgnore(root)]).then(([, ignore]) => {
            entry.files = files.filter(f => !ignore.agent(f));
            entry.at = Date.now();
            entry.loading = undefined;
            this.update();
        });
        this.mentionFiles = entry;
    }

    protected acceptMention(path: string): void {
        const query = this.mention?.query ?? '';
        this.mention = undefined;
        const rule = path.startsWith(RULE_MENTION_PREFIX) ? findRule(this.mentionRules, path.slice(RULE_MENTION_PREFIX.length)) : undefined;
        if (rule) {
            this.inline?.replaceBeforeCaret(query.length + 1, '');
            this.inline?.insertCode({ path: rule.path, uri: rule.uri ?? '', start: 1, end: lineCount(rule.body), text: rule.body, whole: true, rule: rule.name });
            this.focusComposer();
            return;
        }
        this.inline?.replaceBeforeCaret(query.length + 1, `@${path} `);
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
        this.updateMention();
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
        this.listenForDrops();
        this.toDispose.push(this.store.onDidChange(() => this.holdScroll()));
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
            this.holdScroll();
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
        this.toDispose.push({ dispose: () => this.chatSize?.disconnect() });
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
        this.applyScroll(this.pendingFollow);
        requestAnimationFrame(() => { this.fitComposer(); this.checkTabOverflow(); this.applyScroll(this.pendingFollow); });
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

    /**
     * IDEA-187: files dropped anywhere on the chat panel (messages, header, empty space) go to the
     * composer, not just drops on the input itself. Drops on the input keep their caret position.
     */
    protected listenForDrops(): void {
        const accepts = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).some(t => t === 'Files' || t === 'theia-editor-dnd');
        const onComposer = (e: DragEvent): boolean => !!this.composer && e.target instanceof Node && this.composer.contains(e.target);
        const over = (e: DragEvent): void => {
            if (!accepts(e)) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer!.dropEffect = 'copy';
            this.node.classList.add('ingot-drop-active');
        };
        const leave = (e: DragEvent): void => {
            if (!(e.relatedTarget instanceof Node && this.node.contains(e.relatedTarget))) {
                this.node.classList.remove('ingot-drop-active');
            }
        };
        const drop = (e: DragEvent): void => {
            this.node.classList.remove('ingot-drop-active');
            if (!accepts(e) || onComposer(e)) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            this.inline?.moveCaretToEnd();
            this.onDrop(e.dataTransfer!);
        };
        this.node.addEventListener('dragenter', over);
        this.node.addEventListener('dragover', over);
        this.node.addEventListener('dragleave', leave);
        this.node.addEventListener('drop', drop);
        this.toDispose.push({ dispose: () => {
            this.node.removeEventListener('dragenter', over);
            this.node.removeEventListener('dragover', over);
            this.node.removeEventListener('dragleave', leave);
            this.node.removeEventListener('drop', drop);
        } });
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
        this.stickToLatest = true;
        this.editingIndex = undefined;
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
                : <div className='ingot-agents-chat-wrap'>
                    <div className='ingot-agents-chat' ref={el => this.bindChat(el)}>{current && current.messages.length ? this.renderSession(current)
                        : <div className='ingot-agents-empty-state' id='ingot-agents-empty-state'>
                            <div className='ingot-agents-empty-title'>{PRODUCT.name}</div>
                            <div className='ingot-agents-hint'>Describe a task and an agent will plan, edit and ask you to review.</div>
                        </div>}</div>
                    {current && this.renderJumpBar(current)}
                </div>}
            {!this.showMemories && this.renderProcesses()}
            {!this.showMemories && this.renderSubagents(current)}
            {!this.showMemories && current && this.renderAsk(current)}
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
                    const run = tabRunState(this.store.isRunning(t.id), !!t.ask, t.messages.length > 0, t.status);
                    return <div key={t.id} role='tab' tabIndex={0} aria-selected={active} data-id={t.id} data-run={run} title={label || UNTITLED_TAB_TOOLTIP} draggable={this.renamingTab !== t.id}
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
                        {run === 'running' && <span className={`ingot-agent-status ingot-status-${t.status}`} />}
                        {run === 'running' && <span className='ingot-tab-progress' aria-label='Running' />}
                        {run === 'waiting' && <span className='ingot-tab-wait' title='Waiting for an answer' aria-label='Waiting for an answer' />}
                        {run === 'done' && <span className='ingot-tab-done codicon codicon-check' aria-label='Done' />}
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

    /** IDEA-181: subagent state per chat: which one's details are open, and whether the list is open. */
    protected subagentSelected?: string;
    protected subagentsOpen = new Map<string, boolean>();

    protected subagentsExpanded(session: AgentSession): boolean {
        return this.subagentsOpen.get(session.id) ?? subagentsView(this.preferences.get(SUBAGENT_PREFS.view)) === 'strip';
    }

    protected renderSubagents(session: AgentSession | undefined): React.ReactNode {
        const subagents = this.store.subagents(session?.id);
        if (!session || !subagents.length) {
            return undefined;
        }
        return <SubagentsStrip subagents={subagents} isRunning={id => this.store.isRunning(id)}
            view={subagentsView(this.preferences.get(SUBAGENT_PREFS.view))}
            expanded={this.subagentsExpanded(session)} selected={this.subagentSelected}
            onToggle={() => { this.subagentsOpen.set(session.id, !this.subagentsExpanded(session)); this.update(); }}
            onSelect={id => { this.subagentSelected = id; this.update(); }}
            onOpenTab={id => { this.subagentSelected = undefined; this.store.select(id); }}
            onStop={id => this.store.stop(id)}
            renderMarkdown={text => this.markdown.render(text)} />;
    }

    /** IDEA-181: the one-line reference a subagent leaves in the main chat; View opens it in the Subagents strip. */
    protected renderSubagentRef(session: AgentSession, m: AgentSession['messages'][number], i: number): React.ReactNode {
        const refs = m.refs ?? [];
        const zaprex = m.from === 'Zaprex';
        return <div key={i} className={`ingot-chat-subref${zaprex ? ' zaprex' : ''}`} data-refs={refs.join(' ')}>
            {zaprex ? <span className='ingot-zaprex-link-icon ingot-chat-subref-icon' aria-hidden='true' /> : <span className='codicon codicon-type-hierarchy-sub ingot-chat-subref-icon' />}
            <span className='ingot-chat-subref-text' title={m.text}>{zaprex ? <b>Zaprex </b> : undefined}{m.text}</span>
            <button type='button' className='ingot-chat-subref-view' onClick={() => {
                this.subagentsOpen.set(session.id, true);
                this.subagentSelected = refs.length === 1 ? refs[0] : undefined;
                this.update();
            }}>View</button>
        </div>;
    }

    /** "Explored N files, M searches"; click to see which (IDEA-177 / IDEA-186). */
    protected renderExplored(session: AgentSession, explored: string): React.ReactNode {
        const key = `${session.id}:explored`;
        const open = this.expandedSteps.has(key);
        const items = exploredItems(session.steps);
        return <div className={`ingot-chat-explored${open ? ' open' : ''}`} id='ingot-chat-explored'>
            <button type='button' className='ingot-chat-explored-head' aria-expanded={open} onClick={() => { if (!this.expandedSteps.delete(key)) { this.expandedSteps.add(key); } this.update(); }}>
                <span className='ingot-chat-explored-verb'>{explored.split(' ')[0]}</span> {explored.split(' ').slice(1).join(' ')}
                <span className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} aria-hidden='true' />
            </button>
            {open && <ul className='ingot-chat-explored-list'>
                {items.map((st, i) => <li key={i}><span className={`codicon codicon-${st.kind === 'search' ? 'search' : st.target.endsWith('/') ? 'folder' : 'file'}`} aria-hidden='true' />{st.kind === 'search' ? `"${st.target}"` : st.target}</li>)}
            </ul>}
        </div>;
    }

    protected renderMessage(session: AgentSession, m: AgentSession['messages'][number], i: number): React.ReactNode {
        // IDEA-186: hidden nudges are for the model only; project reads are summed up in the Explored row.
        if (m.hidden || (m.role === 'tool' && m.tool?.server === 'ingot' && isWorkspaceTool(m.tool.tool) && m.tool.state === 'done')) {
            return undefined;
        }
        if (m.refs?.length) {
            return this.renderSubagentRef(session, m, i);
        }
        if (m.role === 'tool' && m.tool) {
            const key = `${session.id}:tool:${i}`;
            return <ToolCardView key={i} info={m.tool} text={m.text} from={m.from} expanded={this.expandedSteps.has(key)}
                onToggle={() => { if (!this.expandedSteps.delete(key)) { this.expandedSteps.add(key); } this.update(); }}
                openLink={url => this.windows.openNewWindow(url, { external: true })} />;
        }
        const thought = m.role === 'agent' && !m.parts ? extractThought(m.text) : undefined;
        if (thought?.thought !== undefined) {
            const key = `${session.id}:thought:${i}`;
            const thinking = thought.thinking && this.store.isRunning(session.id);
            const body = { ...m, text: thought.rest };
            return <React.Fragment key={i}>
                <ThoughtRow id={`ingot-thought-${i}`} thought={thought.thought} thinking={thinking} durationMs={m.thoughtMs} expanded={this.expandedSteps.has(key)}
                    onToggle={() => { if (!this.expandedSteps.delete(key)) { this.expandedSteps.add(key); } this.update(); }} />
                {this.renderMessageBody(session, body, i)}
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
                <div key={i} id={`ingot-msg-${i}`} className={`ingot-chat-msg ingot-chat-${m.role}${m.role === 'user' && i === latestUserIndex(session.messages) ? ' ingot-chat-latest' : ''}${m.role === 'user' && this.account.account ? ' ingot-chat-has-avatar' : ''}`}
                    onClick={event => this.onLatestClick(session, i, event)}>
                    {m.role === 'user' && this.account.account && <AccountAvatar account={this.account.account} src={this.account.avatarSrc} className='ingot-chat-user-avatar' textless />}
                    {m.from && <div className='ingot-chat-from'>{m.from}</div>}
                    {m.parts ? this.renderParts(m.parts, m.images) : m.chips && m.chips.length > 0 && <div className='ingot-chat-chips'>{m.chips.map((c, j) => <span key={j} className={`ingot-chip ingot-chip-sent ingot-chip-${c.kind ?? 'code'}`} title={c.kind === 'memory' ? 'Memory' : c.kind === 'rule' ? `Rule ${c.path}` : c.path}>
                        {c.kind === 'memory' && <span className='codicon codicon-lightbulb' />}{c.kind === 'rule' && <span className='codicon codicon-law' />}{c.label}</span>)}</div>}
                    {m.role === 'agent' && <div className='ingot-chat-agent-head'><span className='ingot-agent-mark' aria-hidden='true'>In</span><b>{AGENT_TITLE}</b><span className='ingot-dim'>· {WORKED_FOR} {this.workedFor(session)}</span></div>}
                    {m.role === 'agent' && i === session.messages.map(message => message.role).lastIndexOf('agent') && this.renderChecklist(session)}
                    {m.parts ? '' : m.role === 'agent'
                        ? (m.text ? <div className='ingot-md' onClick={e => this.onMarkdownClick(e)} onMouseOver={e => this.onMarkdownHover(e)} onMouseOut={() => this.imageHovers.hide()} dangerouslySetInnerHTML={{ __html: this.markdown.render(m.text) }} />
                            : this.store.isRunning(session.id) ? <span className='ingot-chat-typing'>…</span> : '')
                        : this.editingIndex === i ? this.renderEditForm(session, i) : m.text}
                    {m.role === 'tool' && !!m.images?.length && <div className='ingot-chat-tool-images'>{m.images.filter(img => img.data).map(img =>
                        <img key={img.id} className='ingot-chat-tool-image' src={`data:${img.mediaType};base64,${img.data}`} alt={img.name}
                            onClick={() => { this.lightbox = img; this.update(); }} />)}</div>}
                    {m.role === 'agent' && i === session.messages.length - 1 && session.status === 'editing' && session.activeFile && !this.tracker.forMessage(session.id, i).length && <div className='ingot-chat-editing'>Editing {session.activeFile}…</div>}
                    {m.role === 'agent' && this.tracker.forMessage(session.id, i).map(change => <CodeChangeBlock key={change.id} change={change}
                        expanded={!this.collapsedChanges.has(change.id)}
                        onToggle={() => { if (!this.collapsedChanges.delete(change.id)) { this.collapsedChanges.add(change.id); } this.update(); }}
                        onOpen={hunkId => this.tracker.reveal(change.id, hunkId)}
                        onDecide={(hunks, state) => this.tracker.decide(change.id, hunks, state)} />)}
                    {(m.role === 'user' || m.role === 'agent') && this.editingIndex !== i && <span className='ingot-reactions'>
                        <button type='button' id={`ingot-react-like-${i}`} className={`ingot-react${m.reactions?.includes(REACTION_LIKE) ? ' on' : ''}`}
                            aria-pressed={!!m.reactions?.includes(REACTION_LIKE)} aria-label='Like' title='Like'
                            onClick={() => this.store.toggleReaction(session.id, i, REACTION_LIKE)}><span className='codicon codicon-thumbsup' /></button>
                        <button type='button' id={`ingot-react-heart-${i}`} className={`ingot-react${m.reactions?.includes(REACTION_HEART) ? ' on' : ''}`}
                            aria-pressed={!!m.reactions?.includes(REACTION_HEART)} aria-label='Heart' title='Heart'
                            onClick={() => this.store.toggleReaction(session.id, i, REACTION_HEART)}><span className='codicon codicon-heart' /></button>
                    </span>}
                    {m.role === 'user' && this.editingIndex !== i && <button type='button' className='ingot-chat-edit' id={`ingot-edit-msg-${i}`}
                        title='Edit this message and run again from here' onClick={() => this.startEdit(session, i)}>Edit</button>}
                    {(m.role === 'user' || m.role === 'agent') && this.store.canRevertTo(session.id, i) && <button type='button' className='ingot-chat-revert' id={`ingot-revert-${i}`}
                        title={m.role === 'user' ? 'Restore files to before this message and drop the replies after it' : 'Restore files to right after this reply and drop what came later'}
                        onClick={() => this.store.revertTo(session.id, i)}><span className='codicon codicon-discard' /> Revert to here</button>}
                    {m.buildable && session.mode === 'plan' && <div><button type='button' id='ingot-plan-build' className='ingot-btn-primary ingot-chat-action'
                        onClick={() => this.store.build(session.id)}><span className='codicon codicon-play' /> Build</button></div>}
                    {m.text === SIGN_IN_MESSAGE && <div className='ingot-chat-sign-in'>
                        <button type='button' id='ingot-chat-sign-in' className='ingot-btn-primary ingot-chat-action' onClick={() => this.account.signIn(false)}>{SIGN_IN_FOR_MODELS}</button>
                        {this.account.devSignInAvailable && <button type='button' id='ingot-chat-sign-in-dev' className='ingot-btn-secondary ingot-chat-action' onClick={() => this.account.signIn(true)}>Dev: test@ingot.dev</button>}
                    </div>}
                    {m.text === NO_MODEL_MESSAGE && <div><button type='button' id='ingot-open-models' className='ingot-btn-primary ingot-chat-action' onClick={() => this.commands.executeCommand(MODELS_OPEN_COMMAND.id)}>Choose a model</button></div>}
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
                <span className='ingot-chat-read-items'>{items.map((item, j) => <code key={j} onClick={e => { e.stopPropagation(); this.openWorkspacePath(item); }}>{item}</code>)}</span>
                <span className='ingot-flex' />
                <span className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} />
            </button>
            {open && <ul className='ingot-chat-read-list'>{items.map((item, j) => <li key={j}><span className={`codicon codicon-${rules ? 'law' : 'file'}`} /><button type='button' className='ingot-chat-read-open' onClick={() => this.openWorkspacePath(item)}>{item}</button></li>)}</ul>}
        </div>;
    }

    /** How long this chat has been working, shown beside the agent name. */
    protected workedFor(session: AgentSession): string {
        const start = session.openedAt ?? session.updatedAt;
        const end = this.store.isRunning(session.id) ? Date.now() : session.updatedAt;
        return formatWorked(end - start);
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
            } else {
                this.openWorkspacePath(href);
            }
            return;
        }
        const code = target.closest('code');
        if (code && !code.closest('pre')) {
            this.openWorkspacePath(code.textContent ?? '');
        }
    }

    /** Open a path from the reply in the folder that is actually open. */
    protected openWorkspacePath(path: string): void {
        const clean = path.trim().replace(/^["'`]|["'`]$/g, '');
        if (!isSafeRelativePath(clean) || clean === '.' || clean.endsWith('/') || !clean.includes('.')) {
            return;
        }
        const current = this.store.current;
        const root = current?.project ? new URI(current.project) : this.workspace.tryGetRoots()[0]?.resource;
        if (!root) {
            return;
        }
        void this.editors.open(root.resolve(clean), { mode: 'activate' });
    }

    protected renderSession(session: AgentSession): React.ReactNode {
        const lastAgent = session.messages.map(m => m.role).lastIndexOf('agent');
        const readSteps = session.steps.map((step, index) => ({ step, index })).filter(({ step }) => step.kind === 'read');
        // IDEA-177: tool steps are drawn as cards; the muted "Explored N files, M searches" line sums up the run.
        const hasCards = session.messages.some(m => m.tool);
        const explored = hasCards ? exploredLine(session.steps, this.store.isRunning(session.id)) : undefined;
        return <>
            {session.messages.map((m, i) => i === lastAgent && readSteps.length > 0 && !hasCards
                ? <React.Fragment key={i}>{readSteps.map(({ step, index }) => this.renderReadStep(session, step, index))}{this.renderMessage(session, m, i)}</React.Fragment>
                : this.renderMessage(session, m, i))}
            {lastAgent < 0 && !hasCards && readSteps.map(({ step, index }) => this.renderReadStep(session, step, index))}
            {explored && this.renderExplored(session, explored)}
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

    protected renderAsk(session: AgentSession): React.ReactNode {
        const ask = session.ask;
        if (!ask) {
            return undefined;
        }
        return <form id='ingot-ask' className='ingot-ask' onSubmit={event => {
            event.preventDefault();
            const input = event.currentTarget.querySelector('input');
            const text = input instanceof HTMLInputElement ? input.value : '';
            this.store.answerQuestion(session.id, text);
        }}>
            <p id='ingot-ask-question'>{ask.question}</p>
            {!!ask.options?.length && <span className='ingot-ask-options'>
                {ask.options.map(option => <button type='button' key={option} className='ingot-ask-option' onClick={() => this.store.answerQuestion(session.id, option)}>{option}</button>)}
            </span>}
            <input id='ingot-ask-input' className='ingot-input' aria-label='Your answer' placeholder='Or type an answer' />
            <button type='submit' id='ingot-ask-submit' className='ingot-btn-primary'>Send</button>
        </form>;
    }

    /** Green checks under the agent name. File edits stay in the edited-files card, not here. */
    protected renderChecklist(session: AgentSession): React.ReactNode {
        const work = session.steps.filter(step => step.kind !== 'edit' && step.kind !== 'read');
        if (!session.plan.length && !work.length) {
            return undefined;
        }
        return <div id='ingot-checklist' className='ingot-chat-plan ingot-checklist'>
            {session.plan.map((item, index) => <div key={`plan-${index}`} className={`ingot-plan-item ingot-check-row ingot-plan-${item.state}`}>
                <span className='ingot-plan-mark'>{item.state === 'done' ? '✓' : item.state === 'active' ? '●' : '○'}</span>
                <span className='ingot-step-text'>{item.text}</span>
            </div>)}
            {work.map((step, index) => <div key={`step-${index}`} className={`ingot-check-row${step.done ? ' done' : ''}`}>
                <span className='ingot-step-mark'>{step.done ? '✓' : '●'}</span>
                <span className='ingot-step-text'>{stepVerb(step)} {step.target}</span>
            </div>)}
        </div>;
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
        const counted = pending.length ? pending : run;
        const stats = counted.map(c => changeStats(c.hunks)).reduce((a, b) => ({ added: a.added + b.added, removed: a.removed + b.removed }), { added: 0, removed: 0 });
        const first = run.find(change => change.status !== 'streaming');
        return <div className='ingot-review' id='ingot-review'>
            <div className='ingot-review-card'>
                {paused && session.pause && this.renderPause(session, session.pause)}
                <button type='button' id='ingot-changes-summary' className='ingot-edited-head' aria-expanded={this.reviewListOpen}
                    onClick={() => { this.reviewListOpen = !this.reviewListOpen; this.update(); }}>
                    <span className={`codicon codicon-chevron-${this.reviewListOpen ? 'down' : 'right'}`} />
                    <span>{editedFilesLabel(run.length)}{review.enabled ? '' : ' · review off'}</span>
                    <span className='ingot-edited-total'><span className='ingot-plus'>+{stats.added}</span> <span className='ingot-minus'>−{stats.removed}</span></span>
                </button>
                {this.reviewListOpen && <div className={`ingot-review-files${review.enabled ? '' : ' info'}`} id='ingot-review-files'>
                    {run.map((change, i) => this.renderReviewFile(session, change, i, review.enabled))}
                </div>}
                {pending.length > 0 && review.enabled && <div className='ingot-review-footer' id='ingot-changes-bar'>
                    <span className='ingot-review-totals'>{pending.length} {fileWord(pending.length)} · <span className='ingot-plus'>+{stats.added}</span> <span className='ingot-minus'>−{stats.removed}</span></span>
                    <span className='ingot-flex' />
                    <button type='button' id='ingot-changes-reject-all' className='ingot-review-link' onClick={() => { this.touchReview(session); void this.tracker.decideAll('rejected', session.id); }}>{REJECT_ALL}</button>
                    <button type='button' id='ingot-review-open' className='ingot-review-link' onClick={() => { if (first) { this.touchReview(session); void this.tracker.reveal(first.id); } }}>{REVIEW_WORD}</button>
                    <button type='button' id='ingot-changes-accept-all' className='ingot-btn-primary ingot-review-accept' onClick={() => { this.touchReview(session); void this.tracker.decideAll('accepted', session.id); }}>{ACCEPT_ALL}</button>
                </div>}
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
            <span className='ingot-review-pause-text'>{pause.applied} of {pause.total} files applied. Pause for review?</span>
            {left !== undefined && <span className='ingot-review-countdown' id='ingot-review-countdown'>Continuing in {formatCountdown(left)}</span>}
            <span className='ingot-flex' />
            <button type='button' id='ingot-review-stop' className='ingot-review-link' onClick={() => this.store.stop(session.id)}>Stop</button>
            {left !== undefined && <button type='button' id='ingot-review-wait' className='ingot-review-link' onClick={() => this.store.holdPause(session.id)}>Pause</button>}
            <button type='button' id='ingot-review-continue' className='ingot-review-link accept' onClick={() => this.store.continueRun(session.id)}>Continue now</button>
        </div>;
    }

    protected renderReviewFile(session: AgentSession, change: CodeChange, index: number, enabled: boolean): React.ReactNode {
        const name = change.path.split('/').pop() ?? change.path;
        const badge = fileBadge(name);
        const folder = change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : '';
        const stats = this.tracker.stats(change);
        const state = isPending(change) ? 'pending' : reviewFileState(change.status);
        const label = !enabled ? 'Applied' : state === 'pending' ? 'Pending' : state === 'accepted' ? 'Accepted' : state === 'rejected' ? 'Rejected' : 'Partly kept';
        return <div key={change.id} id={`ingot-review-file-${index}`} data-path={change.path} className={`ingot-review-file ${enabled ? state : 'applied'}`}
            role='button' tabIndex={0} title={change.path}
            onClick={() => { this.touchReview(session); void this.tracker.reveal(change.id, undefined, true); }}>
            <span className={`ingot-file-badge ingot-file-badge-${badge.tone}`} aria-hidden='true'>{badge.label}</span>
            <span className='ingot-review-file-name'>{name}</span>
            <span className='ingot-review-file-dir'>{folder}</span>
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
        const info = modeInfo(this.store.mode);
        return <div className='ingot-composer-stack'>
            <div className='ingot-composer'>
            <div className='ingot-composer-resize' id='ingot-composer-resize' title='Drag to resize · double-click to reset' onMouseDown={e => this.startResize(e)} onDoubleClick={() => this.resetHeight()} />
            {this.renderSummarize()}
            {items.length > 0 && <div id='ingot-slash-menu' className='ingot-slash-menu' role='listbox'>
                {items.map((item, i) => (
                    <div key={`${item.kind}:${item.name}`} id={item.action ? `ingot-slash-builtin-${item.name}` : `ingot-slash-item-${item.name}`} role='option' aria-selected={i === this.slashIndex}
                        className={`ingot-slash-item${i === this.slashIndex ? ' selected' : ''}`} onMouseDown={e => { e.preventDefault(); this.acceptSlash(item); }}>
                        <code>/{item.name}</code>{item.args && <span className='ingot-slash-args'>{item.args}</span>}<span className='ingot-badge' title={item.kind}>{item.kind}</span><span className='ingot-slash-desc'>{item.description}</span>
                    </div>
                ))}
            </div>}
            {this.renderMentionMenu()}
            <div id={COMPOSER_INPUT_ID} ref={el => this.setComposer(el)} className='ingot-composer-input' data-placeholder={COMPOSER_PLACEHOLDER}
                aria-label='Message' suppressContentEditableWarning
                onPaste={e => this.onPaste(e)}
                onKeyUp={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') { this.updateMention(); this.update(); } }}
                onClick={() => { this.updateMention(); this.update(); }}
                onKeyDown={e => {
                    // A fully typed path needs no picker: Enter sends as usual.
                    const mentions = this.mention && this.mentionItems.includes(this.mention.query) && e.key === 'Enter' ? [] : this.mentionItems;
                    if (mentions.length && this.mention) {
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                            e.preventDefault();
                            this.mention.index = (this.mention.index + (e.key === 'ArrowDown' ? 1 : mentions.length - 1)) % mentions.length;
                            this.update();
                            return;
                        }
                        if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault();
                            this.acceptMention(mentions[Math.min(this.mention.index, mentions.length - 1)]);
                            return;
                        }
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            this.mentionDismissed = this.mention.query;
                            this.update();
                            return;
                        }
                    }
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
                            this.acceptSlash(items[Math.min(this.slashIndex, items.length - 1)]);
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
            <div className='ingot-composer-bar' ref={el => this.observeBar(el)}>
                <label className='ingot-icon-button codicon codicon-attach ingot-composer-attach' id='ingot-composer-attach' title='Attach images (or paste / drop them)' aria-label='Attach images' tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.querySelector('input')?.click(); } }}>
                    <input type='file' accept='image/png,image/jpeg,image/gif,image/webp' multiple hidden onChange={e => this.attachImages(e.currentTarget)} />
                </label>
                {this.renderModelPill()}
                <button type='button' id='ingot-composer-more' className={`ingot-icon-button codicon codicon-ellipsis${this.popover === 'more' ? ' active' : ''}`}
                    data-mode={info.id} aria-label='More' aria-haspopup='menu' aria-expanded={this.popover === 'more'}
                    title={`More · Mode: ${info.label}`}
                    onClick={() => { this.popover = this.popover === 'more' ? undefined : 'more'; this.update(); }} />
                <span className='ingot-flex' />
                {this.store.isRunning(this.store.current?.id) && <button type='button' id='ingot-composer-stop' className='ingot-composer-send ingot-composer-stop' aria-label='Stop' title='Stop (Esc)' onClick={() => this.store.stop(this.store.current!.id)}><span className='codicon codicon-debug-stop' /></button>}
                {(!this.store.isRunning(this.store.current?.id) || !this.composerEmpty) && <button type='button' id='ingot-composer-send' className='ingot-composer-send' aria-label='Send' title={this.composerEmpty ? 'Type a message to send' : this.store.isRunning(this.store.current?.id) ? 'Send to the running agent' : 'Send (Enter)'} disabled={this.composerEmpty} onClick={() => this.submit()}><span className='codicon codicon-arrow-up' /></button>}
            </div>
            </div>
            {this.renderComposerPopovers(info)}
        </div>;
    }

    protected renderComposerPopovers(info: ReturnType<typeof modeInfo>): React.ReactNode {
        const key = this.shortcut(AGENT_COMMANDS.cycleMode.id);
        const usage = this.store.current?.context?.usage;
        const current = this.store.current;
        return <div className='ingot-composer-menus'>
            {this.popover === 'more' && <div id='ingot-composer-more-menu' className='ingot-popover ingot-composer-more-menu' role='menu'>
                <button type='button' id='ingot-composer-mode' className='ingot-more-item' role='menuitem' data-mode={info.id} aria-haspopup='menu'
                    title={`Mode: ${info.label}. ${info.description}${key ? ` (${key} to switch)` : ''}`}
                    onClick={() => { this.popover = 'mode'; this.update(); }}>
                    <span className={`codicon codicon-${info.icon}`} style={{ color: info.color }} /><span className='ingot-pill-label'>{info.label}</span>
                </button>
                {this.renderReviewToggle()}
                {usage && usageRatio(usage) > 0 && this.renderUsageRing()}
                {this.flags.enabled(IDE_FLAGS.micDictation) && this.renderMic()}
            </div>}
            {this.popover === 'mode' && <ModeMenu mode={info.id} shortcut={key} onClose={() => this.closePopover()}
                onPick={mode => { this.store.mode = mode; this.store.changed(); this.closePopover(); }} />}
            {this.popover === 'context' && usage && current && <ContextBreakdown usage={usage} segments={contextSegments(usage, messageWeights(current.messages))}
                busy={this.store.isRunning(current.id) || current.status === 'thinking'} onClose={() => this.closePopover()}
                onCompact={() => { this.closePopover(); this.store.compact(current.id); }}
                onNewWithSummary={() => { this.closePopover(); this.store.summarizeAndContinue(current.id); }} />}
        </div>;
    }

    protected renderReviewToggle(): React.ReactNode {
        const on = this.store.review.enabled;
        return <button type='button' id='ingot-composer-review' className={`ingot-more-item ingot-composer-review${on ? ' on' : ''}`} role='menuitem'
            aria-pressed={on} aria-label={on ? 'Agent review on' : 'Agent review off'}
            title={on ? 'Agent review on: edits wait for Accept. Click to apply edits right away' : 'Agent review off: edits apply right away. Click to review them'}
            onClick={() => void this.store.setReviewEnabled(!on)}>
            <span className='codicon codicon-checklist' aria-hidden='true' />
            <span>{on ? 'Review on' : 'Review off'}</span>
        </button>;
    }

    /** Remember the reading position, then render. Follow only if the reader was already at the bottom. */
    protected holdScroll(): void {
        const thread = this.chatScroll;
        if (thread && !this.applyingScroll) {
            this.savedScroll = thread.scrollTop;
        }
        this.pendingFollow = this.stickToLatest;
        this.update();
    }

    protected applyScroll(follow: boolean): void {
        const node = this.chatScroll;
        if (!node) {
            return;
        }
        // The scroll event lands a frame late; a move up made before this render must still cancel follow.
        if (node.scrollTop < this.lastScrollTop) {
            this.onChatScroll();
        }
        const next = scrollTopAfterUpdate(this.savedScroll, node.scrollHeight, node.clientHeight, follow && this.stickToLatest);
        if (node.scrollTop === next) {
            return;
        }
        this.applyingScroll = true;
        node.scrollTop = next;
        this.lastScrollTop = node.scrollTop;
        this.applyingScroll = false;
    }

    protected bindChat(el: HTMLDivElement | null): void {
        if (this.chatScroll === el) {
            return;
        }
        this.chatScroll?.removeEventListener('scroll', this.onChatScrollBound);
        this.chatSize?.disconnect();
        this.chatSize = undefined;
        this.chatScroll = el;
        if (!el) {
            return;
        }
        this.lastScrollTop = el.scrollTop;
        // The run card and the files panel sit under the thread and change its height. Put the same place back.
        this.chatSize = new ResizeObserver(() => this.applyScroll(this.stickToLatest));
        this.chatSize.observe(el);
        // Native listener: a scroll from the reader cancels follow before the next frame paints.
        el.addEventListener('scroll', this.onChatScrollBound, { passive: true });
    }

    protected readonly onChatScrollBound = (): void => this.onChatScroll();

    protected onChatScroll(): void {
        const thread = this.chatScroll;
        if (!thread || this.applyingScroll) {
            return;
        }
        this.savedScroll = thread.scrollTop;
        const { stick, showJump: show } = followAfterScroll({
            previousTop: this.lastScrollTop, top: thread.scrollTop, scrollHeight: thread.scrollHeight, clientHeight: thread.clientHeight
        }, this.stickToLatest);
        this.lastScrollTop = thread.scrollTop;
        this.stickToLatest = stick;
        this.pendingFollow = this.stickToLatest;
        if (show !== this.showJump) {
            this.showJump = show;
            this.update();
        }
    }

    protected renderJumpBar(session: AgentSession): React.ReactNode {
        const targets = userJumpTargets(session.messages);
        if (!this.showJump && targets.length < 2) {
            return undefined;
        }
        return <div className='ingot-jump-bar' id='ingot-jump-bar'>
            {targets.length > 1 && <button type='button' id='ingot-jump-earlier' className='ingot-jump-btn' aria-expanded={this.popover === 'jumps'}
                onClick={() => { this.popover = this.popover === 'jumps' ? undefined : 'jumps'; this.update(); }}>Earlier</button>}
            {this.showJump && <button type='button' id='ingot-jump-latest' className='ingot-jump-btn' onClick={() => this.jumpToLatest()}>Jump to latest</button>}
            {this.popover === 'jumps' && <div id='ingot-jump-menu' className='ingot-popover ingot-jump-menu' role='menu'>
                {targets.map(target => <button type='button' key={target.index} id={`ingot-jump-${target.index}`} className='ingot-jump-item' role='menuitem'
                    onClick={() => this.jumpToMessage(target.index)}>{target.label}</button>)}
            </div>}
        </div>;
    }

    protected jumpToLatest(): void {
        const thread = this.chatScroll;
        this.stickToLatest = true;
        this.pendingFollow = true;
        this.showJump = false;
        this.popover = this.popover === 'jumps' ? undefined : this.popover;
        if (thread) {
            this.applyingScroll = true;
            thread.scrollTop = thread.scrollHeight;
            this.savedScroll = thread.scrollTop;
            this.lastScrollTop = thread.scrollTop;
            this.applyingScroll = false;
        }
        this.update();
    }

    /** The pinned prompt scrolls back to its place in the thread. Buttons inside it keep their own actions. */
    protected onLatestClick(session: AgentSession, index: number, event: React.MouseEvent): void {
        if (index !== latestUserIndex(session.messages) || this.editingIndex === index) {
            return;
        }
        const target = event.target;
        if (target instanceof Element && target.closest('button, input, textarea, a')) {
            return;
        }
        this.revealMessage(index);
    }

    /** Scrolls a message to the top of the thread using its in-flow position, not the sticky offset. */
    protected revealMessage(index: number): void {
        this.stickToLatest = false;
        this.pendingFollow = false;
        const thread = this.chatScroll;
        const node = this.node.querySelector(`#ingot-msg-${index}`);
        if (thread && node instanceof HTMLElement) {
            const previous = node.style.position;
            node.style.position = 'static';
            const top = node.getBoundingClientRect().top - thread.getBoundingClientRect().top + thread.scrollTop;
            node.style.position = previous;
            thread.scrollTop = top;
        }
        this.onChatScroll();
        this.update();
    }

    protected jumpToMessage(index: number): void {
        this.stickToLatest = false;
        this.pendingFollow = false;
        this.popover = undefined;
        this.update();
        requestAnimationFrame(() => {
            this.node.querySelector(`#ingot-msg-${index}`)?.scrollIntoView({ block: 'start' });
            if (this.chatScroll) {
                this.savedScroll = this.chatScroll.scrollTop;
            }
            this.onChatScroll();
        });
    }

    protected startEdit(session: AgentSession, index: number): void {
        this.editingIndex = index;
        this.editDraft = session.messages[index]?.text ?? '';
        this.update();
    }

    protected renderEditForm(session: AgentSession, index: number): React.ReactNode {
        return <form id='ingot-chat-edit' className='ingot-chat-edit-form' data-index={index} onSubmit={event => { event.preventDefault(); this.submitEdit(session); }}>
            <textarea id='ingot-chat-edit-input' className='ingot-chat-edit-input' value={this.editDraft} aria-label='Edit message'
                onChange={event => { this.editDraft = event.target.value; this.update(); }} />
            <span className='ingot-chat-edit-actions'>
                <button type='button' id='ingot-chat-edit-cancel' className='ingot-btn-ghost' onClick={() => { this.editingIndex = undefined; this.update(); }}>Cancel</button>
                <button type='submit' id='ingot-chat-edit-submit' className='ingot-btn-primary' disabled={!this.editDraft.trim()}>Send</button>
            </span>
        </form>;
    }

    protected submitEdit(session: AgentSession): void {
        const index = this.editingIndex;
        const text = this.editDraft;
        this.editingIndex = undefined;
        this.stickToLatest = true;
        this.update();
        if (index !== undefined) {
            void this.store.editUserMessage(session.id, index, text);
        }
    }

    protected renderMentionMenu(): React.ReactNode {
        if (!this.mention || this.mentionDismissed === this.mention.query) {
            return undefined;
        }
        const items = this.mentionItems;
        const loading = !!this.mentionFiles?.loading && !items.length;
        return <div id='ingot-mention-menu' className='ingot-slash-menu ingot-mention-menu' role='listbox' aria-label='Mention a file'>
            {items.map((path, i) => {
                const slash = path.lastIndexOf('/');
                const rule = path.startsWith(RULE_MENTION_PREFIX) ? findRule(this.mentionRules, path.slice(RULE_MENTION_PREFIX.length)) : undefined;
                if (rule) {
                    return <RuleMentionItem key={path} rule={rule} selected={i === this.mention!.index} onPick={() => this.acceptMention(path)} />;
                }
                return <div key={path} data-path={path} role='option' aria-selected={i === this.mention!.index}
                    className={`ingot-slash-item ingot-mention-item${i === this.mention!.index ? ' selected' : ''}`}
                    onMouseDown={e => { e.preventDefault(); this.acceptMention(path); }}>
                    <span className='codicon codicon-file' aria-hidden='true' />
                    <span className='ingot-mention-name'>{path.slice(slash + 1)}</span>
                    {slash > 0 && <span className='ingot-slash-desc'>{path.slice(0, slash)}</span>}
                </div>;
            })}
            {!items.length && <div className='ingot-mention-empty'>{loading ? 'Loading files…' : 'No matching files'}</div>}
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

    protected barObserver?: ResizeObserver;
    protected observedBar?: HTMLElement;

    /** IDEA-188: tags the composer bar with its width class so the toolbar collapses instead of clipping. */
    protected observeBar(el: HTMLElement | null): void {
        if (!el || el === this.observedBar) {
            return;
        }
        if (!this.barObserver) {
            this.barObserver = new ResizeObserver(entries => {
                for (const entry of entries) {
                    const target = entry.target as HTMLElement;
                    const width = composerBarWidthClass(entry.contentRect.width);
                    if (target.dataset.width !== width) {
                        target.dataset.width = width;
                    }
                }
            });
            this.toDispose.push({ dispose: () => this.barObserver?.disconnect() });
        }
        if (this.observedBar) {
            this.barObserver.unobserve(this.observedBar);
        }
        this.observedBar = el;
        this.barObserver.observe(el);
    }

    protected renderModelPill(): React.ReactNode {
        const model = this.store.model;
        const resolved = this.store.resolveModel(model);
        const ready = this.models.isModelConfigured(resolved);
        return <span className='ingot-pill-anchor'>
            <button type='button' id='ingot-composer-model' className={`ingot-pill ingot-model-pill${ready ? '' : ' ingot-pill-warn'}`} data-model={model} aria-haspopup='listbox'
                aria-expanded={this.popover === 'model'} title={ready ? `Model: ${this.modelLabel(resolved)}` : this.account.signedIn ? 'This model is not ready yet: pick another or add a key' : 'Sign in to use Ingot models'}
                onClick={() => { this.popover = this.popover === 'model' ? undefined : 'model'; this.update(); }}>
                {!ready && <span className='ingot-pill-dot' aria-hidden='true' />}<span className='ingot-pill-label'>{this.modelLabel(model)}</span><span className='codicon codicon-chevron-down ingot-pill-caret' />
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
        return <button type='button' id='ingot-context-ring' className={`ingot-more-item ingot-context-ring${ratio >= CONTEXT_NEAR_FULL ? ' near-full' : ''}`} data-ratio={ratio.toFixed(3)}
            title={`Context: ${formatTokens(usage.total)} of ${formatTokens(usage.window)} tokens (${Math.round(ratio * 100)}%)`} aria-label={`Context ${Math.round(ratio * 100)}% used`} aria-haspopup='dialog' aria-expanded={this.popover === 'context'}
            onClick={() => { this.popover = 'context'; this.update(); }}>
            <svg width='18' height='18' viewBox='0 0 18 18' aria-hidden='true'>
                <circle cx='9' cy='9' r={r} className='ingot-ring-track' />
                <circle cx='9' cy='9' r={r} className='ingot-ring-value' strokeDasharray={`${c * ratio} ${c}`} transform='rotate(-90 9 9)' />
            </svg>
            <span>Context {Math.round(ratio * 100)}%</span>
        </button>;
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
