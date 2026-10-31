import { inject, injectable } from '@theia/core/shared/inversify';
import type { Event } from '@theia/core/lib/common/event';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { IngotMcpClient } from '../project-config/mcp-client';
import { SLACK_MCP_URL, SLACK_MCP_URL_ENV, SLACK_SERVER_NAME, slackConnectionView, slackSecrets, slackServerConfig, validateSlackToken } from '../../common/slack';
import type { SlackConnectionView } from '../../common/slack';

/**
 * IDEA-270: Slack as a built-in MCP connection. Connecting writes the official Slack MCP server to the global
 * `~/.ingot/mcp.json` (token as a `${keychain}` placeholder) and stores the token in the OS keychain;
 * disconnecting removes both. Its tools reach the agent like any other connected MCP server.
 */
@injectable()
export class SlackConnectionService {

    @inject(IngotMcpClient) protected readonly mcp: IngotMcpClient;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;

    get onDidChange(): Event<void> {
        return this.mcp.onDidChange;
    }

    get view(): SlackConnectionView {
        const config = this.mcp.servers.find(s => s.name === SLACK_SERVER_NAME);
        return slackConnectionView(config, !!config && this.mcp.isEnabled(SLACK_SERVER_NAME), this.mcp.statusOf(SLACK_SERVER_NAME));
    }

    /** Imported servers are read-only, so the card cannot disconnect them. */
    get canDisconnect(): boolean {
        return this.mcp.servers.some(s => s.name === SLACK_SERVER_NAME) && this.mcp.scopeOf(SLACK_SERVER_NAME) !== 'imported';
    }

    async connect(token: string): Promise<void> {
        const error = validateSlackToken(token);
        if (error) {
            throw new Error(error);
        }
        await this.mcp.addServer(slackServerConfig(await this.url()), 'user', slackSecrets(token));
    }

    async turnOn(): Promise<void> {
        await this.mcp.setEnabled(SLACK_SERVER_NAME, true);
    }

    async disconnect(): Promise<void> {
        if (this.canDisconnect) {
            await this.mcp.removeServer(SLACK_SERVER_NAME);
        }
    }

    protected async url(): Promise<string> {
        const override = (await this.env.getValue(SLACK_MCP_URL_ENV).catch(() => undefined))?.value?.trim();
        return override && /^https?:\/\//.test(override) ? override : SLACK_MCP_URL;
    }
}
