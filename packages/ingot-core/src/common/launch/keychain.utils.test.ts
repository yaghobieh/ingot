import { describe, expect, it } from 'vitest';
import { DEV_FILE_KEYSTORE_ENV, MOCK_KEYCHAIN_SWITCH } from './keychain.consts';
import { needsMockKeychain } from './keychain.utils';

describe('mock keychain for dev and test launches', () => {
    const none = (): boolean => false;

    it('is needed when the file key store is set and the switch is missing', () => {
        expect(needsMockKeychain({ [DEV_FILE_KEYSTORE_ENV]: '/tmp/ingot/keystore.json' }, none)).toBe(true);
    });

    it('is not added twice', () => {
        expect(needsMockKeychain({ [DEV_FILE_KEYSTORE_ENV]: '/tmp/ingot/keystore.json' }, name => name === MOCK_KEYCHAIN_SWITCH)).toBe(false);
    });

    it('leaves release launches on the real keychain', () => {
        expect(needsMockKeychain({}, none)).toBe(false);
        expect(needsMockKeychain({ [DEV_FILE_KEYSTORE_ENV]: '' }, none)).toBe(false);
    });
});
