import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications } from '../src/app.utils';
import { setAppearance } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { APP_READY_TIMEOUT_MS, SHELL_SELECTOR } from '../src/e2e.consts';
import {
    AQ_BASE_URL, AQ_MODEL_ID, AQ_PROMPT, AQ_REPORT_DIR, AQ_SHOTS_DIR, AQ_TARGET, ASK_ANSWER, CONTINUE_PROMPT, IDLE_SETTLE_MS, MAX_CONTINUES,
    RUN_TIMEOUT_MS, TOOL_ROUNDS_STOP_TEXT, TRACE_POLL_MS, VERIFY_TIMEOUT_MS
} from '../src/agent-quality.consts';
import { budgetLine, checkBudget, resolveOpenRouterKey } from '../src/agent-quality.budget';
import { TracePrinter, type TraceSnapshot } from '../src/agent-quality.trace';
import { findApps, reportLines, verifyLibrary } from '../src/agent-quality.verify';

const TRACE_GLOBAL = 'ingotAgentTrace';
const BUSY = new Set(['thinking', 'editing', 'approval', 'paused']);

const readTrace = (page: Page): Promise<TraceSnapshot | undefined> =>
    page.evaluate(name => (window as unknown as Record<string, () => TraceSnapshot | undefined>)[name]?.(), TRACE_GLOBAL);

const say = async (page: Page, text: string): Promise<void> => {
    await page.locator('#ingot-composer-input').fill(text);
    await page.locator('#ingot-composer-input').press('Enter');
};

/** True when the agent stopped short: out of tool rounds, an error, or no installed apps yet. */
const stoppedShort = (trace: TraceSnapshot): boolean => {
    const last = [...trace.messages].reverse().find(message => message.role === 'system');
    const { client, server } = findApps(AQ_TARGET);
    const installed = [client, server].every(app => app && fs.existsSync(path.join(AQ_TARGET, app, 'node_modules')));
    return trace.status === 'error' || !!last?.text.startsWith(TOOL_ROUNDS_STOP_TEXT) || !installed;
};

test.describe('agent quality: real model builds the library app (IDEA-282)', () => {
    test('creates, installs, builds and tests both apps, and the API answers', async ({ page }) => {
        test.setTimeout(RUN_TIMEOUT_MS + VERIFY_TIMEOUT_MS);
        const key = resolveOpenRouterKey();
        const before = key ? await checkBudget(key) : undefined;
        const started = Date.now();

        await page.goto(`${AQ_BASE_URL}/#${AQ_TARGET}`);
        await expect(page.locator(SHELL_SELECTOR)).toBeVisible({ timeout: APP_READY_TIMEOUT_MS });
        await expect(page.locator('.theia-preload')).toHaveCount(0, { timeout: APP_READY_TIMEOUT_MS });
        await dismissNotifications(page);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, AQ_MODEL_ID);
        console.log(`── prompt (${AQ_MODEL_ID}): ${AQ_PROMPT}`);
        await say(page, AQ_PROMPT);

        const printer = new TracePrinter();
        let continues = 0;
        let idleSince = 0;
        let answered = '';
        let trace: TraceSnapshot | undefined;
        while (Date.now() - started < RUN_TIMEOUT_MS) {
            trace = await readTrace(page);
            if (trace) {
                printer.next(trace).forEach(line => console.log(line));
            }
            if (await page.locator('#ingot-approval-run').isVisible().catch(() => false)) {
                await page.locator('#ingot-approval-run').click();
            }
            if (trace?.ask && trace.ask !== answered) {
                answered = trace.ask;
                await say(page, ASK_ANSWER);
            }
            const busy = !!trace && (trace.running || BUSY.has(trace.status));
            if (busy || !trace) {
                idleSince = 0;
            } else if (!idleSince) {
                idleSince = Date.now();
            } else if (Date.now() - idleSince > IDLE_SETTLE_MS) {
                if (continues >= MAX_CONTINUES || !stoppedShort(trace)) {
                    break;
                }
                continues++;
                idleSince = 0;
                console.log(`── harness: continue ${continues} of ${MAX_CONTINUES}`);
                await say(page, CONTINUE_PROMPT);
            }
            await page.waitForTimeout(TRACE_POLL_MS);
        }
        const agentMinutes = (Date.now() - started) / 60_000;

        fs.mkdirSync(AQ_SHOTS_DIR, { recursive: true });
        await setAppearance(page, 'dark');
        await page.screenshot({ path: path.join(AQ_SHOTS_DIR, 'agent-quality-library-dark.png') });
        await setAppearance(page, 'light');
        await page.screenshot({ path: path.join(AQ_SHOTS_DIR, 'agent-quality-library-light.png') });

        const report = await verifyLibrary(AQ_TARGET);
        reportLines(report).forEach(line => console.log(line));
        const after = key ? await checkBudget(key) : undefined;
        if (after) {
            console.log(`── ${budgetLine(after)}; this run ≈ $${(after.usage - (before?.usage ?? after.usage)).toFixed(2)}`);
        }
        const rounds = trace?.messages.filter(message => message.role === 'agent').length ?? 0;
        const tools = trace?.messages.filter(message => message.role === 'tool').length ?? 0;
        console.log(`── agent: ${agentMinutes.toFixed(1)} min, ${rounds} replies, ${tools} tool results, ${continues} continue(s), final status ${trace?.status ?? '-'}`);
        fs.mkdirSync(AQ_REPORT_DIR, { recursive: true });
        fs.writeFileSync(path.join(AQ_REPORT_DIR, `run-${new Date(started).toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({
            model: AQ_MODEL_ID, prompt: AQ_PROMPT, agentMinutes, rounds, tools, continues, status: trace?.status,
            costUsd: after && before ? after.usage - before.usage : undefined, report, trace
        }, undefined, 2));
        expect(report.checks.filter(check => !check.ok).map(check => check.name)).toEqual([]);
    });
});
