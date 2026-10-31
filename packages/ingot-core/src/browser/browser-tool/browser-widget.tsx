import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { ContextKeyService, type ContextKey } from '@theia/core/lib/browser/context-key-service';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { BROWSER_FOCUS_KEY, BROWSER_WIDGET_ID, BROWSER_WIDGET_LABEL } from '../../common/browser-tool/browser-tool.consts';
import { popoverPosition } from '../../common/browser-tool/browser-tool.utils';
import type { PageSelection } from '../../common/browser-tool/browser-tool.types';
import { BrowserController } from './browser-controller';
import { RexMark } from '../brand/rex-mark';
import { BROWSER_COMMANDS, COMMENT_BAR_HEIGHT_PX, SELECTION_BAR_HEIGHT_PX } from './browser-tool.browser-consts';

/**
 * IDEA-130: the Ingot browser panel. Back / forward / reload, an address bar, and Take control / Give back control.
 * While the agent drives, an overlay keeps stray clicks off the page.
 * IDEA-289: open the page in the system browser; select text on the page to Quote it in the chat or Comment on it.
 */
@injectable()
export class IngotBrowserWidget extends ReactWidget {

    @inject(BrowserController) protected readonly controller: BrowserController;
    @inject(CommandService) protected readonly commands: CommandService;
    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;
    protected address = '';
    protected editing = false;
    protected comment = '';
    protected host?: HTMLDivElement | null;
    protected focusKey?: ContextKey<boolean>;

    @postConstruct()
    protected init(): void {
        this.id = BROWSER_WIDGET_ID;
        this.title.label = BROWSER_WIDGET_LABEL;
        this.title.caption = 'Ingot browser: the agent can open, read and use pages; take control any time';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-globe';
        this.addClass('ingot-browser');
        this.node.tabIndex = -1;
        this.focusKey = this.contextKeys.createKey<boolean>(BROWSER_FOCUS_KEY, false);
        this.node.addEventListener('focusin', () => this.focusKey?.set(true));
        this.node.addEventListener('focusout', e => { if (!this.node.contains(e.relatedTarget as Node | null)) { this.focusKey?.set(false); } });
        // Shortcuts replayed from the page frame: mark the panel focused before Ingot's keybindings (document capture) see them.
        const markFocus = (e: KeyboardEvent): void => {
            if (this.node.contains(e.target as Node | null)) {
                this.focusKey?.set(true);
            }
        };
        window.addEventListener('keydown', markFocus, true);
        this.toDispose.push({ dispose: () => window.removeEventListener('keydown', markFocus, true) });
        this.toDispose.push(this.controller.onDidChange(() => {
            if (!this.editing) {
                this.address = this.displayUrl;
            }
            if (!this.controller.commenting) {
                this.comment = '';
            }
            this.update();
        }));
        this.address = this.displayUrl;
        this.update();
    }

    protected get displayUrl(): string {
        const url = this.controller.engine.current.url;
        return url === 'about:blank' ? '' : url;
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        const input = this.node.querySelector<HTMLInputElement>('#ingot-browser-address');
        if (input && !this.displayUrl) {
            input.focus();
        } else {
            this.node.focus();
        }
    }

    protected attachHost(el: HTMLDivElement | null): void {
        this.host = el;
        const page = this.controller.engine.element;
        if (el && page.parentElement !== el) {
            el.prepend(page);
        }
    }

    protected run(id: string, ...args: unknown[]): void {
        void this.commands.executeCommand(id, ...args);
    }

    protected render(): React.ReactNode {
        const c = this.controller;
        const nav = c.engine.current;
        const user = c.control === 'user';
        const blank = nav.url === 'about:blank';
        return <div className={`ingot-browser-root${user ? ' user-control' : ''}${c.agentDriving ? ' agent-control' : ''}`}>
            <div className='ingot-browser-toolbar'>
                <button type='button' id='ingot-browser-back' className='ingot-icon-button codicon codicon-arrow-left' title='Back' aria-label='Back' onClick={() => void c.engine.back()} />
                <button type='button' id='ingot-browser-forward' className='ingot-icon-button codicon codicon-arrow-right' title='Forward' aria-label='Forward' onClick={() => void c.engine.forward()} />
                <button type='button' id='ingot-browser-reload' className={`ingot-icon-button codicon ${nav.loading ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'}`} title='Reload' aria-label='Reload'
                    onClick={() => void c.engine.reload()} />
                <form className='ingot-browser-address-form' onSubmit={e => { e.preventDefault(); this.editing = false; void c.navigate(this.address); }}>
                    <span className={`codicon ${nav.url.startsWith('https:') ? 'codicon-lock' : 'codicon-globe'} ingot-browser-address-icon`} aria-hidden='true' />
                    <input id='ingot-browser-address' className='ingot-browser-address' value={this.address} placeholder='Type a URL, e.g. localhost:5173' spellCheck={false} aria-label='Address'
                        onFocus={e => { this.editing = true; e.currentTarget.select(); }} onBlur={() => { this.editing = false; }}
                        onChange={e => { this.address = e.currentTarget.value; this.update(); }} />
                </form>
                <button type='button' id='ingot-browser-external' className='ingot-icon-button codicon codicon-link-external' title='Open in external browser' aria-label='Open in external browser'
                    disabled={blank} onClick={() => this.run(BROWSER_COMMANDS.openExternal.id)} />
                <button type='button' id='ingot-browser-control' className={`ingot-browser-control ${user ? 'give-back' : 'take'}`} aria-pressed={user}
                    title={user ? 'Hand the browser back to the agent' : 'Drive the browser yourself; the agent waits'}
                    onClick={() => c.toggleControl()}>
                    <span className={`codicon ${user ? 'codicon-debug-continue' : 'codicon-hand'}`} />{user ? 'Give back control' : 'Take control'}
                </button>
            </div>
            {(user || c.agentDriving) && <div className={`ingot-browser-banner ${user ? 'user' : 'agent'}`} id='ingot-browser-banner' role='status'>
                {user
                    ? <><span className='codicon codicon-account' />{c.agentWaiting ? 'You have control. The agent is waiting for you.' : 'You have control of the browser.'}</>
                    : <><RexMark className='ingot-browser-agent-mark' />The agent is using the browser.</>}
            </div>}
            <div className='ingot-browser-host' ref={el => this.attachHost(el)}>
                {c.agentDriving && <div className='ingot-browser-overlay' id='ingot-browser-overlay' onClick={() => c.takeControl()} title='Click to take control' />}
                {!c.agentDriving && c.selection && this.renderSelectionBar(c.selection)}
                {blank && !nav.loading && <div className='ingot-browser-empty'>
                    <span className='codicon codicon-globe' />
                    <p>Type a URL, or ask the agent to open a page.</p>
                    <p className='ingot-dim'>Start a chat message with /browser to let the agent navigate, click, type, take screenshots and read the console. Select text on a page to quote it in the chat.</p>
                </div>}
            </div>
        </div>;
    }

    /** IDEA-289: Quote / Comment under the selected text. */
    protected renderSelectionBar(selection: PageSelection): React.ReactNode {
        const c = this.controller;
        const commenting = c.commenting;
        const host = this.host;
        const position = selection.rect && host
            ? popoverPosition(selection.rect, host.clientWidth, host.clientHeight, commenting ? COMMENT_BAR_HEIGHT_PX : SELECTION_BAR_HEIGHT_PX)
            : undefined;
        const style: React.CSSProperties = position ? { left: position.left, top: position.top } : { right: 0, bottom: 0 };
        const send = (): void => this.run(BROWSER_COMMANDS.sendComment.id, this.comment);
        return <div id='ingot-browser-selection' className={`ingot-browser-selection${commenting ? ' commenting' : ''}`} style={style} role='toolbar' aria-label='Selected text'
            onMouseDown={e => e.stopPropagation()}>
            {!commenting && <>
                <button type='button' id='ingot-browser-quote' className='ingot-browser-selection-action' title='Quote the selection in the agent chat' onClick={() => this.run(BROWSER_COMMANDS.quoteSelection.id)}>
                    <span className='codicon codicon-quote' />Quote in chat
                </button>
                <button type='button' id='ingot-browser-comment' className='ingot-browser-selection-action' title='Comment on the selection in the agent chat' onClick={() => this.run(BROWSER_COMMANDS.commentSelection.id)}>
                    <span className='codicon codicon-comment' />Comment
                </button>
                <button type='button' id='ingot-browser-selection-close' className='ingot-icon-button codicon codicon-close' title='Dismiss' aria-label='Dismiss' onClick={() => c.clearSelection()} />
            </>}
            {commenting && <form className='ingot-browser-comment-form' onSubmit={e => { e.preventDefault(); send(); }}>
                <div className='ingot-browser-comment-quote' title={selection.text}>“{selection.text}”</div>
                <textarea id='ingot-browser-comment-input' className='ingot-browser-comment-input' value={this.comment} placeholder='Tell the agent about this…' rows={2} autoFocus aria-label='Comment'
                    onChange={e => { this.comment = e.currentTarget.value; this.update(); }}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            send();
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            c.clearSelection();
                        }
                    }} />
                <div className='ingot-browser-comment-actions'>
                    <button type='button' className='theia-button secondary' id='ingot-browser-comment-cancel' onClick={() => c.clearSelection()}>Cancel</button>
                    <button type='submit' className='theia-button' id='ingot-browser-comment-send' disabled={!this.comment.trim()}>Send to agent</button>
                </div>
            </form>}
        </div>;
    }
}
