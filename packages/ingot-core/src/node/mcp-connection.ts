import { spawn, type ChildProcess } from 'child_process';
import { MCP_PROTOCOL_VERSION, MCP_REQUEST_TIMEOUT_MS } from '../common/project-config/project-config.consts';
import type { McpServerConfig } from '../common/project-config/project-config.types';
import { redactSecrets } from '../common/models/models.utils';

interface Pending {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

/** One MCP server connection (stdio or streamable HTTP), speaking JSON-RPC 2.0. */
export class McpConnection {
    protected child?: ChildProcess;
    protected nextId = 1;
    protected readonly pending = new Map<number, Pending>();
    protected buffer = '';
    protected sessionId?: string;
    protected stderr = '';

    constructor(readonly config: McpServerConfig, protected readonly cwd: string) { }

    protected get secrets(): string[] {
        return [...Object.values(this.config.env ?? {}), ...Object.values(this.config.headers ?? {})];
    }

    /** Error text without any configured secret values. */
    clean(message: string): string {
        return redactSecrets(message, this.secrets);
    }

    async connect(): Promise<void> {
        if (this.config.command) {
            this.child = spawn(this.config.command, [...(this.config.args ?? [])], {
                cwd: this.cwd, env: { ...process.env, ...(this.config.env ?? {}) }, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32'
            });
            this.child.stdout!.setEncoding('utf8').on('data', (chunk: string) => this.onData(chunk));
            this.child.stderr!.setEncoding('utf8').on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-2000); });
            this.child.on('exit', code => this.failAll(new Error(`exited with code ${code}${this.stderr ? `: ${this.stderr.trim().split('\n').pop()}` : ''}`)));
            this.child.on('error', error => this.failAll(error));
        }
        await this.request('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'Ingot', version: '0.1.0' } });
        await this.notify('notifications/initialized');
    }

    async listTools(): Promise<{ name: string; description?: string; inputSchema?: unknown }[]> {
        const result = await this.request('tools/list', {}) as { tools?: { name: string; description?: string; inputSchema?: unknown }[] };
        return result.tools ?? [];
    }

    async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
        const result = await this.request('tools/call', { name, arguments: args }) as { content?: { type: string; text?: string }[]; isError?: boolean };
        const text = (result.content ?? []).map(c => c.type === 'text' ? c.text ?? '' : `[${c.type}]`).join('\n');
        return { text, isError: !!result.isError };
    }

    dispose(): void {
        this.failAll(new Error('stopped'));
        this.child?.kill();
        this.child = undefined;
    }

    protected onData(chunk: string): void {
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        for (const line of lines) {
            if (line.trim()) {
                try {
                    this.onMessage(JSON.parse(line));
                } catch {
                    // servers may print non-JSON noise; ignore it
                }
            }
        }
    }

    protected onMessage(message: { id?: number; result?: unknown; error?: { message?: string } }): void {
        if (typeof message.id !== 'number') {
            return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) {
            return;
        }
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
            pending.reject(new Error(message.error.message ?? 'MCP error'));
        } else {
            pending.resolve(message.result ?? {});
        }
    }

    protected failAll(error: Error): void {
        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(error);
            this.pending.delete(id);
        }
    }

    protected async notify(method: string): Promise<void> {
        const message = { jsonrpc: '2.0', method };
        if (this.child) {
            this.child.stdin!.write(`${JSON.stringify(message)}\n`);
        } else if (this.config.url) {
            await this.post(message).catch(() => undefined);
        }
    }

    protected request(method: string, params: unknown): Promise<unknown> {
        const id = this.nextId++;
        const message = { jsonrpc: '2.0', id, method, params };
        if (!this.child && this.config.url) {
            return this.post(message).then(responses => {
                const response = responses.find(r => r.id === id);
                if (!response) {
                    throw new Error(`no response to ${method}`);
                }
                if (response.error) {
                    throw new Error(response.error.message ?? 'MCP error');
                }
                return response.result ?? {};
            });
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method} timed out`));
            }, MCP_REQUEST_TIMEOUT_MS);
            this.pending.set(id, { resolve, reject, timer });
            if (!this.child?.stdin?.writable) {
                this.failAll(new Error('server is not running'));
                return;
            }
            this.child.stdin.write(`${JSON.stringify(message)}\n`);
        });
    }

    /** Streamable HTTP transport: JSON or SSE responses, `Mcp-Session-Id` kept across requests. */
    protected async post(message: object): Promise<{ id?: number; result?: unknown; error?: { message?: string } }[]> {
        const response = await fetch(this.config.url!, {
            method: 'POST',
            headers: {
                'content-type': 'application/json', accept: 'application/json, text/event-stream',
                ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}), ...(this.config.headers ?? {})
            },
            body: JSON.stringify(message),
            signal: AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS)
        });
        this.sessionId = response.headers.get('mcp-session-id') ?? this.sessionId;
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const text = await response.text();
        if (!text.trim()) {
            return [];
        }
        if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
            return text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5)));
        }
        const json = JSON.parse(text);
        return Array.isArray(json) ? json : [json];
    }
}
