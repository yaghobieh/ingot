import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { PORTS_SERVICE_PATH } from '../common/ports/ports.consts';
import { PortsService } from '../common/ports/ports.types';
import { IngotPortsService } from './ingot-ports-service';
import { WorkspaceFileService } from '@theia/workspace/lib/common/workspace-file-service';
import { IngotWorkspaceFileService } from '../common/workspace/ingot-workspace-file-service';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(IngotWorkspaceFileService).toSelf().inSingletonScope();
    rebind(WorkspaceFileService).toService(IngotWorkspaceFileService);
    bind(IngotPortsService).toSelf().inSingletonScope();
    bind(PortsService).toService(IngotPortsService);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler(PORTS_SERVICE_PATH, () => ctx.container.get<PortsService>(PortsService))).inSingletonScope();
});
