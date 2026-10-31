import { COUNTRY_SECOND_LEVEL, RESEARCH_ERRORS, RESEARCH_FOOTER, RESEARCH_STARTING, SHARED_HOSTS } from './research.consts';
import type { ResearchEvent, ResearchPage, ResearchView } from './research.types';

const SSE_DATA = 'data:';
const SSE_DONE = '[DONE]';

/** Complete `data: {json}` lines of an SSE buffer as events, plus the unfinished tail. Comments (`: ping`) and `[DONE]` are skipped. */
export const parseSse = (buffer: string): { events: ResearchEvent[]; rest: string } => {
    const lines = buffer.split('\n');
    const rest = lines.pop() ?? '';
    const events: ResearchEvent[] = [];
    for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith(SSE_DATA)) {
            continue;
        }
        const data = line.slice(SSE_DATA.length).trim();
        if (!data || data === SSE_DONE) {
            continue;
        }
        try {
            const event = JSON.parse(data) as ResearchEvent;
            if (event && typeof event === 'object' && typeof event.type === 'string') {
                events.push(event);
            }
        } catch {
            // A malformed line is dropped; the run goes on.
        }
    }
    return { events, rest };
};

/** The site a domain belongs to, so en.wikipedia.org and de.wikipedia.org count once (same rule as the server). */
export const siteOf = (domain: string): string => {
    const labels = domain.split('.');
    if (labels.length <= 2 || /^\d+$/.test(labels[labels.length - 1])) {
        return domain;
    }
    const lastTwo = labels.slice(-2).join('.');
    const country = labels[labels.length - 1].length === 2 && COUNTRY_SECOND_LEVEL.has(labels[labels.length - 2]);
    return SHARED_HOSTS.has(lastTwo) || country ? labels.slice(-3).join('.') : lastTwo;
};

/** Distinct sites among the pages read. */
export const researchSites = (pages: readonly ResearchPage[]): number => new Set(pages.map(page => siteOf(page.domain))).size;

/** The newest page per site, oldest first, at most `limit` (the chips on a live run). */
export const recentSites = (pages: readonly ResearchPage[], limit: number): ResearchPage[] => {
    const bySite = new Map<string, ResearchPage>();
    for (const page of pages) {
        const site = siteOf(page.domain);
        bySite.delete(site);
        bySite.set(site, page);
    }
    return [...bySite.values()].slice(-limit);
};

export const emptyResearch = (question: string, maxCostUsd: number): ResearchView => ({
    question, stage: 'plan', status: RESEARCH_STARTING, queries: [], pages: [], found: 0, costUsd: 0, maxCostUsd
});

export const researchErrorText = (code: string, message?: string): string => RESEARCH_ERRORS[code] ?? message ?? RESEARCH_ERRORS.research_failed;

/** Folds one server event into the view. */
export const applyResearchEvent = (view: ResearchView, event: ResearchEvent): ResearchView => {
    switch (event.type) {
        case 'start': return { ...view, maxCostUsd: event.limits.maxCostUsd };
        case 'plan': return { ...view, queries: event.queries };
        case 'progress': return { ...view, stage: event.stage, status: event.message };
        case 'found': return { ...view, found: event.count };
        case 'page': return event.ok && !view.pages.some(page => page.url === event.url)
            ? { ...view, pages: [...view.pages, { url: event.url, title: event.title, domain: event.domain }] }
            : view;
        case 'cost': return { ...view, costUsd: event.costUsd, maxCostUsd: event.maxCostUsd };
        case 'answer': return { ...view, sources: event.sources };
        case 'done': return { ...view, stage: 'done', status: '', stats: event.stats, costUsd: event.stats.costUsd };
        case 'error': return { ...view, stage: 'error', status: '', error: researchErrorText(event.code, event.message) };
        default: return view;
    }
};

/** `$0.0049` under a cent, `$0.012` above. */
export const moneyText = (usd: number): string => `$${usd.toFixed(usd < 0.01 ? 4 : 3)}`;

/** The answer without the server's stats line (the card draws its own footer). */
export const stripResearchFooter = (markdown: string): string => markdown.replace(RESEARCH_FOOTER, '');

/** "Read 30 pages on 14 sites · $0.0098". */
export const researchSummary = (view: ResearchView): string => {
    const pages = view.stats?.pages ?? view.pages.length;
    const sites = view.stats?.domains ?? researchSites(view.pages);
    return `Read ${pages} ${pages === 1 ? 'page' : 'pages'} on ${sites} ${sites === 1 ? 'site' : 'sites'} · ${moneyText(view.stats?.costUsd ?? view.costUsd)}`;
};

/** What the agent gets back from ingot/deep_research: the cited answer and the numbered sources, so it can cite them too. */
export const researchToolResult = (view: ResearchView, answer: string): string => {
    const cited = (view.sources ?? []).filter(source => source.cited);
    return [
        answer.trim(),
        cited.length ? `Sources:\n${cited.map(source => `[${source.n}] ${source.title} — ${source.url}`).join('\n')}` : '',
        researchSummary(view)
    ].filter(Boolean).join('\n\n');
};
