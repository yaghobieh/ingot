/** Env var that switches a dev or test launch to the file key store. Never set for release builds. */
export const DEV_FILE_KEYSTORE_ENV = 'INGOT_DEV_FILE_KEYSTORE';

/** Chromium switch (macOS): its own cookie / safe-storage encryption skips the login keychain, so no keychain prompt. */
export const MOCK_KEYCHAIN_SWITCH = 'use-mock-keychain';
