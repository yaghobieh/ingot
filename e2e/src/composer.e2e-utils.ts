import type { Page } from '@playwright/test';

/** The inline composer (IDEA-98): a contenteditable with chips inside the text. */
export const COMPOSER = '#ingot-composer-input';

/** The composer's typed text with chips left out (non-breaking spaces as spaces, trimmed). */
export const composerPlainText = (page: Page): Promise<string> => page.locator(COMPOSER).evaluate(el => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[data-chip-id]').forEach(n => n.remove());
    return (copy.innerText || copy.textContent || '').replace(/\u00a0/g, ' ').replace(/\n+$/, '').trim();
});
