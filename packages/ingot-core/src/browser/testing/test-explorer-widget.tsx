import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import URI from '@theia/core/lib/common/uri';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import type { ExplorerFile, ExplorerTest, TestState } from '../../common/testing/testing.types';
import { TestStore } from './test-store';
import { TEST_EXPLORER_ICON, TEST_EXPLORER_LABEL, TEST_EXPLORER_TEXT, TEST_EXPLORER_WIDGET_ID } from './testing.browser-consts';

const MS_PER_SECOND = 1000;
const STATE_ICONS: Record<TestState | 'idle' | 'running', string> = {
    passed: 'codicon-pass-filled',
    failed: 'codicon-error',
    skipped: 'codicon-circle-slash',
    idle: 'codicon-circle-large-outline',
    running: 'codicon-loading codicon-modifier-spin'
};

/** IDEA-261: the Test Explorer tool window: tests by file, Run All, Rerun Failed, and per-file / per-test runs. */
@injectable()
export class TestExplorerWidget extends ReactWidget {

    @inject(TestStore) protected readonly store: TestStore;
    @inject(EditorManager) protected readonly editors: EditorManager;

    protected readonly collapsed = new Set<string>();

    @postConstruct()
    protected init(): void {
        this.id = TEST_EXPLORER_WIDGET_ID;
        this.title.label = TEST_EXPLORER_LABEL;
        this.title.caption = TEST_EXPLORER_LABEL;
        this.title.closable = true;
        this.title.iconClass = TEST_EXPLORER_ICON;
        this.addClass('ingot-tests');
        this.node.tabIndex = 0;
        this.toDispose.push(this.store.onDidChange(() => this.update()));
        void this.store.ensureLoaded();
        this.update();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected async open(file: string, line?: number): Promise<void> {
        const root = this.store.root;
        if (!root) {
            return;
        }
        const position = { line: Math.max(0, (line ?? 1) - 1), character: 0 };
        await this.editors.open(URI.fromFilePath(root).resolve(file), { mode: 'activate', selection: { start: position, end: position } });
    }

    protected toggle(path: string): void {
        if (this.collapsed.has(path)) {
            this.collapsed.delete(path);
        } else {
            this.collapsed.add(path);
        }
        this.update();
    }

    protected stateIcon(state: TestState | undefined, running: boolean): React.ReactNode {
        const key = running ? 'running' : state ?? 'idle';
        return <span className={`codicon ${STATE_ICONS[key]} ingot-tests-state`} data-state={key} aria-label={key} />;
    }

    protected render(): React.ReactNode {
        const { store } = this;
        const discovery = store.discovery;
        const files = store.files;
        const last = store.lastRun;
        const failed = store.failed.length;
        return <div className='ingot-tests-root'>
            <div className='ingot-tests-toolbar'>
                <button type='button' id='ingot-tests-run-all' className='ingot-tests-button' title='Run All Tests' disabled={store.isRunning || !discovery?.runner} onClick={() => store.runAll()}>
                    <span className='codicon codicon-run-all' /> Run All
                </button>
                <button type='button' id='ingot-tests-rerun-failed' className='ingot-tests-button' title='Rerun Failed Tests' disabled={store.isRunning || !failed} onClick={() => store.rerunFailed()}>
                    <span className='codicon codicon-debug-rerun' /> Rerun Failed{failed ? ` (${failed})` : ''}
                </button>
                <button type='button' id='ingot-tests-refresh' className='ingot-tests-icon' title='Refresh Tests' aria-label='Refresh Tests' disabled={store.loading} onClick={() => store.refresh()}>
                    <span className='codicon codicon-refresh' />
                </button>
                {discovery?.runner && <span className='ingot-tests-runner' id='ingot-tests-runner' title={`Detected from ${discovery.reason ?? discovery.runner}`}>{discovery.runner}</span>}
                <span className='ingot-tests-spacer' />
                {this.renderSummary()}
            </div>
            {last?.status === 'error' && last.error && <pre className='ingot-tests-error' id='ingot-tests-error'>{last.error}</pre>}
            {this.renderEmpty(files)}
            <ul className='ingot-tests-tree' id='ingot-tests-tree' role='tree'>
                {files.map(file => this.renderFile(file))}
            </ul>
        </div>;
    }

    protected renderSummary(): React.ReactNode {
        const { store } = this;
        if (store.isRunning) {
            return <span className='ingot-tests-summary' id='ingot-tests-summary'>{TEST_EXPLORER_TEXT.running}</span>;
        }
        const last = store.lastRun;
        if (!last || last.status === 'error') {
            return <span className='ingot-tests-summary' id='ingot-tests-summary'>{TEST_EXPLORER_TEXT.notRun}</span>;
        }
        return <span className='ingot-tests-summary' id='ingot-tests-summary' data-status={last.status}>
            <span className='ingot-tests-count' data-state='passed'>{last.passed} passed</span>
            <span className='ingot-tests-count' data-state='failed'>{last.failed} failed</span>
            <span className='ingot-tests-count' data-state='skipped'>{last.skipped} skipped</span>
            <span className='ingot-tests-time'>{(last.durationMs / MS_PER_SECOND).toFixed(1)}s</span>
        </span>;
    }

    protected renderEmpty(files: readonly ExplorerFile[]): React.ReactNode {
        const { store } = this;
        const text = !store.root ? TEST_EXPLORER_TEXT.noFolder
            : store.loading && !store.discovery ? TEST_EXPLORER_TEXT.loading
                : store.discovery && !store.discovery.runner ? TEST_EXPLORER_TEXT.noRunner
                    : store.discovery && !files.length ? TEST_EXPLORER_TEXT.noTests : '';
        return text ? <div className='ingot-tests-empty' id='ingot-tests-empty'>{text}</div> : undefined;
    }

    protected renderFile(file: ExplorerFile): React.ReactNode {
        const open = !this.collapsed.has(file.path);
        const running = file.tests.some(test => this.store.running.has(test.id));
        return <li key={file.path} className='ingot-tests-file' data-path={file.path} data-state={file.state ?? 'idle'} role='treeitem' aria-expanded={open}>
            <div className='ingot-tests-row' onClick={() => this.toggle(file.path)}>
                <span className={`codicon codicon-chevron-${open ? 'down' : 'right'} ingot-tests-chevron`} />
                {this.stateIcon(file.state, running)}
                <span className='ingot-tests-name'>{file.path}</span>
                <span className='ingot-tests-detail'>{file.tests.length}</span>
                <button type='button' className='ingot-tests-icon ingot-tests-row-run' title={`Run ${file.path}`} aria-label={`Run ${file.path}`} disabled={this.store.isRunning}
                    onClick={e => { e.stopPropagation(); void this.store.run({ files: [file.path] }); }}>
                    <span className='codicon codicon-play' />
                </button>
            </div>
            {open && <ul className='ingot-tests-children' role='group'>{file.tests.map(test => this.renderTest(file.path, test))}</ul>}
        </li>;
    }

    protected renderTest(path: string, test: ExplorerTest): React.ReactNode {
        const running = this.store.running.has(test.id);
        return <li key={test.id} className='ingot-tests-case' data-id={test.id} data-state={test.state ?? 'idle'} role='treeitem'>
            <div className='ingot-tests-row' onClick={() => this.open(path, test.line)} title={test.line ? `${path}:${test.line}` : path}>
                {this.stateIcon(test.state, running)}
                <span className='ingot-tests-name'>
                    {test.suites.map(suite => <span key={suite} className='ingot-tests-suite'>{suite} › </span>)}
                    {test.title}
                </span>
                {test.durationMs !== undefined && <span className='ingot-tests-detail'>{Math.round(test.durationMs)} ms</span>}
                <button type='button' className='ingot-tests-icon ingot-tests-row-run' title={`Run ${test.title}`} aria-label={`Run ${test.title}`} disabled={this.store.isRunning}
                    onClick={e => { e.stopPropagation(); void this.store.run({ files: [path], titles: [test.title] }); }}>
                    <span className='codicon codicon-play' />
                </button>
            </div>
            {test.state === 'failed' && test.message && <pre className='ingot-tests-message'>{test.message}</pre>}
        </li>;
    }
}
