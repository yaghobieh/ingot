import { describe, expect, it } from 'vitest';
import { isElectronForkedBackend, isParentGone, isProcessAlive } from './lifecycle.utils';

describe('isParentGone', () => {
    it('is false while the original parent is alive', () => {
        expect(isParentGone(4321, 4321, () => true)).toBe(false);
    });
    it('is true when re-parented (Linux/macOS orphan)', () => {
        expect(isParentGone(4321, 1, () => true)).toBe(true);
    });
    it('is true when the original parent no longer exists (Windows keeps the ppid)', () => {
        expect(isParentGone(4321, 4321, () => false)).toBe(true);
    });
    it('never treats init as a parent to follow', () => {
        expect(isParentGone(1, 1, () => false)).toBe(false);
    });
});

describe('isProcessAlive', () => {
    const err = (code: string) => () => { throw Object.assign(new Error(code), { code }); };
    it('alive when the probe succeeds', () => expect(isProcessAlive(10, () => undefined)).toBe(true));
    it('gone on ESRCH', () => expect(isProcessAlive(10, err('ESRCH'))).toBe(false));
    it('alive on EPERM (exists, not ours)', () => expect(isProcessAlive(10, err('EPERM'))).toBe(true));
});

describe('isElectronForkedBackend', () => {
    it('needs both the IPC channel and the Electron marker', () => {
        expect(isElectronForkedBackend({ M: '42.0.0' }, true, 'M')).toBe(true);
        expect(isElectronForkedBackend({}, true, 'M')).toBe(false);
        expect(isElectronForkedBackend({ M: '42.0.0' }, false, 'M')).toBe(false);
    });
});
