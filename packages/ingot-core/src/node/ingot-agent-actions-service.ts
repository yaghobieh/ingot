import { spawn } from 'child_process';
import { injectable } from '@theia/core/shared/inversify';
import {
    capOutput, COMMAND_TIMEOUT_MS, htmlToText, parseSearchResults, type AgentActionResult, type AgentActionsService
} from '../common/agents/agent-actions-service';

const FETCH_TIMEOUT_MS = 20_000;

/** IDEA-109: runs approved agent actions. Every call here was approved on the card (or by "Always Run"). */
@injectable()
export class IngotAgentActionsService implements AgentActionsService {

    runCommand(cwd: string, command: string): Promise<AgentActionResult> {
        if (!command.trim()) {
            return Promise.resolve({ text: 'No command given.', isError: true });
        }
        return new Promise(resolve => {
            const shell = process.platform === 'win32' ? { cmd: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', command] } : { cmd: process.env.SHELL || '/bin/sh', args: ['-c', command] };
            const child = spawn(shell.cmd, shell.args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            const add = (chunk: Buffer): void => {
                if (output.length < 4 * 32_000) {
                    output += chunk.toString('utf8');
                }
            };
            child.stdout.on('data', add);
            child.stderr.on('data', add);
            const timer = setTimeout(() => child.kill('SIGTERM'), COMMAND_TIMEOUT_MS);
            child.on('error', error => {
                clearTimeout(timer);
                resolve({ text: error.message, isError: true });
            });
            child.on('close', (code, signal) => {
                clearTimeout(timer);
                const status = signal ? `Stopped (${signal}).` : `Exit code ${code}.`;
                resolve({ text: capOutput(`${output.trimEnd()}\n${status}`.trim()), isError: code !== 0 });
            });
        });
    }

    async fetchUrl(url: string): Promise<AgentActionResult> {
        if (!/^https?:\/\//i.test(url)) {
            return { text: 'Only http(s) URLs can be fetched.', isError: true };
        }
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'user-agent': 'Ingot IDE' } });
            const body = await response.text();
            const type = response.headers.get('content-type') ?? '';
            const text = /html/i.test(type) ? htmlToText(body) : body;
            return { text: capOutput(`${response.status} ${url}\n\n${text}`), isError: !response.ok };
        } catch (error) {
            return { text: error instanceof Error ? error.message : String(error), isError: true };
        }
    }

    async search(query: string): Promise<AgentActionResult> {
        if (!query.trim()) {
            return { text: 'No query given.', isError: true };
        }
        try {
            const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'user-agent': 'Mozilla/5.0 Ingot IDE' } });
            const results = parseSearchResults(await response.text());
            return results.length
                ? { text: results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}`).join('\n'), isError: false }
                : { text: `No results for "${query}".`, isError: false };
        } catch (error) {
            return { text: error instanceof Error ? error.message : String(error), isError: true };
        }
    }
}
