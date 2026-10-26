# Agent approvals

Some agent actions wait for you on an approval card above the composer:

- git writes: commit, push, reset, rebase, tag, branch, checkout (shown as `Git commit: <message>`, `Git push: <branch> → <remote>`)
- terminal commands (`Run command: npm test`)
- web search and fetch
- MCP tool calls
- file deletes

Git reads (status, diff, log) never ask.

The card shows what the agent has explored so far ("Exploring 6 files, 8 searches"), one line with the action, and three choices:

| Choice | Key | Effect |
| --- | --- | --- |
| **Run** | Enter | Runs the action; the agent gets its output. |
| **Skip** | Esc | Nothing runs; the agent is told you skipped it. Type a note in the composer first and it is sent as the reason. |
| **Always Run** | | Runs it now and, in this project, every later action of the same type without asking. |

Stop (■) while a card is waiting ends the run.

## Settings

Settings › Tools › Agent approvals:

- `ingot.agent.git.requireApproval` (default `true`): off lets agent git actions run without the card.
- The Always Run list (`ingot.agent.approvals.alwaysRun`, project path → action types). Revoke an entry to be asked again.

Design reference: [design/approval-card-reference.png](design/approval-card-reference.png).
