import { fileIconClass } from '../../common/icons/file-icon-map';
import * as React from '@theia/core/shared/react';
import * as monaco from '@theia/monaco-editor-core';
import { ChangeMark } from '../brand/change-mark';
import { MINI_DIFF_CONTEXT, MINI_DIFF_MAX_LINES } from '../../common/changes/changes.consts';
import type { CodeChange, HunkState } from '../../common/changes/changes.types';
import { changeStats, miniDiff } from '../../common/changes/changes.utils';
import { CHANGE_STATUS_LABELS } from './changes.browser-consts';

export interface CodeChangeBlockProps {
    readonly change: CodeChange;
    readonly expanded: boolean;
    readonly onToggle: () => void;
    readonly onOpen: (hunkId?: string) => void;
    readonly onDecide: (hunkIds: readonly string[] | 'all', state: HunkState) => void;
}

const languageFor = (path: string): string | undefined => {
    const ext = path.includes('.') ? `.${path.split('.').pop()!.toLowerCase()}` : '';
    return monaco.languages.getLanguages().find(l => l.extensions?.includes(ext))?.id;
};

/** Syntax-highlighted rows (Monaco colorizer), one HTML string per line; plain text until it resolves. */
const useHighlighted = (lines: readonly string[], path: string): readonly string[] | undefined => {
    const [html, setHtml] = React.useState<readonly string[] | undefined>();
    const text = lines.join('\n');
    React.useEffect(() => {
        let live = true;
        const language = languageFor(path);
        if (!language) {
            setHtml(undefined);
            return undefined;
        }
        monaco.editor.colorize(text, language, { tabSize: 4 }).then(out => {
            if (live) {
                setHtml(out.split(/<br\/?>/));
            }
        }, () => undefined);
        return () => { live = false; };
    }, [text, path]);
    return html && html.length >= lines.length ? html : undefined;
};

/** One agent file edit in the chat (IDEA-102): icon, path, +/−, status, collapsible mini diff and per-hunk Accept / Reject. */
export const CodeChangeBlock = ({ change, expanded, onToggle, onOpen, onDecide }: CodeChangeBlockProps): React.ReactElement => {
    const stats = changeStats(change.hunks);
    const { rows, truncated } = miniDiff(change, MINI_DIFF_CONTEXT, MINI_DIFF_MAX_LINES);
    const highlighted = useHighlighted(rows.map(r => r.text), change.path);
    const streaming = change.status === 'streaming';
    const pending = change.hunks.some(h => h.state === 'pending') && !streaming;
    const name = change.path.split('/').pop() ?? change.path;
    const firstRowOf = new Set<string>();
    return <div className={`ingot-change-block status-${change.status}`} id={`ingot-change-${change.id}`} data-path={change.path}>
        <div className='ingot-change-head'>
            <button type='button' className='ingot-change-toggle' aria-expanded={expanded} title={expanded ? 'Hide diff' : 'Show diff'} onClick={onToggle}>
                <span className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`} />
            </button>
            <ChangeMark loop={streaming} still={!streaming} className='ingot-change-mark' />
            <button type='button' className='ingot-change-file' title={change.path} aria-label={`Open ${change.path}`} onClick={() => onOpen()}>
                <span className={fileIconClass(name)} aria-hidden='true' />
                <span className='ingot-change-name'>{name}</span>
            </button>
            <span className='ingot-change-stats'><span className='ingot-plus'>+{stats.added}</span> <span className='ingot-minus'>−{stats.removed}</span></span>
            <span className='ingot-flex' />
            {/* While hunks wait, the Accept / Reject buttons say it; the status pill would only crowd out the file name. */}
            <span className={`ingot-change-status ingot-change-status-${change.status}${pending ? ' ingot-change-status-quiet' : ''}`}>{CHANGE_STATUS_LABELS[change.status]}</span>
            {pending && <>
                <button type='button' className='ingot-change-btn reject' id={`ingot-change-reject-${change.id}`} title='Reject file' onClick={() => onDecide('all', 'rejected')}>
                    <span className='codicon codicon-close' />
                </button>
                <button type='button' className='ingot-change-btn accept' id={`ingot-change-accept-${change.id}`} title='Accept file' onClick={() => onDecide('all', 'accepted')}>
                    <span className='codicon codicon-check' />
                </button>
            </>}
        </div>
        {expanded && <div className='ingot-change-diff' role='region' aria-label={`Changes in ${change.path}`}>
            {rows.map((row, i) => {
                const hunk = row.hunkId ? change.hunks.find(h => h.id === row.hunkId) : undefined;
                const first = !!hunk && !firstRowOf.has(hunk.id);
                if (hunk) {
                    firstRowOf.add(hunk.id);
                }
                return <React.Fragment key={i}>
                    {first && hunk && <div className={`ingot-change-hunk-bar state-${hunk.state}`}>
                        <span className='ingot-dim'>Line {hunk.newStart + 1}</span>
                        <span className='ingot-flex' />
                        {hunk.state === 'pending' && !streaming ? <>
                            <button type='button' className='ingot-change-hunk-btn' id={`ingot-block-reject-${hunk.id}`} onClick={() => onDecide([hunk.id], 'rejected')}>Reject</button>
                            <button type='button' className='ingot-change-hunk-btn accept' id={`ingot-block-accept-${hunk.id}`} onClick={() => onDecide([hunk.id], 'accepted')}>Accept</button>
                        </> : <span className='ingot-dim'>{hunk.state === 'pending' ? '' : CHANGE_STATUS_LABELS[hunk.state === 'accepted' ? 'accepted' : 'rejected']}</span>}
                    </div>}
                    <div className={`ingot-change-row ${row.kind}`} onClick={() => row.hunkId && onOpen(row.hunkId)}>
                        <span className='ingot-change-sign'>{row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}</span>
                        {highlighted && row.kind !== 'gap'
                            ? <code dangerouslySetInnerHTML={{ __html: highlighted[i] || ' ' }} />
                            : <code>{row.text || ' '}</code>}
                    </div>
                </React.Fragment>;
            })}
            {truncated && <button type='button' className='ingot-change-more' onClick={() => onOpen()}>Open file to see all changes</button>}
            {streaming && <div className='ingot-change-row typing'><span className='ingot-change-sign' /><code><span className='ingot-change-caret' /></code></div>}
        </div>}
    </div>;
};
