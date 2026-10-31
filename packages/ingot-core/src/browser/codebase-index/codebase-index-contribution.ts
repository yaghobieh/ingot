import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { INDEX_COMMANDS } from '../../common/codebase-index/codebase-index.consts';
import { CodebaseIndexStore } from './codebase-index-store';

/** IDEA-260: starts the codebase index for the open project and adds Rebuild Codebase Index. */
@injectable()
export class CodebaseIndexContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(CodebaseIndexStore) protected readonly store: CodebaseIndexStore;

    onStart(): void {
        void this.store.start();
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(INDEX_COMMANDS.rebuild, { execute: () => this.store.rebuild(), isEnabled: () => this.store.enabled });
    }
}
