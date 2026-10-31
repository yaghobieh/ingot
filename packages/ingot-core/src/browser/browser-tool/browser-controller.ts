import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { environment } from '@theia/core/shared/@theia/application-package/lib/environment';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import type { BrowserControl, BrowserScreenshot, BrowserTarget, PageActionResult, PageSelection } from '../../common/browser-tool/browser-tool.types';
import { BROWSER_WIDGET_ID, PAGE_MAX_ELEMENTS, PAGE_TEXT_CHARS } from '../../common/browser-tool/browser-tool.consts';
import { formatConsole, formatNetworkErrors, formatSnapshot, normalizeUrl, type ConsoleFilter } from '../../common/browser-tool/browser-tool.utils';
import { FrameEngine, WebviewEngine, type BrowserEngine } from './browser-engine';
import { clickTarget, scrollPage, snapshotPage, typeInto } from './page-scripts';

/**
 * IDEA-130: one browser per window that both the agent and the user drive. The agent acts unless the user took
 * control; then its next action waits until the user gives control back.
 */
@injectable()
export class BrowserController {

    @inject(WidgetManager) protected readonly widgets: WidgetManager;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(WindowService) protected readonly windows: WindowService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    /** IDEA-289: text the user selected on the page, for Quote / Comment. */
    protected selected?: PageSelection;
    protected commentOpen = false;
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    protected engineInstance?: BrowserEngine;
    protected controlState: BrowserControl = 'agent';
    /** The chat whose run is using the browser (overlay "Agent is using the browser"). */
    protected agentSessionId?: string;
    protected agentBusyCount = 0;
    protected waiters: { resolve: (go: boolean) => void }[] = [];

    get engine(): BrowserEngine {
        if (!this.engineInstance) {
            this.engineInstance = environment.electron.is() ? new WebviewEngine() : new FrameEngine();
            this.engineInstance.onDidNavigate(() => this.changed());
            this.engineInstance.onDidSelect(selection => {
                if (!this.commentOpen || selection) {
                    this.commentOpen = this.commentOpen && !!selection && selection.text === this.selected?.text;
                    this.selected = selection;
                    this.changed();
                }
            });
        }
        return this.engineInstance;
    }

    get selection(): PageSelection | undefined {
        return this.selected;
    }

    /** The Comment box is open under the selection. */
    get commenting(): boolean {
        return this.commentOpen && !!this.selected;
    }

    startComment(): void {
        this.commentOpen = true;
        this.changed();
    }

    clearSelection(): void {
        this.commentOpen = false;
        this.selected = undefined;
        this.changed();
    }

    /** IDEA-289: the current page in the system browser. */
    openExternal(): boolean {
        const url = this.engine.current.url;
        if (!normalizeUrl(url) || url === 'about:blank') {
            return false;
        }
        this.windows.openNewWindow(url, { external: true });
        return true;
    }

    get control(): BrowserControl {
        return this.controlState;
    }

    /** The agent is mid-run with the browser and the user has not taken control. */
    get agentDriving(): boolean {
        return this.controlState === 'agent' && (!!this.agentSessionId || this.agentBusyCount > 0);
    }

    get agentWaiting(): boolean {
        return this.waiters.length > 0;
    }

    takeControl(): void {
        this.controlState = 'user';
        this.changed();
    }

    giveBackControl(): void {
        this.controlState = 'agent';
        this.waiters.splice(0).forEach(w => w.resolve(true));
        this.changed();
    }

    toggleControl(): void {
        if (this.controlState === 'user') {
            this.giveBackControl();
        } else {
            this.takeControl();
        }
    }

    /** The chat's run ended (or was stopped): drop the overlay and cancel a wait for control. */
    endAgentRun(sessionId: string): void {
        if (this.agentSessionId === sessionId) {
            this.agentSessionId = undefined;
        }
        this.waiters.splice(0).forEach(w => w.resolve(false));
        this.changed();
    }

    async open(activate = true): Promise<void> {
        const widget = await this.widgets.getOrCreateWidget(BROWSER_WIDGET_ID);
        if (!widget.isAttached) {
            await this.shell.addWidget(widget, { area: 'main', mode: 'split-right' });
        }
        await (activate ? this.shell.activateWidget(widget.id) : this.shell.revealWidget(widget.id));
    }

    /** User navigation from the address bar. */
    async navigate(input: string): Promise<void> {
        const url = normalizeUrl(input);
        if (url) {
            await this.engine.navigate(url);
        }
    }

    // ---- agent actions -------------------------------------------------------------------------------------------

    async agentOpen(sessionId: string, input: string): Promise<string> {
        const url = normalizeUrl(input);
        if (!url) {
            return `Cannot open "${input}": use an http(s) URL.`;
        }
        return this.agentAct(sessionId, async engine => {
            await engine.navigate(url);
            return this.read(engine);
        });
    }

    agentRead(sessionId: string): Promise<string> {
        return this.agentAct(sessionId, engine => this.read(engine));
    }

    agentClick(sessionId: string, target: BrowserTarget): Promise<string> {
        return this.agentAct(sessionId, async engine => this.after(engine, await engine.run(clickTarget, { target, followLinks: engine.kind === 'frame' })));
    }

    agentType(sessionId: string, target: BrowserTarget, text: string, submit: boolean): Promise<string> {
        return this.agentAct(sessionId, async engine => this.after(engine, await engine.run(typeInto, { target, text, submit, followLinks: engine.kind === 'frame' })));
    }

    agentScroll(sessionId: string, direction: 'up' | 'down' | 'top' | 'bottom'): Promise<string> {
        return this.agentAct(sessionId, async engine => this.after(engine, await engine.run(scrollPage, { direction })));
    }

    agentBack(sessionId: string): Promise<string> {
        return this.agentAct(sessionId, async engine => {
            await engine.back();
            return this.read(engine);
        });
    }

    async agentScreenshot(sessionId: string): Promise<{ text: string; image?: BrowserScreenshot }> {
        let image: BrowserScreenshot | undefined;
        const text = await this.agentAct(sessionId, async engine => {
            image = await engine.screenshot();
            return image ? `Screenshot of ${engine.current.url} (${image.width}×${image.height}).` : 'Screenshots need the desktop app; read the page instead (ingot/browser_read).';
        });
        return { text, image };
    }

    /** IDEA-289: console messages and uncaught errors of the current page. */
    agentConsole(sessionId: string, filter: ConsoleFilter): Promise<string> {
        return this.agentAct(sessionId, async engine => {
            if (engine.current.url === 'about:blank') {
                return 'The browser is empty. Open a page with ingot/browser_open.';
            }
            const note = engine.kind === 'frame' ? '\n(The web build shows pages without running their scripts, so only the desktop app has console messages; use ingot/browser_network for failed requests.)' : '';
            return formatConsole(engine.consoleEntries, filter, engine.current.url) + note;
        });
    }

    /** IDEA-289: failed requests (HTTP errors and no response) of the current page. */
    agentNetwork(sessionId: string): Promise<string> {
        return this.agentAct(sessionId, async engine => engine.current.url === 'about:blank'
            ? 'The browser is empty. Open a page with ingot/browser_open.'
            : formatNetworkErrors(engine.networkErrors, engine.current.url));
    }

    /** Runs an agent action: opens the panel, waits while the user has control, shows the "agent is driving" overlay. */
    protected async agentAct(sessionId: string, action: (engine: BrowserEngine) => Promise<string>): Promise<string> {
        await this.open(false);
        let note = '';
        if (this.controlState === 'user') {
            const before = this.engine.current.url;
            const go = await new Promise<boolean>(resolve => { this.waiters.push({ resolve }); this.changed(); });
            if (!go) {
                return 'Stopped while the user had control of the browser.';
            }
            if (this.engine.current.url !== before) {
                note = `The user had control and is now on ${this.engine.current.url}.\n`;
            }
        }
        this.agentSessionId = sessionId;
        this.agentBusyCount++;
        this.changed();
        try {
            return note + await action(this.engine);
        } catch (error) {
            return `Browser error: ${error instanceof Error ? error.message : String(error)}`;
        } finally {
            this.agentBusyCount--;
            this.changed();
        }
    }

    protected async read(engine: BrowserEngine): Promise<string> {
        if (engine.current.url === 'about:blank') {
            return 'The browser is empty. Open a page with ingot/browser_open.';
        }
        return formatSnapshot(await engine.run(snapshotPage, { maxText: PAGE_TEXT_CHARS, maxElements: PAGE_MAX_ELEMENTS }));
    }

    /** After a click / type: follow a proxied link (web build), let the page settle, then report where we are. */
    protected async after(engine: BrowserEngine, result: PageActionResult): Promise<string> {
        if (!result.ok) {
            return result.message;
        }
        const before = engine.current.url;
        if (result.navigate) {
            await engine.navigate(result.navigate);
        } else {
            await new Promise(r => setTimeout(r, 600));
            if (engine.current.loading) {
                await new Promise<void>(resolve => {
                    const sub = engine.onDidNavigate(nav => { if (!nav.loading) { sub.dispose(); resolve(); } });
                    setTimeout(() => { sub.dispose(); resolve(); }, 10_000);
                });
            }
        }
        const moved = engine.current.url !== before ? ` Now on ${engine.current.title || engine.current.url} — ${engine.current.url}.` : '';
        return `${result.message}${moved} Read the page (ingot/browser_read) to see the result.`;
    }

    protected changed(): void {
        this.onDidChangeEmitter.fire();
    }
}
