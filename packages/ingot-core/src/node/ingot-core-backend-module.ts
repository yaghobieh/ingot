import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { PORTS_SERVICE_PATH } from '../common/ports/ports.consts';
import { PortsService } from '../common/ports/ports.types';
import { IngotPortsService } from './ingot-ports-service';

export default new ContainerModule(bind => {
    bind(IngotPortsService).toSelf().inSingletonScope();
    bind(PortsService).toService(IngotPortsService);
    bind(ConnectionHandler).toDynamicValue(ctx => new RpcConnectionHandler(PORTS_SERVICE_PATH, () => ctx.container.get<PortsService>(PortsService))).inSingletonScope();
});
