import { describe, expect, it } from 'vitest';
import {
    decodeXml, parseCargoOutput, parseDartJson, parseGoTestJson, parseJUnitXml, parseMinitestOutput, parseRspecJson, parseSwiftOutput, parseTrx, parseUnittestOutput, trxDuration
} from './test-reports.utils';

const ROOT = '/work/app';

describe('JUnit XML (pytest, PHPUnit, Maven, Gradle, CTest)', () => {
    it('reads passed, failed, errored and skipped cases', () => {
        const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites><testsuite name="pytest" tests="4">
  <testcase classname="tests.test_math.TestMath" name="test_add" file="tests/test_math.py" line="4" time="0.001" />
  <testcase classname="tests.test_math.TestMath" name="test_broken" time="0.002"><failure message="assert 2 == 3">def test_broken():
&gt;       assert 1 + 1 == 3</failure></testcase>
  <testcase classname="tests.test_math" name="test_error" time="0"><error message="boom"><![CDATA[RuntimeError: boom & bust]]></error></testcase>
  <testcase classname="tests.test_math" name="test_skip" time="0"><skipped type="pytest.skip" message="later" /></testcase>
</testsuite></testsuites>`;
        const cases = parseJUnitXml(xml);
        expect(cases.map(c => [c.name, c.state])).toEqual([['test_add', 'passed'], ['test_broken', 'failed'], ['test_error', 'failed'], ['test_skip', 'skipped']]);
        expect(cases[0]).toMatchObject({ suite: 'tests.test_math.TestMath', file: 'tests/test_math.py', line: 4, durationMs: 1 });
        expect(cases[1].message).toContain('>       assert 1 + 1 == 3');
        expect(cases[2].message).toContain('RuntimeError: boom & bust');
    });

    it("reads CTest's status attribute", () => {
        const xml = '<testsuite><testcase name="hello_runs" classname="hello_runs" time="0.01" status="run"/><testcase name="slow" classname="slow" status="notrun"><skipped message="Disabled"/></testcase><testcase name="bad" classname="bad" status="fail"><failure message="Failed"/></testcase></testsuite>';
        expect(parseJUnitXml(xml).map(c => c.state)).toEqual(['passed', 'skipped', 'failed']);
    });

    it('decodes entities', () => {
        expect(decodeXml('a &lt;b&gt; &amp; &#39;c&#x27; &quot;')).toBe('a <b> & \'c\' "');
    });
});

describe('TRX (dotnet test)', () => {
    it('joins results with their class names', () => {
        const trx = `<TestRun><Results>
  <UnitTestResult testId="a" testName="Hello.Tests.MathTests.Adds" outcome="Passed" duration="00:00:00.0012000" />
  <UnitTestResult testId="b" testName="Hello.Tests.MathTests.Breaks" outcome="Failed" duration="00:00:01.5000000"><Output><ErrorInfo><Message>Assert.Equal() Failure
Expected: 3
Actual:   2</Message><StackTrace>at Hello.Tests.MathTests.Breaks() in /work/app/MathTests.cs:line 12</StackTrace></ErrorInfo></Output></UnitTestResult>
  <UnitTestResult testId="c" testName="Later" outcome="NotExecuted" />
</Results><TestDefinitions>
  <UnitTest id="a"><TestMethod className="Hello.Tests.MathTests" name="Adds" /></UnitTest>
  <UnitTest id="b"><TestMethod className="Hello.Tests.MathTests" name="Breaks" /></UnitTest>
  <UnitTest id="c"><TestMethod className="Hello.Tests.MathTests" name="Later" /></UnitTest>
</TestDefinitions></TestRun>`;
        const cases = parseTrx(trx);
        expect(cases.map(c => [c.name, c.suite, c.state])).toEqual([
            ['Adds', 'Hello.Tests.MathTests', 'passed'], ['Breaks', 'Hello.Tests.MathTests', 'failed'], ['Later', 'Hello.Tests.MathTests', 'skipped']
        ]);
        expect(cases[1].durationMs).toBe(1500);
        expect(cases[1].message).toContain('Expected: 3');
        expect(trxDuration('01:02:03.5')).toBe(3_723_500);
    });
});

describe('go test -json', () => {
    it('reads test events, keeping the failure log and rolling up subtests', () => {
        const output = [
            '{"Action":"run","Package":"example.com/hello","Test":"TestAdd"}',
            '{"Action":"output","Package":"example.com/hello","Test":"TestAdd","Output":"=== RUN   TestAdd\\n"}',
            '{"Action":"pass","Package":"example.com/hello","Test":"TestAdd","Elapsed":0.01}',
            '{"Action":"run","Package":"example.com/hello","Test":"TestBroken"}',
            '{"Action":"output","Package":"example.com/hello","Test":"TestBroken","Output":"    hello_test.go:12: got 2, want 3\\n"}',
            '{"Action":"output","Package":"example.com/hello","Test":"TestBroken","Output":"--- FAIL: TestBroken (0.00s)\\n"}',
            '{"Action":"fail","Package":"example.com/hello","Test":"TestBroken","Elapsed":0}',
            '{"Action":"pass","Package":"example.com/hello","Test":"TestTable/one","Elapsed":0}',
            'not json',
            '{"Action":"fail","Package":"example.com/hello","Elapsed":0.2}'
        ].join('\n');
        const cases = parseGoTestJson(output);
        expect(cases.map(c => [c.name, c.state])).toEqual([['TestAdd', 'passed'], ['TestBroken', 'failed']]);
        expect(cases[0].durationMs).toBe(10);
        expect(cases[1].message).toBe('hello_test.go:12: got 2, want 3');
    });
});

describe('dart test --reporter json', () => {
    it('reads groups, failures and skips (real dart 3.13 output)', () => {
        const url = 'file:///work/app/test/math_test.dart';
        const output = [
            '{"protocolVersion":"0.1.1","runnerVersion":"1.31.1","pid":1,"type":"start","time":0}',
            '{"test":{"id":1,"name":"loading test/math_test.dart","suiteID":0,"groupIDs":[],"line":null,"url":null},"type":"testStart","time":1}',
            '{"testID":1,"result":"success","skipped":false,"hidden":true,"type":"testDone","time":623}',
            '{"group":{"id":2,"suiteID":0,"parentID":null,"name":"","testCount":3,"line":null,"url":null},"type":"group","time":625}',
            `{"group":{"id":3,"suiteID":0,"parentID":2,"name":"math","testCount":2,"line":4,"url":"${url}"},"type":"group","time":625}`,
            `{"test":{"id":4,"name":"math adds","suiteID":0,"groupIDs":[2,3],"line":5,"url":"${url}"},"type":"testStart","time":625}`,
            '{"testID":4,"result":"success","skipped":false,"hidden":false,"type":"testDone","time":634}',
            `{"test":{"id":5,"name":"math breaks","suiteID":0,"groupIDs":[2,3],"line":8,"url":"${url}"},"type":"testStart","time":635}`,
            '{"testID":5,"error":"Expected: <3>\\n  Actual: <2>\\n","stackTrace":"test/math_test.dart 9:7  main.<fn>.<fn>\\n","isFailure":true,"type":"error","time":642}',
            '{"testID":5,"result":"failure","skipped":false,"hidden":false,"type":"testDone","time":642}',
            `{"test":{"id":6,"name":"top level","suiteID":0,"groupIDs":[2],"line":12,"url":"${url}"},"type":"testStart","time":643}`,
            '{"testID":6,"result":"success","skipped":true,"hidden":false,"type":"testDone","time":643}'
        ].join('\n');
        const cases = parseDartJson(output);
        expect(cases.map(c => [c.suite, c.name, c.state])).toEqual([['math', 'adds', 'passed'], ['math', 'breaks', 'failed'], [undefined, 'top level', 'skipped']]);
        expect(cases[1]).toMatchObject({ file: '/work/app/test/math_test.dart', line: 8 });
        expect(cases[1].message).toContain('Expected: <3>');
    });
});

describe('RSpec --format json', () => {
    it('reads examples with their groups', () => {
        const cases = parseRspecJson({
            examples: [
                { description: 'adds', full_description: 'Calculator #add adds', status: 'passed', file_path: './spec/calc_spec.rb', line_number: 4, run_time: 0.002 },
                { description: 'breaks', full_description: 'Calculator #add breaks', status: 'failed', file_path: './spec/calc_spec.rb', line_number: 8, exception: { class: 'RSpec::Expectations::ExpectationNotMetError', message: 'expected: 3\n     got: 2' } },
                { description: 'later', full_description: 'Calculator later', status: 'pending', file_path: './spec/calc_spec.rb', line_number: 12 }
            ]
        });
        expect(cases.map(c => [c.suite, c.name, c.state])).toEqual([['Calculator #add', 'adds', 'passed'], ['Calculator #add', 'breaks', 'failed'], ['Calculator', 'later', 'skipped']]);
        expect(cases[1]).toMatchObject({ file: 'spec/calc_spec.rb', line: 8 });
        expect(cases[1].message).toContain('expected: 3');
    });
});

describe('cargo test output', () => {
    it('reads results and failure output, skipping doc tests', () => {
        const output = `running 3 tests
test tests::adds ... ok
test tests::breaks ... FAILED
test tests::later ... ignored

failures:

---- tests::breaks stdout ----
thread 'tests::breaks' panicked at src/main.rs:14:9:
assertion \`left == right\` failed
  left: 2
 right: 3

failures:
    tests::breaks

test result: FAILED. 1 passed; 1 failed; 1 ignored

   Doc-tests hello
test src/lib.rs - add (line 3) ... ok
`;
        const cases = parseCargoOutput(output);
        expect(cases.map(c => [c.suite, c.name, c.state])).toEqual([['tests', 'adds', 'passed'], ['tests', 'breaks', 'failed'], ['tests', 'later', 'skipped']]);
        expect(cases[1].message).toContain('left: 2');
    });
});

describe('python -m unittest -v (real Python 3.14 output)', () => {
    it('reads results, docstring lines and tracebacks', () => {
        const output = `test_add (test_math.MathTest.test_add) ... ok
test_broken (test_math.MathTest.test_broken)
Doc line. ... FAIL
test_skip (test_math.MathTest.test_skip) ... skipped 'later'
test_old (tests.test_legacy.LegacyTest) ... ERROR

======================================================================
FAIL: test_broken (test_math.MathTest.test_broken)
Doc line.
----------------------------------------------------------------------
Traceback (most recent call last):
  File "/work/app/test_math.py", line 10, in test_broken
    self.assertEqual(1 + 1, 3)
AssertionError: 2 != 3

----------------------------------------------------------------------
Ran 4 tests in 0.000s

FAILED (failures=1, errors=1, skipped=1)
`;
        const cases = parseUnittestOutput(output);
        expect(cases.map(c => [c.file, c.suite, c.name, c.state])).toEqual([
            ['test_math.py', 'MathTest', 'test_add', 'passed'], ['test_math.py', 'MathTest', 'test_broken', 'failed'],
            ['test_math.py', 'MathTest', 'test_skip', 'skipped'], ['tests/test_legacy.py', 'LegacyTest', 'test_old', 'failed']
        ]);
        expect(cases[1]).toMatchObject({ line: 10 });
        expect(cases[1].message).toContain('AssertionError: 2 != 3');
    });
});

describe('Minitest -v (real Ruby output)', () => {
    it('reads results, failures and errors', () => {
        const output = `Run options: -v --seed 20461

# Running:

MathTest#test_error = 0.00 s = E
MathTest#test_add = 0.00 s = .
MathTest#test_broken = 0.01 s = F
MathTest#test_skip = 0.00 s = S

Finished in 0.000488s, 8196.7215 runs/s, 4098.3607 assertions/s.

  1) Error:
MathTest#test_error:
RuntimeError: boom
    /work/app/test/math_test.rb:13:in \`test_error'

  2) Failure:
MathTest#test_broken [/work/app/test/math_test.rb:9]:
Expected: 3
  Actual: 2

  3) Skipped:
MathTest#test_skip [/work/app/test/math_test.rb:17]:
later

4 runs, 2 assertions, 1 failures, 1 errors, 1 skips
`;
        const cases = parseMinitestOutput(output);
        expect(cases.map(c => [c.name, c.state])).toEqual([['test_error', 'failed'], ['test_add', 'passed'], ['test_broken', 'failed'], ['test_skip', 'skipped']]);
        expect(cases[0].message).toContain('RuntimeError: boom');
        expect(cases[2]).toMatchObject({ suite: 'MathTest', file: '/work/app/test/math_test.rb', line: 9, durationMs: 10 });
        expect(cases[2].message).toContain('Expected: 3');
    });
});

describe('swift test output', () => {
    it('reads XCTest on macOS and Linux', () => {
        const output = `Test Suite 'All tests' started at 2026-10-31 11:00:00.000.
Test Case '-[HelloTests.HelloTests testAdd]' started.
Test Case '-[HelloTests.HelloTests testAdd]' passed (0.001 seconds).
Test Case '-[HelloTests.HelloTests testBroken]' started.
${ROOT}/Tests/HelloTests/HelloTests.swift:9: error: -[HelloTests.HelloTests testBroken] : XCTAssertEqual failed: ("2") is not equal to ("3")
Test Case '-[HelloTests.HelloTests testBroken]' failed (0.002 seconds).
Test Case 'HelloTests.testLinux' passed (0.003 seconds)
`;
        const cases = parseSwiftOutput(output);
        expect(cases.map(c => [c.suite, c.name, c.state])).toEqual([['HelloTests', 'testAdd', 'passed'], ['HelloTests', 'testBroken', 'failed'], ['HelloTests', 'testLinux', 'passed']]);
        expect(cases[1].message).toContain('XCTAssertEqual failed');
    });

    it('reads swift-testing', () => {
        const output = `◇ Test run started.
✔ Test adds() passed after 0.001 seconds.
✘ Test "Breaks on purpose" recorded an issue at HelloTests.swift:9:5: Expectation failed: (add(1, 1) → 2) == 3
✘ Test "Breaks on purpose" failed after 0.002 seconds with 1 issue.
➜ Test later() skipped.
`;
        const cases = parseSwiftOutput(output);
        expect(cases.map(c => [c.name, c.state])).toEqual([['adds', 'passed'], ['Breaks on purpose', 'failed'], ['later', 'skipped']]);
        expect(cases[1].message).toContain('Expectation failed');
    });
});
