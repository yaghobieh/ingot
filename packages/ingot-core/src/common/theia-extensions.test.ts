import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('theiaExtensions', () => {
    // In Electron, an entry's frontendElectron REPLACES its frontend module, which silently drops the whole Ingot UI.
    it('keeps frontendElectron in its own entry so the browser frontend module also loads in Electron', () => {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as { theiaExtensions: Record<string, string>[] };
        expect(pkg.theiaExtensions.some(e => e.frontend)).toBe(true);
        for (const entry of pkg.theiaExtensions) {
            expect(entry.frontendElectron && entry.frontend).toBeFalsy();
        }
    });
});
