import { describe, expect, it } from 'vitest';
import {
    browserRunTask, commentMessage, consoleFilter, consoleLevel, formatConsole, formatNetworkErrors, injectStatus, parseObserverMessage, popoverPosition,
    pushCapped, quoteForComposer
} from './browser-tool.utils';
import { BROWSER_NET_PREFIX, BROWSER_SEL_PREFIX, BROWSER_STATUS_META } from './browser-tool.consts';
import { BROWSER_DEFAULTS, browserNeedsCard, browserToolsOn } from './browser-settings';
import type { BrowserConsoleEntry, PageSelection } from './browser-tool.types';
import { builtinToolProtocol, describeAction } from '../agents/agent-actions';

const PAGE = 'http://127.0.0.1:5173/';

describe('IDEA-289 console and failed requests', () => {
    it('maps Electron console levels (numbers and names)', () => {
        expect([0, 1, 2, 3].map(consoleLevel)).toEqual(['debug', 'info', 'warning', 'error']);
        expect(['log', 'warn', 'error', 'verbose', 'nope'].map(consoleLevel)).toEqual(['info', 'warning', 'error', 'debug', 'info']);
    });

    it('keeps only the latest entries', () => {
        const list = [1, 2, 3];
        pushCapped(list, 4, 3);
        expect(list).toEqual([2, 3, 4]);
    });

    it('reads observer lines and ignores real page logs', () => {
        expect(parseObserverMessage('hello')).toBeUndefined();
        expect(parseObserverMessage(`${BROWSER_NET_PREFIX}{bad json`)).toBeUndefined();
        expect(parseObserverMessage(`${BROWSER_NET_PREFIX}${JSON.stringify({ kind: 'fetch', url: `${PAGE}api/items`, method: 'post', status: 500 })}`))
            .toEqual({ kind: 'net', entry: { kind: 'fetch', url: `${PAGE}api/items`, method: 'POST', status: 500 } });
        expect(parseObserverMessage(`${BROWSER_NET_PREFIX}${JSON.stringify({ kind: 'img', url: `${PAGE}x.png`, status: 0, error: '' })}`))
            .toEqual({ kind: 'net', entry: { kind: 'resource', url: `${PAGE}x.png` } });
        expect(parseObserverMessage(`${BROWSER_SEL_PREFIX}${JSON.stringify({ text: ' Hand-made tools. ', rect: { left: 1, top: 2, bottom: 20, width: 90 } })}`))
            .toEqual({ kind: 'sel', selection: { text: 'Hand-made tools.', rect: { left: 1, top: 2, bottom: 20, width: 90 } } });
        expect(parseObserverMessage(`${BROWSER_SEL_PREFIX}${JSON.stringify({ text: '' })}`)).toEqual({ kind: 'sel' });
    });

    it('formats the console for the agent, filtered by level', () => {
        const at = 0;
        const entries: BrowserConsoleEntry[] = [
            { level: 'info', text: 'booted', at },
            { level: 'warning', text: 'deprecated   api', at },
            { level: 'error', text: 'Uncaught TypeError: x is undefined', source: `${PAGE}app.js`, line: 12, at }
        ];
        expect(formatConsole(entries, 'all', PAGE)).toBe([
            `3 console messages on ${PAGE}:`, '[info] booted', '[warning] deprecated api', `[error] Uncaught TypeError: x is undefined (${PAGE}app.js:12)`
        ].join('\n'));
        expect(formatConsole(entries, 'error', PAGE).split('\n')).toEqual([`1 console error on ${PAGE}:`, `[error] Uncaught TypeError: x is undefined (${PAGE}app.js:12)`]);
        expect(formatConsole(entries, 'warning', PAGE)).toContain('2 console warnings or errors');
        expect(formatConsole([], 'error', PAGE)).toBe(`No console errors on ${PAGE}.`);
        expect(consoleFilter('error')).toBe('error');
        expect(consoleFilter(undefined)).toBe('all');
    });

    it('formats failed requests', () => {
        const at = 0;
        expect(formatNetworkErrors([], PAGE)).toBe(`No failed requests on ${PAGE}.`);
        expect(formatNetworkErrors([
            { kind: 'resource', url: `${PAGE}missing.png`, status: 404, at },
            { kind: 'fetch', url: 'http://down.test/api', method: 'POST', error: 'Failed to fetch', at }
        ], PAGE)).toBe([`2 failed requests on ${PAGE}:`, `404 GET ${PAGE}missing.png (resource)`, 'Failed to fetch POST http://down.test/api (fetch)'].join('\n'));
    });

    it('marks an HTTP error in the proxied page', () => {
        expect(injectStatus('<html><head><title>x</title></head></html>', BROWSER_STATUS_META, 404)).toBe('<html><head><meta name="ingot-status" content="404"><title>x</title></head></html>');
        expect(injectStatus('<p>gone</p>', BROWSER_STATUS_META, 410)).toBe('<meta name="ingot-status" content="410"><p>gone</p>');
    });
});

describe('IDEA-289 quote and comment', () => {
    const selection: PageSelection = { text: 'Hand-made\n  tools.', url: PAGE, title: 'Forge Shop' };

    it('quotes the selection with its page on one line', () => {
        expect(quoteForComposer(selection)).toBe(`From Forge Shop (${PAGE}): "Hand-made tools."`);
        expect(quoteForComposer({ ...selection, title: '' })).toBe(`From ${PAGE}: "Hand-made tools."`);
    });

    it('sends a comment as a quote block with the note under it', () => {
        expect(commentMessage(selection, ' Make this bold ')).toBe(`Comment on Forge Shop (${PAGE}):\n> Hand-made\n>   tools.\n\nMake this bold`);
    });

    it('places the bar under the selection, inside the panel', () => {
        const rect = { left: 100, top: 40, bottom: 60, width: 80 };
        expect(popoverPosition(rect, 800, 600, 34)).toEqual({ left: 0, top: 66 });
        expect(popoverPosition({ ...rect, left: 400 }, 800, 600, 34)).toEqual({ left: 300, top: 66 });
        expect(popoverPosition({ ...rect, left: 780 }, 800, 600, 34)).toEqual({ left: 520, top: 66 });
        expect(popoverPosition({ ...rect, top: 560, bottom: 580 }, 800, 600, 34)).toEqual({ left: 0, top: 520 });
    });
});

describe('IDEA-289 /browser run', () => {
    it('reads the task after /browser', () => {
        expect(browserRunTask('/browser check the login page')).toBe('check the login page');
        expect(browserRunTask('  /browser')).toBe('');
        expect(browserRunTask('/browsers list')).toBeUndefined();
        expect(browserRunTask('open /browser')).toBeUndefined();
    });

    it('offers the browser tools only with /browser by default', () => {
        expect(browserToolsOn(BROWSER_DEFAULTS, false)).toBe(false);
        expect(browserToolsOn(BROWSER_DEFAULTS, true)).toBe(true);
        expect(browserToolsOn({ ...BROWSER_DEFAULTS, everyRun: true }, false)).toBe(true);
        expect(browserToolsOn({ ...BROWSER_DEFAULTS, enabled: false }, true)).toBe(false);
        expect(browserNeedsCard('browser_console', BROWSER_DEFAULTS)).toBe(false);
        expect(browserNeedsCard('browser_network', BROWSER_DEFAULTS)).toBe(false);
    });

    it('lists the console and network tools for the agent and on the card', () => {
        const on = builtinToolProtocol({ terminal: true, browser: true });
        expect(on).toContain('ingot/browser_console:');
        expect(on).toContain('ingot/browser_network:');
        expect(builtinToolProtocol({ terminal: true, browser: false })).not.toContain('ingot/browser_console:');
        expect(describeAction({ server: 'ingot', tool: 'browser_console', args: { level: 'error' } })).toEqual({ kind: 'browser', label: 'Read console', detail: 'error' });
        expect(describeAction({ server: 'ingot', tool: 'browser_network', args: {} })).toEqual({ kind: 'browser', label: 'Read failed requests', detail: '' });
    });
});
