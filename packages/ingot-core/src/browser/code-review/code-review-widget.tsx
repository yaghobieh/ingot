import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { BUGBOT_POST_COMMAND, REVIEW_SEVERITIES, SEVERITY_LABELS } from '../../common/code-review/code-review.consts';
import type { ReviewFinding } from '../../common/code-review/code-review.types';
import { severityCounts } from '../../common/code-review/code-review.utils';
import { fileIconClass } from '../../common/icons/file-icon-map';
import { CodeReviewStore } from './code-review-store';
import { CODE_REVIEW_COMMANDS, CODE_REVIEW_WIDGET_ID, CODE_REVIEW_WIDGET_LABEL } from './code-review.browser-consts';

/** IDEA-293: the Review panel: findings by file with severity, open at the line, and "Fix with agent". */
@injectable()
export class CodeReviewWidget extends ReactWidget {

    @inject(CodeReviewStore) protected readonly store: CodeReviewStore;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;

    @postConstruct()
    protected init(): void {
        this.id = CODE_REVIEW_WIDGET_ID;
        this.title.label = CODE_REVIEW_WIDGET_LABEL;
        this.title.caption = 'AI code review findings';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-checklist';
        this.addClass('ingot-code-review');
        this.node.tabIndex = 0;
        this.toDispose.push(this.store.onDidChange(() => this.update()));
        this.update();
    }

    protected async open(finding: ReviewFinding): Promise<void> {
        const uri = this.store.uriOf(finding);
        if (uri) {
            await this.editors.open(uri, { mode: 'activate', selection: { start: { line: finding.line - 1, character: 0 } } });
        }
    }

    protected renderFinding(finding: ReviewFinding): React.ReactNode {
        return <div key={finding.id} id={`ingot-cr-finding-${finding.id}`} className='ingot-cr-finding' data-severity={finding.severity} role='button' tabIndex={0}
            title={`${finding.path}:${finding.line}`} onClick={() => void this.open(finding)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void this.open(finding); } }}>
            <span className={`ingot-cr-severity ingot-cr-severity-${finding.severity}`}>{SEVERITY_LABELS[finding.severity]}</span>
            <span className='ingot-cr-finding-text'>
                <span className='ingot-cr-finding-title'>{finding.title}</span>
                {finding.detail && <span className='ingot-cr-finding-detail'>{finding.detail}</span>}
            </span>
            <span className='ingot-cr-finding-line'>:{finding.line}</span>
            <button type='button' className='ingot-cr-fix' title='Ask the agent to fix this finding' aria-label={`Fix with agent: ${finding.title}`}
                onClick={e => { e.stopPropagation(); void this.commands.executeCommand(CODE_REVIEW_COMMANDS.fix.id, finding.id); }}>
                <span className='codicon codicon-sparkle' aria-hidden='true' /> Fix with agent
            </button>
        </div>;
    }

    protected render(): React.ReactNode {
        const run = this.store.run;
        const findings = run?.findings ?? [];
        const counts = severityCounts(findings);
        const byFile = new Map<string, ReviewFinding[]>();
        findings.forEach(finding => byFile.set(finding.path, [...byFile.get(finding.path) ?? [], finding]));
        return <div className='ingot-code-review-root'>
            <div className='ingot-code-review-toolbar'>
                <span className='ingot-code-review-label' id='ingot-code-review-label'>{run ? run.label : 'No review yet'}</span>
                {run?.status === 'done' && REVIEW_SEVERITIES.filter(severity => counts[severity] > 0).map(severity =>
                    <span key={severity} className={`ingot-cr-count ingot-cr-severity-${severity}`} data-severity={severity}>{counts[severity]} {SEVERITY_LABELS[severity]}</span>)}
                <span className='ingot-flex' />
                <button type='button' id='ingot-code-review-run' className='ingot-code-review-btn' disabled={this.store.running}
                    onClick={() => void this.commands.executeCommand(CODE_REVIEW_COMMANDS.changes.id)}><span className='codicon codicon-git-compare' aria-hidden='true' /> Review Changes</button>
                <button type='button' id='ingot-code-review-pr' className='ingot-code-review-btn' disabled={this.store.running}
                    onClick={() => void this.commands.executeCommand(CODE_REVIEW_COMMANDS.githubPr.id)}><span className='codicon codicon-github' aria-hidden='true' /> Review PR</button>
                {run?.status === 'done' && run.pullRequest && (run.postedUrl !== undefined
                    ? <span id='ingot-code-review-posted' className='ingot-code-review-posted'><span className='codicon codicon-check' aria-hidden='true' /> Posted to the PR</span>
                    : <button type='button' id='ingot-code-review-post' className='ingot-code-review-btn' disabled={run.posting}
                        onClick={() => void this.commands.executeCommand(BUGBOT_POST_COMMAND.id)}><span className='codicon codicon-comment' aria-hidden='true' /> {run.posting ? 'Posting…' : 'Post to GitHub PR'}</button>)}
                {run && <button type='button' className='ingot-code-review-icon codicon codicon-clear-all' title='Clear findings' aria-label='Clear findings' disabled={this.store.running}
                    onClick={() => this.store.clear()} />}
            </div>
            <div className='ingot-code-review-status' id='ingot-code-review-status' data-status={run?.status ?? 'idle'}>
                {!run && <span>Run Review Changes on your local git diff, or Review GitHub PR. Findings show here and in the editor.</span>}
                {run?.status === 'running' && <span><span className='codicon codicon-loading codicon-modifier-spin' /> Reviewing{run.model ? ` with ${run.model}` : ''}…</span>}
                {run?.status === 'error' && <span className='ingot-code-review-error'><span className='codicon codicon-error' /> {run.message}</span>}
                {run?.status === 'done' && <span>{run.message ?? (findings.length
                    ? `${findings.length} finding${findings.length === 1 ? '' : 's'} in ${byFile.size} file${byFile.size === 1 ? '' : 's'}`
                    : `No problems found in ${run.reviewedFiles.length} file${run.reviewedFiles.length === 1 ? '' : 's'}`)}{run.model ? ` · ${run.model}` : ''}</span>}
                {run?.skippedFiles.length ? <span className='ingot-code-review-budget' title={run.skippedFiles.join('\n')}> · {run.skippedFiles.length} file(s) skipped to stay within the review budget</span> : undefined}
            </div>
            <div className='ingot-code-review-list'>
                {[...byFile.entries()].map(([path, items]) => <div key={path} className='ingot-cr-file' data-path={path}>
                    <div className='ingot-cr-file-header'><span className={fileIconClass(path)} aria-hidden='true' /><span className='ingot-cr-file-path'>{path}</span><span className='ingot-dim'>{items.length}</span></div>
                    {items.map(finding => this.renderFinding(finding))}
                </div>)}
            </div>
        </div>;
    }
}
