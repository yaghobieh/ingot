import * as fs from 'fs';
import * as path from 'path';
import type { Locator, Page } from '@playwright/test';
import { CLOUD_ARTIFACTS_DIR } from './e2e.consts';

/** Saves a screenshot for cloud runs; where the artifacts folder cannot be created (local runs) it is skipped. */
export const saveArtifact = async (target: Page | Locator, name: string): Promise<void> => {
    try {
        fs.mkdirSync(CLOUD_ARTIFACTS_DIR, { recursive: true });
    } catch {
        return;
    }
    await target.screenshot({ path: path.join(CLOUD_ARTIFACTS_DIR, name), animations: 'disabled' });
};
