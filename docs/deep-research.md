# Deep research <sup>Beta</sup>

Deep research answers questions that need many current sources: comparisons, what developers report in practice, recent
changes. It plans the search, reads 15–40 real pages and answers with inline citations you can click.

## Turn it on

- Click **Deep research** (the telescope) in the chat composer, or type `/research`, or pick **Deep research** in the
  mode menu (**More › Mode**). The toggle shows a **Beta** pill while it is on; click it again to go back to the mode you
  used before.
- Type the question and press Enter. Each question in a Deep research chat is a new run.
- Deep research runs on the Ingot server, so it needs you to be signed in to Ingot. No API key of yours is used.

## What a run does

1. **Plan.** A cheap model splits the question into 4–6 search queries.
2. **Search broadly.** The open web (Ingot's web search), Reddit, Hacker News, GitHub and Stack Exchange.
3. **Read.** Up to 30 pages by default (40 at most), at most one page per ordinary site, plus the most-linked pages
   those pages point to. Duplicates and search, sign-in and share pages are skipped.
4. **Take notes and cross-check.** Notes per batch of pages, then a pass that marks where sources agree and disagree.
5. **Answer.** A cited answer: every claim carries `[n]`, and the sources list sits under it.

While it works, the card shows what it is doing with a bright shimmer ("Searching Reddit…", "Read 12 of 24 pages"), how
many pages and sites it has read, the running cost and chips for the latest sites (click one to open it).

When it is done:

- citations show as small numbered chips; click one to open the source in your browser;
- **Sources** lists the cited pages, **Also read** the other pages it read;
- the footer reads `Read 29 pages on 14 sites · $0.0098`.

## Cost and limits

- Each run is capped at **$0.05** of model cost (the cheap research model; most runs cost about a cent) and 30 pages.
  When the cap is reached the answer is built from cited extracts instead of another model call.
- Runs are rate limited per account: 2 per minute, 5 a day on Free and 40 a day on paid plans.
- Stop a run with the Stop button or Escape.

## From the agent

In Agent mode the agent has the `ingot/deep_research` tool (`{"question": "…"}`). Like web search it waits on the
approval card (**Deep research: <question>**), shows the same live card while it runs, and gets the cited answer and the
numbered sources back, so its reply can cite them. **Always Run** for web actions covers it.

## Notes

- Google search pages are not read; Ingot uses its own web search (with Brave and DuckDuckGo fallbacks) and the public
  Reddit, Hacker News (Algolia), GitHub and Stack Exchange APIs.
- Answers are only as good as the pages found; the card says where the evidence is thin or sources disagree.
