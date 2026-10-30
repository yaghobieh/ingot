import { DEV_FILE_KEYSTORE_ENV, MOCK_KEYCHAIN_SWITCH } from './keychain.consts';

/** Dev and test launches (file key store set) must never touch the OS keychain, Chromium's included. */
export const needsMockKeychain = (env: Readonly<Record<string, string | undefined>>, hasSwitch: (name: string) => boolean): boolean =>
    !!env[DEV_FILE_KEYSTORE_ENV] && !hasSwitch(MOCK_KEYCHAIN_SWITCH);
