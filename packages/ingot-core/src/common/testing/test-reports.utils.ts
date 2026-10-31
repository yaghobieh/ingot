/**
 * IDEA-313: reports of the non-JS test runners as one shape. JUnit XML (pytest, PHPUnit, Maven, Gradle, CTest), TRX (dotnet),
 * JSON events (go test, dart test, RSpec) and the verbose text of runners without a built-in report (unittest, cargo, Minitest, swift).
 */
import { stripAnsi } from '../processes/processes.utils';
import { FAILURE_MESSAGE_MAX_CHARS } from './testing.consts';
import type { RawTestCase, TestState } from './testing.types';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HEX = 16;
const DECIMAL = 10;
const XML_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };

const clean = (text: string): string => stripAnsi(text).trim().slice(0, FAILURE_MESSAGE_MAX_CHARS);
const seconds = (value: string | undefined): number | undefined => {
    const n = Number.parseFloat(value ?? '');
    return Number.isFinite(n) ? Math.round(n * MS_PER_SECOND) : undefined;
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const num = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const jsonLines = (output: string): Record<string, unknown>[] => output.split('\n').flatMap(line => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
        return [];
    }
    try {
        return [record(JSON.parse(trimmed))];
    } catch {
        return [];
    }
});

export const decodeXml = (value: string): string => value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, entity: string) => {
        if (entity.startsWith('#x') || entity.startsWith('#X')) {
            return String.fromCodePoint(Number.parseInt(entity.slice(2), HEX));
        }
        if (entity.startsWith('#')) {
            return String.fromCodePoint(Number.parseInt(entity.slice(1), DECIMAL));
        }
        return XML_ENTITIES[entity] ?? all;
    });

export const xmlAttributes = (tag: string): Record<string, string> => {
    const attributes: Record<string, string> = {};
    for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        attributes[match[1]] = decodeXml(match[2] ?? match[3] ?? '');
    }
    return attributes;
};

const elements = (xml: string, name: string): { attributes: Record<string, string>; body: string }[] =>
    [...xml.matchAll(new RegExp(`<${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${name}>)`, 'g'))].map(m => ({ attributes: xmlAttributes(m[1]), body: m[2] ?? '' }));

const innerText = (xml: string, name: string): string => decodeXml(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(xml)?.[1] ?? '');

/** JUnit XML (`<testcase classname name time file line>` with `<failure>` / `<error>` / `<skipped>`). */
export const parseJUnitXml = (xml: string): RawTestCase[] => elements(xml, 'testcase').map(({ attributes, body }) => {
    const failure = elements(body, 'failure')[0] ?? elements(body, 'error')[0];
    const status = attributes.status ?? '';
    const skipped = /<skipped\b/.test(body) || status === 'notrun' || status === 'disabled';
    const state: TestState = failure || status === 'fail' ? 'failed' : skipped ? 'skipped' : 'passed';
    const message = failure ? clean([failure.attributes.message ?? '', decodeXml(failure.body)].filter(Boolean).join('\n')) : '';
    const line = Number.parseInt(attributes.line ?? '', DECIMAL);
    return {
        name: attributes.name ?? '', suite: attributes.classname || undefined, state,
        ...(attributes.file ? { file: attributes.file } : {}), ...(Number.isFinite(line) ? { line } : {}),
        ...(seconds(attributes.time) !== undefined ? { durationMs: seconds(attributes.time) } : {}), ...(message ? { message } : {})
    };
});

/** `00:00:01.2345678` as milliseconds. */
export const trxDuration = (value: string | undefined): number | undefined => {
    const match = /^(\d+):(\d+):([\d.]+)$/.exec(value ?? '');
    if (!match) {
        return undefined;
    }
    return Math.round(((Number(match[1]) * MINUTES_PER_HOUR + Number(match[2])) * SECONDS_PER_MINUTE + Number(match[3])) * MS_PER_SECOND);
};

/** dotnet test's TRX: results joined with their definitions for the class name. */
export const parseTrx = (xml: string): RawTestCase[] => {
    const classes = new Map<string, { className: string; name: string }>();
    for (const { attributes, body } of elements(xml, 'UnitTest')) {
        const method = elements(body, 'TestMethod')[0]?.attributes;
        if (attributes.id && method) {
            classes.set(attributes.id, { className: method.className ?? '', name: method.name ?? '' });
        }
    }
    return elements(xml, 'UnitTestResult').map(({ attributes, body }) => {
        const definition = classes.get(attributes.testId ?? '');
        const outcome = attributes.outcome ?? '';
        const state: TestState = outcome === 'Passed' ? 'passed' : outcome === 'Failed' || outcome === 'Error' || outcome === 'Timeout' ? 'failed' : 'skipped';
        const full = attributes.testName ?? definition?.name ?? '';
        const className = definition?.className ?? '';
        const name = className && full.startsWith(`${className}.`) ? full.slice(className.length + 1) : full;
        const message = state === 'failed' ? clean([innerText(body, 'Message'), innerText(body, 'StackTrace')].filter(Boolean).join('\n')) : '';
        const durationMs = trxDuration(attributes.duration);
        return { name: name.replace(/\(.*\)$/, ''), suite: className || undefined, state, ...(durationMs !== undefined ? { durationMs } : {}), ...(message ? { message } : {}) };
    });
};

/** `go test -json` events. Subtests (`TestX/case`) roll up into their test. */
export const parseGoTestJson = (output: string): RawTestCase[] => {
    const logs = new Map<string, string>();
    const cases = new Map<string, RawTestCase>();
    for (const event of jsonLines(output)) {
        const test = text(event.Test);
        if (!test || test.includes('/')) {
            continue;
        }
        const key = `${text(event.Package)}\n${test}`;
        const action = text(event.Action);
        if (action === 'output') {
            logs.set(key, `${logs.get(key) ?? ''}${text(event.Output)}`);
        } else if (action === 'pass' || action === 'fail' || action === 'skip') {
            const state: TestState = action === 'pass' ? 'passed' : action === 'fail' ? 'failed' : 'skipped';
            const log = (logs.get(key) ?? '').split('\n').filter(line => !/^\s*(?:=== (?:RUN|PAUSE|CONT)|--- (?:PASS|FAIL|SKIP))/.test(line)).join('\n');
            const elapsed = num(event.Elapsed);
            cases.set(key, {
                name: test, suite: text(event.Package) || undefined, state,
                ...(elapsed !== undefined ? { durationMs: Math.round(elapsed * MS_PER_SECOND) } : {}),
                ...(state === 'failed' && clean(log) ? { message: clean(log) } : {})
            });
        }
    }
    return [...cases.values()];
};

const fileFromUrl = (url: string): string | undefined => url.startsWith('file://') ? decodeURIComponent(url.replace(/^file:\/\//, '')).replace(/^\/([A-Za-z]:)/, '$1') : undefined;

/** `dart test --reporter json` / `flutter test --machine` events. */
export const parseDartJson = (output: string): RawTestCase[] => {
    const groups = new Map<number, string>();
    const tests = new Map<number, { name: string; groupIDs: number[]; line?: number; url: string }>();
    const errors = new Map<number, string>();
    const cases: RawTestCase[] = [];
    for (const event of jsonLines(output)) {
        const type = text(event.type);
        if (type === 'group') {
            const group = record(event.group);
            groups.set(num(group.id) ?? -1, text(group.name));
        } else if (type === 'testStart') {
            const test = record(event.test);
            tests.set(num(test.id) ?? -1, { name: text(test.name), groupIDs: array(test.groupIDs).map(id => num(id) ?? -1), line: num(test.root_line) ?? num(test.line), url: text(test.root_url) || text(test.url) });
        } else if (type === 'error') {
            const id = num(event.testID) ?? -1;
            errors.set(id, `${errors.get(id) ?? ''}${text(event.error)}\n${text(event.stackTrace)}`);
        } else if (type === 'testDone' && event.hidden !== true) {
            const id = num(event.testID) ?? -1;
            const test = tests.get(id);
            if (!test) {
                continue;
            }
            const group = [...test.groupIDs].reverse().map(g => groups.get(g) ?? '').find(Boolean) ?? '';
            const name = group && test.name.startsWith(`${group} `) ? test.name.slice(group.length + 1) : test.name;
            const result = text(event.result);
            const state: TestState = event.skipped === true ? 'skipped' : result === 'success' ? 'passed' : 'failed';
            const file = fileFromUrl(test.url);
            const message = clean(errors.get(id) ?? '');
            cases.push({
                name, ...(group ? { suite: group } : {}), state, ...(file ? { file } : {}), ...(test.line ? { line: test.line } : {}),
                ...(state === 'failed' && message ? { message } : {})
            });
        }
    }
    return cases;
};

/** RSpec's `--format json` report. */
export const parseRspecJson = (raw: unknown): RawTestCase[] => array(record(raw).examples).map(record).map(example => {
    const status = text(example.status);
    const state: TestState = status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'skipped';
    const description = text(example.description);
    const full = text(example.full_description);
    const suite = full.endsWith(description) ? full.slice(0, full.length - description.length).trim() : '';
    const exception = record(example.exception);
    const message = clean([text(exception.class), text(exception.message)].filter(Boolean).join(': '));
    const runTime = num(example.run_time);
    return {
        name: description, ...(suite ? { suite } : {}), state, file: text(example.file_path).replace(/^\.\//, ''), line: num(example.line_number),
        ...(runTime !== undefined ? { durationMs: Math.round(runTime * MS_PER_SECOND) } : {}), ...(state === 'failed' && message ? { message } : {})
    };
});

/** `cargo test` output: `test tests::adds ... ok`, failures under `---- tests::adds stdout ----`. Doc tests are skipped. */
export const parseCargoOutput = (output: string): RawTestCase[] => {
    const messages = new Map<string, string>();
    for (const match of output.matchAll(/^---- (\S+) stdout ----\n([\s\S]*?)(?=^---- |^failures:|^test result:|(?![\s\S]))/gm)) {
        messages.set(match[1], clean(match[2]));
    }
    return [...output.matchAll(/^test (\S+) \.\.\. (ok|FAILED|ignored)/gm)].map(match => {
        const parts = match[1].split('::');
        const name = parts.pop() ?? match[1];
        const state: TestState = match[2] === 'ok' ? 'passed' : match[2] === 'FAILED' ? 'failed' : 'skipped';
        const message = messages.get(match[1]);
        return { name, ...(parts.length ? { suite: parts.join('::') } : {}), state, ...(state === 'failed' && message ? { message } : {}) };
    });
};

const unittestTarget = (name: string, target: string): { suite?: string; file?: string } => {
    const parts = target.split('.');
    if (parts[parts.length - 1] === name) {
        parts.pop();
    }
    const suite = parts.pop();
    return { ...(suite ? { suite } : {}), ...(parts.length ? { file: `${parts.join('/')}.py` } : {}) };
};

/** `python -m unittest -v`: `test_add (test_math.MathTest.test_add) ... ok`, tracebacks after `FAIL:` / `ERROR:`. */
export const parseUnittestOutput = (output: string): RawTestCase[] => {
    const messages = new Map<string, string>();
    for (const match of output.matchAll(/^(?:FAIL|ERROR): (\w+) \(([\w.]+)\)[^\n]*\n(?:[^\n-][^\n]*\n)?-{10,}\n([\s\S]*?)(?=^={10,}|^-{10,}\nRan |(?![\s\S]))/gm)) {
        messages.set(`${match[1]} ${match[2]}`, clean(match[3]));
    }
    return [...output.matchAll(/^(\w+) \(([\w.]+)\)(?:\n[^\n]*?)? \.\.\. (ok|FAIL|ERROR|skipped[^\n]*|expected failure|unexpected success)$/gm)].map(match => {
        const [, name, target, result] = match;
        const state: TestState = result === 'ok' || result === 'expected failure' ? 'passed' : result.startsWith('skipped') ? 'skipped' : 'failed';
        const message = messages.get(`${name} ${target}`);
        const lineMatch = message ? [...message.matchAll(/File "[^"]+", line (\d+)/g)].pop() : undefined;
        return { name, ...unittestTarget(name, target), state, ...(message ? { message } : {}), ...(lineMatch ? { line: Number(lineMatch[1]) } : {}) };
    });
};

/** Minitest `-v`: `MathTest#test_add = 0.00 s = .`, failures as `1) Failure:\nMathTest#test_add [file:line]:`. */
export const parseMinitestOutput = (output: string): RawTestCase[] => {
    const failures = new Map<string, { message: string; file?: string; line?: number }>();
    for (const match of output.matchAll(/^\s*\d+\) (?:Failure|Error):\n([\w:]+)#(\S+?)(?: \[([^\]\n]+?):(\d+)\])?:\n([\s\S]*?)(?=^\s*\d+\) (?:Failure|Error|Skipped):|^\d+ (?:runs|tests)|(?![\s\S]))/gm)) {
        failures.set(`${match[1]}#${match[2]}`, { message: clean(match[5]), ...(match[3] ? { file: match[3], line: Number(match[4]) } : {}) });
    }
    return [...output.matchAll(/^([\w:]+)#(\S+) = ([\d.]+) s = ([.FES])$/gm)].map(match => {
        const [, suite, name, time, mark] = match;
        const state: TestState = mark === '.' ? 'passed' : mark === 'S' ? 'skipped' : 'failed';
        const failure = failures.get(`${suite}#${name}`);
        return {
            name, suite, state, durationMs: seconds(time),
            ...(failure?.file ? { file: failure.file, line: failure.line } : {}), ...(state === 'failed' && failure?.message ? { message: failure.message } : {})
        };
    });
};

/** `swift test`: XCTest (`Test Case '-[Mod.Class testX]' passed (0.001 seconds).`) and swift-testing (`✔ Test add() passed after 0.001 seconds.`). */
export const parseSwiftOutput = (output: string): RawTestCase[] => {
    const plain = stripAnsi(output);
    const issues = new Map<string, string>();
    for (const match of plain.matchAll(/^(\S+?):(\d+): error: -?\[?(?:[\w.]+\.)?(\w+)[ .](\w+)\]? : (.*)$/gm)) {
        issues.set(`${match[3]}.${match[4]}`, clean(`${match[5]}\n${match[1]}:${match[2]}`));
    }
    for (const match of plain.matchAll(/^\S*\s*Test (?:"([^"]+)"|(\w+)\([^)]*\)) recorded an issue at ([^:\n]+:\d+)(?::\d+)?: (.*)$/gm)) {
        const key = match[1] ?? match[2];
        issues.set(key, clean(`${issues.get(key) ?? ''}${match[4]}\n${match[3]}`));
    }
    const cases: RawTestCase[] = [];
    for (const match of plain.matchAll(/^Test Case '-?\[?(?:[\w]+\.)?(\w+)[ .](\w+)\]?' (passed|failed|skipped) \(([\d.]+) seconds\)/gm)) {
        const [, suite, name, result, time] = match;
        const state: TestState = result === 'passed' ? 'passed' : result === 'failed' ? 'failed' : 'skipped';
        const message = issues.get(`${suite}.${name}`);
        cases.push({ name, suite, state, durationMs: seconds(time), ...(state === 'failed' && message ? { message } : {}) });
    }
    for (const match of plain.matchAll(/^\S*\s*Test (?:"([^"]+)"|(\w+)\([^)]*\)) (passed|failed|skipped)(?: after ([\d.]+) seconds)?/gm)) {
        const name = match[1] ?? match[2];
        const state: TestState = match[3] === 'passed' ? 'passed' : match[3] === 'failed' ? 'failed' : 'skipped';
        const message = issues.get(name);
        cases.push({ name, state, ...(match[4] ? { durationMs: seconds(match[4]) } : {}), ...(state === 'failed' && message ? { message } : {}) });
    }
    return cases;
};
