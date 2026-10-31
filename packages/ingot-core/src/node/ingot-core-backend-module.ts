import { ContainerModule } from '@theia/core/shared/inversify';
import { installDisconnectedBufferGuard } from './disconnected-client-guard';

installDisconnectedBufferGuard();
import { KeyStoreService } from '@theia/core/lib/common/key-store';
import { DEV_FILE_KEYSTORE_ENV, DevFileKeyStoreService } from './dev-file-key-store';
import { IngotEditorImportService } from './editor-import-backend';
import { EDITOR_IMPORT_SERVICE_PATH, EditorImportService } from '../common/import/editor-import.types';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { PORTS_SERVICE_PATH } from '../common/ports/ports.consts';
import { PortsService } from '../common/ports/ports.types';
import { IngotPortsService } from './ingot-ports-service';
import { IngotAgentActionsService } from './ingot-agent-actions-service';
import { IngotProcessService } from './ingot-process-service';
import { BrowserProxyEndpoint } from './browser-proxy-endpoint';
import { ErrorReportingEndpoint } from './error-reporting-endpoint';
import { ParentWatchContribution } from './parent-watch-contribution';
import { PluginHostWatchdog } from './plugin-host-watchdog';
import { PluginHostEnvironmentVariable } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { ProcessService, type ProcessClient } from '../common/processes/processes.types';
import { PROCESS_SERVICE_PATH } from '../common/processes/processes.consts';
import { AGENT_ACTIONS_SERVICE_PATH, AgentActionsService } from '../common/agents/agent-actions-service';
import { IngotModelService } from './ingot-model-service';
import { MODEL_SERVICE_PATH } from '../common/models/models.consts';
import { ModelService } from '../common/models/models.types';
import { WorkspaceFileService } from '@theia/workspace/lib/common/workspace-file-service';
import { IngotWorkspaceFileService } from '../common/workspace/ingot-workspace-file-service';

import { IngotMcpService } from './ingot-mcp-service';
import { MCP_SERVICE_PATH } from '../common/project-config/project-config.consts';
import { McpService } from '../common/project-config/project-config.types';

import { IngotGitService } from './ingot-git-service';
import { IngotZaprexDesktopService } from './zaprex-desktop-service';
import { ZAPREX_DESKTOP_PATH, ZaprexDesktopService } from '../common/zaprex/zaprex-desktop.types';
import { GIT_SERVICE_PATH } from '../common/git/git.consts';
import { GitService } from '../common/git/git.types';

import { IngotDebugToolsService } from './ingot-debug-tools-service';
import { DEBUG_TOOLS_SERVICE_PATH } from '../common/debug/debug.consts';
import { DebugToolsService } from '../common/debug/debug.types';

import { IngotRulesInsightService } from './rules-insight/ingot-rules-insight-service';
import { RULES_INSIGHT_SERVICE_PATH } from '../common/rules-insight/rules-insight.consts';
import { RulesInsightService } from '../common/rules-insight/rules-insight.types';

import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { IngotAccountBackend } from './account/ingot-account-backend';
import { AccountDeepLinkEndpoint } from './account/account-deeplink-endpoint';
import { ACCOUNT_SERVICE_PATH, AccountBackend, type AccountClient } from '../common/account/account-protocol';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    // Dev preview only: keep secrets in a 0600 file instead of the OS keychain (no keychain prompt after each rebuild).
    const devKeyStore = process.env[DEV_FILE_KEYSTORE_ENV];
    if (devKeyStore) {
        rebind(KeyStoreService).toConstantValue(new DevFileKeyStoreService(devKeyStore));
        console.warn(`Ingot dev build: secrets are stored in a local file (${DEV_FILE_KEYSTORE_ENV}), not the OS keychain.`);
    }
    bind(IngotWorkspaceFileService).toSelf().inSingletonScope();
    rebind(WorkspaceFileService).toService(IngotWorkspaceFileService);
    bind(IngotPortsService).toSelf().inSingletonScope();
    bind(PortsService).toService(IngotPortsService);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler(PORTS_SERVICE_PATH, () => ctx.container.get<PortsService>(PortsService))).inSingletonScope();
    bind(IngotAgentActionsService).toSelf().inSingletonScope();
    bind(AgentActionsService).toService(IngotAgentActionsService);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler(AGENT_ACTIONS_SERVICE_PATH, () => ctx.container.get<AgentActionsService>(AgentActionsService))).inSingletonScope();
    bind(BrowserProxyEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(BrowserProxyEndpoint);
    bind(ErrorReportingEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(ErrorReportingEndpoint);
    // IDEA-170: the desktop backend stops (with its whole process tree) when the Electron main process goes away.
    bind(ParentWatchContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(ParentWatchContribution);
    bind(PluginHostWatchdog).toSelf().inSingletonScope();
    bind(PluginHostEnvironmentVariable).toService(PluginHostWatchdog);
    bind(IngotProcessService).toSelf().inSingletonScope();
    bind(ProcessService).toService(IngotProcessService);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler<ProcessClient>(PROCESS_SERVICE_PATH, client => {
        const service = ctx.container.get(IngotProcessService);
        service.setClient(client);
        client.onDidCloseConnection(() => service.removeClient(client));
        return service;
    })).inSingletonScope();
    bind(IngotAccountBackend).toSelf().inSingletonScope();
    bind(AccountBackend).toService(IngotAccountBackend);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler<AccountClient>(ACCOUNT_SERVICE_PATH, client => {
        const backend = ctx.container.get(IngotAccountBackend);
        backend.setClient(client);
        client.onDidCloseConnection(() => backend.removeClient(client));
        return backend;
    })).inSingletonScope();
    bind(AccountDeepLinkEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(AccountDeepLinkEndpoint);
    bind(IngotModelService).toSelf().inSingletonScope();
    bind(ModelService).toService(IngotModelService);
    bind(IngotEditorImportService).toSelf().inSingletonScope();
    bind(EditorImportService).toService(IngotEditorImportService);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler(EDITOR_IMPORT_SERVICE_PATH, () => ctx.container.get<EditorImportService>(EditorImportService))).inSingletonScope();
    bind(IngotZaprexDesktopService).toSelf().inSingletonScope();
    bind(ZaprexDesktopService).toService(IngotZaprexDesktopService);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler(ZAPREX_DESKTOP_PATH, () => ctx.container.get<ZaprexDesktopService>(ZaprexDesktopService))).inSingletonScope();
    bind(IngotGitService).toSelf().inSingletonScope();
    bind(GitService).toService(IngotGitService);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler(GIT_SERVICE_PATH, () => ctx.container.get<GitService>(GitService))).inSingletonScope();
    bind(IngotMcpService).toSelf().inSingletonScope();
    bind(McpService).toService(IngotMcpService);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler(MCP_SERVICE_PATH, () => ctx.container.get<McpService>(McpService))).inSingletonScope();
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler(MODEL_SERVICE_PATH, () => ctx.container.get<ModelService>(ModelService))).inSingletonScope();
    bind(IngotDebugToolsService).toSelf().inSingletonScope();
    bind(DebugToolsService).toService(IngotDebugToolsService);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler(DEBUG_TOOLS_SERVICE_PATH, () => ctx.container.get<DebugToolsService>(DebugToolsService))).inSingletonScope();
    bind(IngotRulesInsightService).toSelf().inSingletonScope();
    bind(RulesInsightService).toService(IngotRulesInsightService);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler(RULES_INSIGHT_SERVICE_PATH, () => ctx.container.get<RulesInsightService>(RulesInsightService))).inSingletonScope();
});
