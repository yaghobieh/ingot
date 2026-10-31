import { describe, expect, it } from 'vitest';
import { RESEARCH_ERRORS } from './research.consts';
import type { ResearchEvent, ResearchView } from './research.types';
import {
    applyResearchEvent, emptyResearch, moneyText, parseSse, recentSites, researchErrorText, researchSites, researchSummary, researchToolResult, siteOf, stripResearchFooter
} from './research.utils';

const page = (url: string, domain: string, title = 't'): ResearchEvent => ({ type: 'page', n: 1, url, title, domain, ok: true });

describe('deep research (IDEA-314)', () => {
    it('parses SSE data lines, skipping pings, [DONE] and broken JSON, and keeps the unfinished tail', () => {
        const { events, rest } = parseSse(': ping\n\ndata: {"type":"plan","queries":["a"]}\n\ndata: nope\n\ndata: [DONE]\n\ndata: {"type":"fo');
        expect(events).toEqual([{ type: 'plan', queries: ['a'] }]);
        expect(rest).toBe('data: {"type":"fo');
        expect(parseSse(`${rest}und","count":3,"domains":2}\n`).events).toEqual([{ type: 'found', count: 3, domains: 2 }]);
    });

    it('counts sites, not subdomains', () => {
        expect(siteOf('en.wikipedia.org')).toBe('wikipedia.org');
        expect(siteOf('news.ycombinator.com')).toBe('ycombinator.com');
        expect(siteOf('www.bbc.co.uk')).toBe('bbc.co.uk');
        expect(siteOf('someone.github.io')).toBe('someone.github.io');
        expect(siteOf('127.0.0.1')).toBe('127.0.0.1');
        const pages = [{ url: 'a', title: '', domain: 'en.wikipedia.org' }, { url: 'b', title: '', domain: 'de.wikipedia.org' }, { url: 'c', title: '', domain: 'reddit.com' }];
        expect(researchSites(pages)).toBe(2);
        expect(recentSites(pages, 5).map(p => p.url)).toEqual(['b', 'c']);
        expect(recentSites(pages, 1).map(p => p.url)).toEqual(['c']);
    });

    it('folds the event stream into the live view, then the finished one', () => {
        const events: ResearchEvent[] = [
            { type: 'start', id: 'r1', question: 'q', limits: { maxCostUsd: 0.05, maxPages: 30 }, model: 'ingot-research' },
            { type: 'plan', queries: ['q reddit', 'q hn'] },
            { type: 'progress', stage: 'search', message: 'Searching Reddit…', source: 'reddit' },
            { type: 'found', count: 41, domains: 19 },
            page('https://www.reddit.com/r/x', 'reddit.com'),
            page('https://www.reddit.com/r/x', 'reddit.com'),
            { type: 'page', n: 0, url: 'https://dead.example', title: '', domain: 'dead.example', ok: false },
            page('https://news.ycombinator.com/item?id=1', 'news.ycombinator.com'),
            { type: 'progress', stage: 'read', message: 'Read 2 of 24 pages', done: 2, total: 24 },
            { type: 'cost', costUsd: 0.0021, maxCostUsd: 0.05 }
        ];
        const live = events.reduce(applyResearchEvent, emptyResearch('q', 0.05));
        expect(live).toMatchObject({ stage: 'read', status: 'Read 2 of 24 pages', queries: ['q reddit', 'q hn'], found: 41, costUsd: 0.0021 });
        expect(live.pages.map(p => p.domain)).toEqual(['reddit.com', 'news.ycombinator.com']);
        expect(researchSummary(live)).toBe('Read 2 pages on 2 sites · $0.0021');
        const done = [
            { type: 'answer', answer: 'Yes [1].', markdown: 'Yes [[1]](https://www.reddit.com/r/x).', sources: [{ n: 1, title: 'X', url: 'https://www.reddit.com/r/x', domain: 'reddit.com', via: 'reddit', cited: true }] },
            { type: 'done', stats: { pages: 29, domains: 14, domainList: [], costUsd: 0.0098, durationMs: 1, model: 'm', queries: 5, candidates: 80, budgetHit: false } }
        ] as ResearchEvent[];
        const finished = done.reduce(applyResearchEvent, live);
        expect(finished.stage).toBe('done');
        expect(researchSummary(finished)).toBe('Read 29 pages on 14 sites · $0.0098');
        expect(researchToolResult(finished, 'Yes [1].')).toBe('Yes [1].\n\nSources:\n[1] X — https://www.reddit.com/r/x\n\nRead 29 pages on 14 sites · $0.0098');
    });

    it('explains server errors in words', () => {
        const failed = applyResearchEvent(emptyResearch('q', 0.05) as ResearchView, { type: 'error', code: 'research_failed' });
        expect(failed).toMatchObject({ stage: 'error', error: RESEARCH_ERRORS.research_failed });
        expect(researchErrorText('research_rate_limited')).toBe(RESEARCH_ERRORS.research_rate_limited);
        expect(researchErrorText('weird', 'Server said no')).toBe('Server said no');
    });

    it('formats money and drops the stats line from the answer', () => {
        expect(moneyText(0.0049)).toBe('$0.0049');
        expect(moneyText(0.0123)).toBe('$0.012');
        expect(stripResearchFooter('Answer\n\n_Deep research · 30 pages · 13 sites · $0.0049_\n')).toBe('Answer');
    });
});
