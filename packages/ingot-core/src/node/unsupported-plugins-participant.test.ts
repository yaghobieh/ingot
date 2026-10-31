import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { findUnsupportedPlugins } from './unsupported-plugins-participant';

const writePlugin = (root: string, folder: string, manifest: object, relative = 'package.json'): void => {
    const file = path.join(root, folder, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(manifest));
};

describe('findUnsupportedPlugins', () => {
    it('lists deployed remote-resolver plugins (Remote - SSH, Dev Containers) and nothing else', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-deployed-'));
        writePlugin(root, 'anysphere.remote-ssh-1.1.17', { publisher: 'anysphere', name: 'remote-ssh', enabledApiProposals: ['resolvers', 'tunnels'] });
        writePlugin(root, 'anysphere.remote-containers-1.0.41', { publisher: 'anysphere', name: 'remote-containers', enabledApiProposals: ['resolvers'] }, 'extension/package.json');
        writePlugin(root, 'eamodio.gitlens@2026.10.300511', { publisher: 'eamodio', name: 'gitlens', enabledApiProposals: ['terminalDataWriteEvent'] });
        writePlugin(root, 'vscode.sql@1.95.3', { publisher: 'vscode', name: 'sql' });
        fs.mkdirSync(path.join(root, 'empty-folder'));
        fs.writeFileSync(path.join(root, 'stray.txt'), '');
        expect(findUnsupportedPlugins(root).sort()).toEqual(['anysphere.remote-containers', 'anysphere.remote-ssh']);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('returns nothing when the folder does not exist', () => {
        expect(findUnsupportedPlugins(path.join(os.tmpdir(), 'ingot-no-such-dir', 'deployedPlugins'))).toEqual([]);
    });
});
