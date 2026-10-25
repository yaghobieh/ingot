import { expect, type Page } from '@playwright/test';
import { runCommand } from './app.utils';
import type { FakeOllama } from './fake-ollama';

export const modelsPanel = (page: Page) => page.locator('#ingot-models');

/** Points the Ollama provider at the fake server and checks the connection through the UI. */
export const connectOllama = async (page: Page, server: FakeOllama): Promise<void> => {
    await runCommand(page, 'Ingot: Models');
    await expect(modelsPanel(page)).toBeVisible();
    await modelsPanel(page).locator('#ingot-model-ollama-url').fill(server.url);
    await modelsPanel(page).locator('#ingot-model-override-ollama').fill('e2e-coder');
    await modelsPanel(page).locator('#ingot-model-override-ollama').press('Tab');
    await modelsPanel(page).locator('#ingot-model-test-ollama').click();
    await expect(modelsPanel(page).locator('#ingot-model-result-ollama')).toHaveText('Connected (e2e-coder)');
};
