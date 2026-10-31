import { describe, expect, it } from 'vitest';
import { zaprexLaunchSteps } from './zaprex-launch.utils';

describe('IDEA-266 zaprexLaunchSteps', () => {
    it('macOS asks Launch Services first, then the bundle in /Applications and ~/Applications', () => {
        expect(zaprexLaunchSteps({ platform: 'mac', home: '/Users/me' })).toEqual([
            { cmd: 'open', args: ['-a', 'Zaprex'] },
            { cmd: 'open', args: ['/Applications/Zaprex.app'], requires: '/Applications/Zaprex.app' },
            { cmd: 'open', args: ['/Users/me/Applications/Zaprex.app'], requires: '/Users/me/Applications/Zaprex.app' }
        ]);
    });

    it('Windows starts the installed exe (per-user install first), detached', () => {
        const steps = zaprexLaunchSteps({ platform: 'windows', home: 'C:\\Users\\me', localAppData: 'C:\\Users\\me\\AppData\\Local\\', programFiles: 'C:\\Program Files' });
        expect(steps.map(s => s.cmd)).toEqual(['C:\\Users\\me\\AppData\\Local\\Programs\\Zaprex\\Zaprex.exe', 'C:\\Program Files\\Zaprex\\Zaprex.exe']);
        expect(steps.every(s => s.detached && s.requires === s.cmd)).toBe(true);
    });

    it('Windows without known folders has nothing to start (the caller falls back to the website)', () => {
        expect(zaprexLaunchSteps({ platform: 'windows', home: 'C:\\Users\\me' })).toEqual([]);
    });

    it('Linux tries the zaprex binary, then the desktop entry', () => {
        const steps = zaprexLaunchSteps({ platform: 'linux', home: '/home/me' });
        expect(steps[0]).toEqual({ cmd: '/home/me/.local/bin/zaprex', args: [], requires: '/home/me/.local/bin/zaprex', detached: true });
        expect(steps.map(s => s.cmd)).toContain('/usr/bin/zaprex');
        expect(steps.at(-1)).toEqual({ cmd: 'gtk-launch', args: ['zaprex'] });
    });
});
