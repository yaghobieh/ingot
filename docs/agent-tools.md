# Agent tools: terminal, scripts, processes and browser

The agent can run commands in the project: compilers, tests, builds and any `package.json` script, in the
foreground (it waits for the output) or in the background (dev servers, watchers).

| Tool | What it does | Asks first? |
| --- | --- | --- |
| `ingot/run` | Runs a shell command in the project root. `{"command": "npm test"}`, add `"background": true` for long-running processes. | Yes |
| `ingot/scripts` | Lists `package.json` scripts and the package manager (npm, pnpm, yarn or bun, from the lockfile). | No |
| `ingot/run_script` | Runs a script with the project's package manager, e.g. `pnpm run dev`. The card shows the real command. | Yes |
| `ingot/processes` | Lists running and recent processes: id, status, command, uptime, port. | No |
| `ingot/process_output` | Reads the latest output of a process. | No |
| `ingot/process_stop` | Stops a process and its children. | Only for processes you started |

## Foreground and background

- **Foreground** commands return their output and exit code. A command still running after the foreground
  timeout (default 120 s) is not killed: it keeps running in the background and the agent gets its process id.
- **Background** commands return after a short moment with their first output and any port they announce
  (`Local: http://localhost:5173`).
- Stopping a process stops its whole process group (`npm run dev` → `node` → `vite`).
- Output is kept per process (the last 200 000 characters, colour codes removed); the agent reads at most
  16 000 characters per call.

## Approval

Every command waits on the approval card (`Run command: npm test`, `Run in background: npm run dev`).
**Always Run** on a command remembers *that exact command* for the project; other commands still ask.
Settings › Tools › Agent approvals lists the remembered commands with **Revoke**.

## Processes in the chat

A compact **Processes** list sits above the composer whenever something runs in the background, whether the
agent started it or you did:

- each row shows the command, who started it (agent or you), a live uptime, the port it announced (click to open
  it) and a Stop button (■);
- click a row to see its output, which updates live;
- **+** runs a `package.json` script or any command in the project root as one of *your* processes;
- the clear button drops finished rows; finished foreground commands (a build, a test run) stay in the chat
  transcript instead of the list;
- the processes button in the chat header shows the list even when nothing runs.

The agent sees the same list through `ingot/processes` and can read any process's output; it stops its own
processes freely and asks before stopping yours. Commands: **Processes: Run Script or Command…**,
**Processes: Stop All Processes**.

## Browser

The agent can open web pages in Ingot's **Browser** panel (it opens beside the editor) and use them like you do:
check the app it just started, fill a form, read docs.

| Tool | What it does | Asks first? |
| --- | --- | --- |
| `ingot/browser_open` | Opens a URL (`localhost:5173` works) and returns the page. | Yes |
| `ingot/browser_read` | Reads the page: title, URL, numbered interactive elements and the visible text. | No (setting) |
| `ingot/browser_click` | Clicks an element by `ref` (from the last read), CSS `selector` or visible `text`. | Yes |
| `ingot/browser_type` | Types into a field (`ref`, `selector` or `label`); `"submit": true` presses Enter. | Yes |
| `ingot/browser_scroll` | Scrolls up or down a screen. | Yes |
| `ingot/browser_back` | Goes back. | Yes |
| `ingot/browser_screenshot` | Captures the visible page; the image is shown in the chat and sent to vision models. Desktop app only. | No (setting) |

- **Take control / Give back control.** The button in the panel's toolbar hands the page to you. While you have
  control the agent waits; when you give it back, it continues from the page you left it on and is told where you
  went. Clicking the page while the agent drives also takes control.
- Every action goes through the approval card (`Open page: http://localhost:5173`, `Click: "Sign in"`) and
  follows the approval settings; **Always Run** stops asking for browser actions (Settings › Tools › Agent approvals lists it with **Revoke**).
- The desktop app uses an isolated web view (its own cookie store, no Node access, http and https only). The web
  build shows pages through Ingot's server without running their scripts, so use the desktop app for
  script-heavy sites and for screenshots.
