import * as React from '@theia/core/shared/react';
import { RESEARCH_BETA, RESEARCH_RECENT_SITES, RESEARCH_TITLE } from '../../common/research/research.consts';
import type { ResearchView } from '../../common/research/research.types';
import { moneyText, recentSites, researchSites, researchSummary } from '../../common/research/research.utils';
import { shorten } from '../../common/agents/tool-cards';

export const BetaPill = (): React.ReactElement => <span className='ingot-beta-pill'>{RESEARCH_BETA}</span>;

export interface ResearchCardProps {
    readonly view: ResearchView;
    /** `reply`: a Deep research chat answer; `tool`: the agent's ingot/deep_research call. */
    readonly variant: 'reply' | 'tool';
    /** The finished answer as HTML (reply variant); citations are links. */
    readonly answerHtml?: string;
    readonly onAnswerClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
    readonly openLink: (url: string) => void;
}

const LIVE_STAGES = new Set(['plan', 'search', 'read', 'follow', 'notes', 'crosscheck', 'write']);

/**
 * IDEA-314: a Deep research run in the chat. Live: a bright shimmering status, the pages and sites read so far, the
 * running cost and chips of the latest sites. Done: the cited answer (reply) or the cited sources (agent tool card).
 */
export const ResearchCard = ({ view, variant, answerHtml, onAnswerClick, openLink }: ResearchCardProps): React.ReactElement => {
    const live = LIVE_STAGES.has(view.stage);
    const sites = view.stats?.domains ?? researchSites(view.pages);
    const pages = view.stats?.pages ?? view.pages.length;
    const cited = (view.sources ?? []).filter(source => source.cited);
    return <div className={`ingot-research ingot-research-${variant}${live ? ' live' : ''}`} id={variant === 'reply' ? 'ingot-research-card' : 'ingot-research-tool'}
        data-stage={view.stage} data-pages={pages} data-sites={sites}>
        <div className='ingot-research-head'>
            <span className='codicon codicon-telescope' aria-hidden='true' />
            <b>{RESEARCH_TITLE}</b>
            <BetaPill />
            {variant === 'tool' && <span className='ingot-research-question ingot-dim' title={view.question}>{shorten(view.question, 80)}</span>}
        </div>
        {live && <>
            <div className='ingot-research-bar' aria-hidden='true' />
            <div className='ingot-research-status' aria-live='polite'><span className='ingot-research-shimmer' id='ingot-research-status'>{view.status}</span></div>
            <div className='ingot-research-counts ingot-dim' id='ingot-research-counts'>
                {pages} {pages === 1 ? 'page' : 'pages'} read · {sites} {sites === 1 ? 'site' : 'sites'}{view.found ? ` · ${view.found} found` : ''}{view.costUsd ? ` · ${moneyText(view.costUsd)} of ${moneyText(view.maxCostUsd)}` : ''}
            </div>
            {view.pages.length > 0 && <ul className='ingot-research-sites' aria-label='Sites read'>
                {recentSites(view.pages, RESEARCH_RECENT_SITES).map(page => <li key={page.url}>
                    <button type='button' className='ingot-research-site' title={page.title || page.url} onClick={() => openLink(page.url)}>{page.domain}</button>
                </li>)}
            </ul>}
        </>}
        {view.stage === 'error' && <div className='ingot-research-error' id='ingot-research-error'><span className='codicon codicon-error' aria-hidden='true' /> {view.error}</div>}
        {view.stage === 'stopped' && <div className='ingot-research-stopped ingot-dim'>{view.status}</div>}
        {view.stage === 'done' && variant === 'reply' && answerHtml
            && <div className='ingot-md ingot-research-answer' id='ingot-research-answer' onClick={onAnswerClick} dangerouslySetInnerHTML={{ __html: answerHtml }} />}
        {view.stage === 'done' && variant === 'tool' && cited.length > 0 && <ol className='ingot-research-sources'>
            {cited.map(source => <li key={source.n} value={source.n}>
                <a href={source.url} className='ingot-research-source' title={source.url} onClick={e => { e.preventDefault(); openLink(source.url); }}>{source.title}</a>
                <span className='ingot-dim'> · {source.domain}</span>
            </li>)}
        </ol>}
        {(view.stage === 'done' || view.stage === 'stopped') && pages > 0 && <div className='ingot-research-footer ingot-dim' id='ingot-research-footer'>{researchSummary(view)}</div>}
    </div>;
};
