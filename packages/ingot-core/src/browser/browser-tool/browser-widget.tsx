import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { BROWSER_WIDGET_ID, BROWSER_WIDGET_LABEL } from '../../common/browser-tool/browser-tool.consts';
import { BrowserController } from './browser-controller';

/**
 * IDEA-130: the Ingot browser panel. Back / forward / reload, an address bar, and Take control / Give back control.
 * While the agent drives, an overlay keeps stray clicks off the page.
 */
@injectable()
export class IngotBrowserWidget extends ReactWidget {

    @inject(BrowserController) protected readonly controller: BrowserController;
    protected address = '';
    protected editing = false;
    protected host?: HTMLDivElement | null;

    @postConstruct()
    protected init(): void {
        this.id = BROWSER_WIDGET_ID;
        this.title.label = BROWSER_WIDGET_LABEL;
        this.title.caption = 'Ingot browser: the agent can open, read and use pages; take control any time';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-globe';
        this.addClass('ingot-browser');
        this.toDispose.push(this.controller.onDidChange(() => {
            if (!this.editing) {
                this.address = this.displayUrl;
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

    protected render(): React.ReactNode {
        const c = this.controller;
        const nav = c.engine.current;
        const user = c.control === 'user';
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
                <button type='button' id='ingot-browser-control' className={`ingot-browser-control ${user ? 'give-back' : 'take'}`} aria-pressed={user}
                    title={user ? 'Hand the browser back to the agent' : 'Drive the browser yourself; the agent waits'}
                    onClick={() => c.toggleControl()}>
                    <span className={`codicon ${user ? 'codicon-debug-continue' : 'codicon-hand'}`} />{user ? 'Give back control' : 'Take control'}
                </button>
            </div>
            {(user || c.agentDriving) && <div className={`ingot-browser-banner ${user ? 'user' : 'agent'}`} id='ingot-browser-banner' role='status'>
                {user
                    ? <><span className='codicon codicon-account' />{c.agentWaiting ? 'You have control. The agent is waiting for you.' : 'You have control of the browser.'}</>
                    : <><span className='ingot-browser-agent-mark' aria-hidden='true'>&lt;/&gt;</span>The agent is using the browser.</>}
            </div>}
            <div className='ingot-browser-host' ref={el => this.attachHost(el)}>
                {c.agentDriving && <div className='ingot-browser-overlay' id='ingot-browser-overlay' onClick={() => c.takeControl()} title='Click to take control' />}
                {nav.url === 'about:blank' && !nav.loading && <div className='ingot-browser-empty'>
                    <span className='codicon codicon-globe' />
                    <p>Type a URL, or ask the agent to open a page.</p>
                    <p className='ingot-dim'>The agent can navigate, click, type, read the page and take screenshots. Use “Take control” to drive it yourself.</p>
                </div>}
            </div>
        </div>;
    }
}
