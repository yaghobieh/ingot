import { describe, expect, it } from 'vitest';
import { formatDownloads, pluginKinds, unversionedId, validatePluginManifest } from './plugins.utils';

describe('plugins', () => {
    it('formats ids and download counts', () => {
        expect(unversionedId('ingot.night@1.0.0')).toBe('ingot.night');
        expect(formatDownloads(950)).toBe('950');
        expect(formatDownloads(1_500)).toBe('1.5K');
        expect(formatDownloads(25_300)).toBe('25K');
        expect(formatDownloads(2_000_000)).toBe('2M');
        expect(formatDownloads(undefined)).toBe('');
    });

    it('validates plugin folders', () => {
        const ok = JSON.stringify({ name: 'night', publisher: 'Me', version: '0.1.0', engines: { vscode: '^1.80.0' } });
        expect(validatePluginManifest(ok)).toEqual({ id: 'me.night', folder: 'me.night-0.1.0' });
        expect(() => validatePluginManifest('{')).toThrow(/valid JSON/);
        expect(() => validatePluginManifest('{"name":"x"}')).toThrow(/publisher/);
        expect(() => validatePluginManifest(JSON.stringify({ name: 'x', publisher: 'p', version: '1' }))).toThrow(/engines/);
        expect(() => validatePluginManifest(JSON.stringify({ name: '../x', publisher: 'p', version: '1', engines: { vscode: '*' } }))).toThrow(/letters/);
    });

    it('labels plugin kinds', () => {
        expect(pluginKinds({ themes: 2, iconThemes: 0 })).toEqual(['Theme']);
        expect(pluginKinds(undefined)).toEqual([]);
    });
});
