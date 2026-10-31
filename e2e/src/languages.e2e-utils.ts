import { expect, type Locator, type Page } from '@playwright/test';
import { actUntilVisible } from './app.utils';

/** IDEA-313: what the Languages page says about this machine, read once per spec. */
export interface LanguageSupport {
    /** `<language>/<feature>` → feature state (ready, needs-toolchain, …). */
    readonly features: Readonly<Record<string, string>>;
    /** Toolchain id → usable here. */
    readonly toolchains: Readonly<Record<string, boolean>>;
}

export const LANGUAGES_PAGE = '#ingot-languages';
export const OUTPUT_VIEW = '#outputView';
export const RUN_FILE_KEY = 'Control+Alt+Shift+F9';
export const LANGUAGES_KEY = 'Control+Alt+Shift+L';
export const LANGUAGE_IDS = [
    'php', 'cobol', 'javascript', 'java', 'cpp', 'python', 'go', 'rust', 'csharp', 'ruby', 'kotlin', 'swift', 'dart', 'sql', 'html', 'shell', 'yaml', 'json', 'markdown'
] as const;
/** Language servers start on first use; Java and COBOL boot a JVM. */
export const SERVER_TIMEOUT_MS = 120_000;
export const RUN_TIMEOUT_MS = 90_000;

/** A toast (the notification center keeps a hidden copy of each one). */
export const notification = (page: Page, text: string | RegExp): Locator => page.locator('.theia-notification-toasts .theia-notification-list-item', { hasText: text });

export const openLanguagesPage = async (page: Page): Promise<Locator> => {
    const root = page.locator(LANGUAGES_PAGE);
    await actUntilVisible(() => page.keyboard.press(LANGUAGES_KEY), root);
    await expect(root.locator('.ingot-lang-row')).toHaveCount(LANGUAGE_IDS.length, { timeout: 60_000 });
    return root;
};

export const closeSettings = async (page: Page): Promise<void> => {
    await page.locator('#ingot-settings-cancel').click();
    await expect(page.locator('#ingot-settings')).toBeHidden();
};

export const readSupport = async (page: Page): Promise<LanguageSupport> => {
    const root = await openLanguagesPage(page);
    const features = await root.locator('.ingot-lang-row').evaluateAll(rows => Object.fromEntries(rows.flatMap(row =>
        Array.from(row.querySelectorAll<HTMLElement>('[data-feature]')).map(cell => [`${row.getAttribute('data-language')}/${cell.dataset.feature}`, cell.dataset.state ?? '']))));
    const toolchains = await root.locator('.ingot-toolchain').evaluateAll(items => Object.fromEntries(items.map(item =>
        [item.getAttribute('data-toolchain') ?? '', item.getAttribute('data-found') === 'true'])));
    await closeSettings(page);
    return { features, toolchains };
};

export const editorTab = (page: Page, label: string): Locator => page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: label });
export const activeEditor = (page: Page): Locator => page.locator('#theia-main-content-panel .lm-DockPanel-widget:not(.lm-mod-hidden) .monaco-editor').first();

const fileInput = (page: Page): Locator => page.locator('.quick-input-widget .quick-input-box input');
const fileOptions = (page: Page): Locator => page.locator('.quick-input-widget .monaco-list-row');

const PICK_ATTEMPT_MS = 5_000;
const PICK_TIMEOUT_MS = 60_000;

/** Go to File (Ctrl+Shift+N) like a user: type the name, pick it. The picker can close under the click, so the whole pick is retried. */
export const goToFile = async (page: Page, name: string): Promise<void> => {
    await expect(async () => {
        if (await fileInput(page).isVisible()) {
            await page.keyboard.press('Escape');
        }
        await actUntilVisible(() => page.keyboard.press('Control+Shift+N'), fileInput(page));
        await page.keyboard.type(name);
        await fileOptions(page).filter({ hasText: name, visible: true }).first().click({ timeout: PICK_ATTEMPT_MS });
    }).toPass({ timeout: PICK_TIMEOUT_MS });
    await expect(editorTab(page, name).first()).toBeVisible();
};

/** Distinct token colours in the visible editor lines: plain text is one (`mtk1`), a grammar adds more. */
export const tokenClasses = async (page: Page): Promise<number> =>
    activeEditor(page).locator('.view-lines span[class^="mtk"]').evaluateAll(spans => new Set(spans.map(s => s.className)).size);

/** The token span showing `word`, quoted or not, maybe with the spaces around it (the last one: usually a call site). */
export const tokenSpan = (page: Page, word: string): Locator =>
    activeEditor(page).locator('.view-lines span[class^="mtk"]').filter({ hasText: new RegExp(`^\\s*["']?${word}["']?\\s*$`) }).last();

/** The text of the Output view (the Run channel's editor); Monaco renders spaces as non-breaking ones. */
export const outputText = async (page: Page): Promise<string> =>
    (await page.locator(`${OUTPUT_VIEW} .view-lines`).innerText().catch(() => '')).replace(/\u00a0/g, ' ');

/** Theia renders editor hovers and suggestions in an overflow layer outside `.monaco-editor`. */
const HOVER = '.monaco-hover:not(.hidden)';
const SUGGESTIONS = '.suggest-widget .monaco-list-row';
/** One attempt; the whole check retries until the language server answers. */
const ATTEMPT_MS = 5_000;
/** Monaco's selection highlight, drawn once a double-click has selected the word. */
const SELECTION = '.view-overlays .selected-text';
const SELECT_ATTEMPT_MS = 1_000;
const SELECT_TIMEOUT_MS = 15_000;

const BLANK_OFFSET_PX = 10;
/** Moves the mouse to the empty space under the text, so the editor sees it leave the word and come back (leaving the editor can keep a stale hover pending). */
const parkMouse = async (page: Page): Promise<void> => {
    const box = await activeEditor(page).locator('.view-lines').boundingBox();
    if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height - BLANK_OFFSET_PX);
    }
};

/** Hovers `word` until the language server shows a hover containing `text`. */
export const expectHover = async (page: Page, word: string, text: string | RegExp): Promise<void> => {
    const token = tokenSpan(page, word);
    await expect(token).toBeVisible();
    await expect(async () => {
        await parkMouse(page);
        await token.hover();
        await expect(page.locator(HOVER, { hasText: text }).first()).toBeVisible({ timeout: ATTEMPT_MS });
    }).toPass({ timeout: SERVER_TIMEOUT_MS });
    await parkMouse(page);
};

/** Replaces `word` with `typed` like a user, asks for completion until `expected` is offered, then undoes the edit. */
export const expectCompletion = async (page: Page, word: string, typed: string, expected: string): Promise<void> => {
    const token = tokenSpan(page, word);
    await expect(token).toBeVisible();
    const lines = activeEditor(page).locator('.view-lines');
    const original = await lines.innerText();
    // A hover left open by an earlier check can swallow the first click, leaving a caret inside the word instead of selecting it.
    await expect(async () => {
        await parkMouse(page);
        await token.dblclick();
        await expect(activeEditor(page).locator(SELECTION).first()).toBeVisible({ timeout: SELECT_ATTEMPT_MS });
    }).toPass({ timeout: SELECT_TIMEOUT_MS });
    await page.keyboard.type(typed);
    try {
        await expect(async () => {
            await page.keyboard.press('Escape');
            await page.keyboard.press('Control+Space');
            await expect(page.locator(SUGGESTIONS, { hasText: expected }).first()).toBeVisible({ timeout: ATTEMPT_MS });
        }).toPass({ timeout: SERVER_TIMEOUT_MS });
    } finally {
        await page.keyboard.press('Escape');
        await expect(async () => {
            await page.keyboard.press('Control+Z');
            expect(await lines.innerText()).toBe(original);
        }).toPass({ timeout: 15_000 });
    }
};
