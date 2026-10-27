# Zaprex desktop handoff (Harmony mode), protocol v1

Shared contract between **Ingot** (this repo) and the **Zaprex desktop app** (`yaghobieh/zaprex`, the Electron shell that loads `zaprex.dev/app`).
Ingot side: `packages/ingot-core/src/common/zaprex/handoff.ts` (types, link and body parsers) and `packages/ingot-core/src/node/zaprex-desktop-service.ts` (loopback server).

## 1. Opening Zaprex (the T-rex)

| Zaprex desktop installed | What the T-rex does |
| --- | --- |
| yes | opens `zaprex://open?from=ingot` |
| no | opens `https://zaprex.dev/app?from=ingot` in the browser |

How Ingot checks whether the app is installed:
- **macOS:** `/Applications/Zaprex.app` or `~/Applications/Zaprex.app`
- **Windows:** registry key `HKCU\Software\Classes\zaprex` or `HKCR\zaprex`
- **Linux:** `xdg-mime query default x-scheme-handler/zaprex`

`zaprex.dev/app?from=ingot` should detect the OS (macOS, Windows or Linux) and offer either **Download Zaprex for <OS>** or **Stay here** (web).
The web app must not offer to take Harmony pieces. It should say: *"Pieces need the desktop app: a web page can't open files on this computer."*
The reason: browsers can't reach Ingot's loopback endpoint, which rejects any request that has an `Origin` header, and Private Network Access blocks it too.

## 2. Handing over a piece

1. Ingot starts a loopback HTTP server, bound to `127.0.0.1` on a random port. It creates a piece with a random id and a 24-byte bearer token, then opens:
   `zaprex://harmony?v=1&id=<id>&port=<port>&token=<token>&from=ingot`
2. The desktop app handles the link **in its main process** (not the renderer, so no `Origin` header is sent). It claims the piece:
   `GET http://127.0.0.1:<port>/v1/handoff/<id>` with `Authorization: Bearer <token>`
   - `200`: the piece, shown below. It is now `claimed`.
   - `404`: unknown id or bad token.
   - `410`: expired. Pieces expire if they aren't claimed within 10 minutes.
   - `403`: the request had an `Origin` header.

```json
{
  "v": 1, "id": "h_…", "source": "ingot", "kind": "tests", "label": "Tests",
  "task": "Write the tests for: add a CSV export to the File menu",
  "goal": "add a CSV export to the File menu",
  "lead": { "title": "Add a CSV export to the File menu", "task": "add a CSV export to the File menu" },
  "scope": ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "test/**", "tests/**", "e2e/**"],
  "repo": { "path": "/Users/me/project", "branch": "main", "head": "<sha>" },
  "context": [{ "path": "src/export.ts", "content": "…" }],
  "createdAt": 1793000000000
}
```

The fields:
- `scope` lists the globs Zaprex is allowed to change. While the piece runs, the Ingot agent is locked out of those globs, and Zaprex is locked into them.
- `context` holds the files the Ingot agent is changing, capped at 12 files and 60k characters.
- `repo.path` is the local checkout. The desktop app may read files there, but it must write only through the result described in step 4.

3. While working, Zaprex shows **"Working on {label} while Ingot works on {lead.title}"** and posts progress as often as it likes:
   `POST …/v1/handoff/<id>/status` with body `{ "state": "working", "progress": 0.4, "message": "Writing export.test.ts" }`
   - `state` is one of `working`, `failed` or `cancelled`.
   - `progress` is a number from 0 to 1.
   - `message` is at most 500 characters.

   Ingot reads the status every second. It shows the message and progress in the T-rex subagent row above the chat input.
4. When done, Zaprex posts the result:
   `POST …/v1/handoff/<id>/result` with body `{ "summary": "Added 6 tests", "edits": [{ "path": "src/export.test.ts", "content": "<full file>" }] }`
   - Every path must be relative to the project and inside `scope`. Otherwise Ingot returns `400`.
   - Ingot applies the edits through its normal review: diffs, Accept or Reject, and the review bar. Zaprex never writes to the disk itself.
5. Once a piece is `done`, `failed` or `cancelled`, any further POST returns `409`. If the user presses Stop in Ingot, the piece is cancelled.

**The lead agent:** when the Ingot agent finishes its own part, it posts "Waiting for Zaprex: …" and waits. When Zaprex is done, it posts "Done: {label} · N file(s) to review in the review bar".

**Without the desktop app:** the offer says so ("Runs here in Ingot · Get Zaprex"), and the piece runs inside Ingot as a scoped Zaprex chat.

## 3. What the desktop app needs to do

1. Register the `zaprex://` scheme:
   - macOS: `CFBundleURLTypes`
   - Windows: `HKCU\Software\Classes\zaprex`
   - Linux: a `.desktop` file with `MimeType=x-scheme-handler/zaprex`
   Also handle `open-url` and second-instance argv.
2. `zaprex://open`: focus or open the main window.
3. `zaprex://harmony?...`:
   - parse the link (same format as `parseHandoffLink`)
   - claim the piece from the main process (Node `fetch`, no `Origin` header)
   - show the "Working on … while Ingot works on …" banner
   - post status, then post the result
   - keep the token in memory only, and never log it
4. Treat `scope` as a hard limit on what it changes.
5. Show a clear error if the claim fails (`404`, `410` or `403`).

## 4. Testing hooks (Ingot)

- `INGOT_ZAPREX_DETECT_FILE`: a file containing `installed` or `missing`. It overrides detection.
- `INGOT_ZAPREX_LINK_LOG`: the opened links are appended to this file instead of being opened. The e2e test `harmony-desktop.spec.ts` uses it to act as the desktop app.
