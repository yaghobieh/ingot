import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { LANGUAGE_FIXTURES } from '../src/e2e.consts';
import {
    activeEditor, expectCompletion, expectHover, goToFile, type LanguageSupport, notification, outputText, readSupport, RUN_FILE_KEY, RUN_TIMEOUT_MS,
    SERVER_TIMEOUT_MS, tokenClasses
} from '../src/languages.e2e-utils';

/**
 * IDEA-313: every language opens with highlighting, gets completion and hover from its language server when the server can run here,
 * and runs with Run Current File, or offers to install the missing toolchain instead of failing.
 */
interface LanguageCase {
    readonly language: string;
    readonly label: string;
    readonly file: string;
    /** Replace `token` with `typed`; completion must offer `expected`. */
    readonly completion?: { readonly token: string; readonly typed: string; readonly expected: string };
    /** Hover `token`; the hover must contain `text` (the token by default). */
    readonly hover?: { readonly token: string; readonly text?: string | RegExp };
    /** Not set: the file type has no Run command. */
    readonly runs?: boolean;
    readonly shots?: boolean;
}

const GREET = { token: 'greet', typed: 'gre', expected: 'greet' };
const CASES: readonly LanguageCase[] = [
    { language: 'php', label: 'PHP', file: 'hello.php', completion: { token: 'greet', typed: 'str_', expected: 'str_repeat' }, hover: { token: 'trim' }, runs: true },
    { language: 'cobol', label: 'COBOL', file: 'hello.cbl', completion: { token: 'DISPLAY', typed: 'DISP', expected: 'DISPLAY' }, hover: { token: 'WS-NAME' }, runs: true },
    { language: 'javascript', label: 'TypeScript', file: 'hello.ts', completion: GREET, hover: { token: 'greet' }, runs: true, shots: true },
    { language: 'java', label: 'Java', file: 'Hello.java', completion: GREET, hover: { token: 'greet' }, runs: true, shots: true },
    { language: 'cpp', label: 'C++', file: 'hello.cpp', completion: GREET, hover: { token: 'greet' }, runs: true },
    { language: 'python', label: 'Python', file: 'hello.py', completion: GREET, hover: { token: 'greet' }, runs: true, shots: true },
    { language: 'go', label: 'Go', file: 'hello.go', completion: { token: 'Greet', typed: 'Gre', expected: 'Greet' }, hover: { token: 'Greet' }, runs: true },
    { language: 'rust', label: 'Rust', file: 'main.rs', completion: GREET, hover: { token: 'greet' }, runs: true },
    { language: 'csharp', label: 'C#', file: 'Program.cs', completion: { token: 'Greet', typed: 'Gre', expected: 'Greet' }, hover: { token: 'Greet' }, runs: true },
    { language: 'ruby', label: 'Ruby', file: 'hello.rb', completion: GREET, hover: { token: 'greet' }, runs: true },
    { language: 'kotlin', label: 'Kotlin', file: 'hello.kt', completion: GREET, hover: { token: 'greet' }, runs: true },
    { language: 'swift', label: 'Swift', file: 'hello.swift', completion: GREET, hover: { token: 'greet' }, runs: true },
    { language: 'dart', label: 'Dart', file: 'hello.dart', completion: GREET, hover: { token: 'greet' }, runs: true, shots: true },
    { language: 'sql', label: 'SQL', file: 'query.sql', runs: true },
    { language: 'html', label: 'HTML', file: 'index.html', completion: { token: 'h1', typed: 'h', expected: 'h1' }, hover: { token: 'h1' } },
    { language: 'html', label: 'CSS', file: 'style.css', completion: { token: 'color', typed: 'col', expected: 'color' }, hover: { token: 'color' } },
    { language: 'shell', label: 'Shell', file: 'hello.sh', completion: GREET, hover: { token: 'greet' }, runs: true },
    { language: 'yaml', label: 'YAML', file: 'config.yaml', completion: { token: 'greeting', typed: 'cou', expected: 'count' }, hover: { token: 'greeting', text: 'Text the fixture prints' } },
    { language: 'json', label: 'JSON', file: 'data.json', completion: { token: 'greeting', typed: 'lan', expected: 'languages' }, hover: { token: 'greeting', text: 'Text the fixture prints' } },
    { language: 'markdown', label: 'Markdown', file: 'notes.md' }
];

const HELLO = 'Hello, Ingot!';
const EXIT_OK = 'Process finished with exit code 0';
const NO_RUN = 'Ingot has no Run command for this file type.';
/** Missing and too old toolchains both end with the install command. */
const INSTALL_PROMPT = 'Install it with:';
/** Plain text is one token colour; a grammar adds keywords, strings, names… */
const MIN_TOKEN_COLOURS = 3;

let support: LanguageSupport;
let page: Page;

/** Why a feature can't be checked on this machine, or undefined when it can. */
const unavailable = (item: LanguageCase, feature: 'completion' | 'hover'): string | undefined => {
    if (!item[feature]) {
        return `${item.label}: the fixture has nothing to check ${feature} on (links and headers only).`;
    }
    const state = support.features[`${item.language}/${feature}`];
    return state === 'ready' ? undefined
        : `${item.label} ${feature} is "${state}" on this machine (see Settings › Languages & Frameworks); install the toolchain to check it.`;
};

const focusEditor = async (): Promise<void> => {
    await activeEditor(page).locator('.view-lines').click({ position: { x: 5, y: 5 } });
};

test.describe('IDEA-313 language editing and Run Current File', () => {
    test.setTimeout(SERVER_TIMEOUT_MS * 3);

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        await openIngot(page, LANGUAGE_FIXTURES);
        await dismissNotifications(page);
        support = await readSupport(page);
    });

    test.afterAll(async () => {
        await page?.close();
    });

    for (const item of CASES) {
        test.describe(`${item.label} (${item.file})`, () => {
            test('opens with highlighting', async () => {
                await dismissNotifications(page);
                await goToFile(page, item.file);
                await expect.poll(() => tokenClasses(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(MIN_TOKEN_COLOURS);
                if (item.shots) {
                    await shot(page, `idea-313-${item.language}-light.png`);
                    await setAppearance(page, 'dark');
                    await shot(page, `idea-313-${item.language}-dark.png`);
                    await setAppearance(page, 'light');
                }
            });

            test('hover from the language server', async () => {
                const reason = unavailable(item, 'hover');
                test.skip(reason !== undefined, reason);
                await goToFile(page, item.file);
                await dismissNotifications(page);
                await expectHover(page, item.hover!.token, item.hover!.text ?? item.hover!.token);
            });

            test('completion from the language server', async () => {
                const reason = unavailable(item, 'completion');
                test.skip(reason !== undefined, reason);
                await goToFile(page, item.file);
                await dismissNotifications(page);
                const { token, typed, expected } = item.completion!;
                await expectCompletion(page, token, typed, expected);
            });

            test('Run Current File runs it or offers to install the toolchain', async () => {
                await goToFile(page, item.file);
                await dismissNotifications(page);
                await focusEditor();
                await page.keyboard.press(RUN_FILE_KEY);
                if (!item.runs) {
                    await expect(notification(page, NO_RUN)).toBeVisible();
                    return;
                }
                if (support.features[`${item.language}/run`] !== 'ready') {
                    await expect(notification(page, INSTALL_PROMPT).first()).toBeVisible({ timeout: 30_000 });
                    return;
                }
                await expect.poll(() => outputText(page), { timeout: RUN_TIMEOUT_MS }).toContain(EXIT_OK);
                expect(await outputText(page)).toContain(HELLO);
            });
        });
    }
});
