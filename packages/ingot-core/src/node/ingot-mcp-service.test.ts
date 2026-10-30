import { describe, expect, it } from 'vitest';
import type { KeyStoreService } from '@theia/core/lib/common/key-store';
import { IngotMcpService } from './ingot-mcp-service';

const makeService = (): { service: IngotMcpService; store: Map<string, string> } => {
    const store = new Map<string, string>();
    const keyStore = {
        setPassword: async (_service: string, account: string, value: string) => { store.set(account, value); },
        getPassword: async (_service: string, account: string) => store.get(account),
        deletePassword: async (_service: string, account: string) => store.delete(account)
    } as unknown as KeyStoreService;
    const service = new IngotMcpService();
    (service as unknown as { keyStore: KeyStoreService }).keyStore = keyStore;
    return { service, store };
};

describe('IngotMcpService secrets', () => {
    it('stores env secrets and IDEA-270 header secrets (Slack Authorization) in the keychain', async () => {
        const { service, store } = makeService();
        await service.setSecret('github', 'GITHUB_TOKEN', 'ghp_x');
        await service.setSecret('slack', 'header:Authorization', 'Bearer xoxp-1');
        expect(store.get('mcp:github:GITHUB_TOKEN')).toBe('ghp_x');
        expect(store.get('mcp:slack:header:Authorization')).toBe('Bearer xoxp-1');
        await service.deleteSecrets('slack', ['header:Authorization']);
        expect(store.has('mcp:slack:header:Authorization')).toBe(false);
    });

    it('rejects names that are not env vars or header secrets', async () => {
        const { service } = makeService();
        await expect(service.setSecret('slack', 'header:Bad Header', 'x')).rejects.toThrow('Invalid MCP secret name.');
        await expect(service.setSecret('slack', 'a:b', 'x')).rejects.toThrow('Invalid MCP secret name.');
        await expect(service.setSecret('../slack', 'TOKEN', 'x')).rejects.toThrow('Invalid MCP secret name.');
    });
});
