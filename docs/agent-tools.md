# Agent tools: terminal, scripts and processes

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
