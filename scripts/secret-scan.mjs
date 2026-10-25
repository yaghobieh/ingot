#!/usr/bin/env node
// Scans tracked + staged files for common secret patterns. Exits 1 on a finding.
// Prints only file:line and the rule name, never the matched value.
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const RULES = [
    ['OpenAI/DeepSeek-style key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}/],
    ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
    ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
    ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['Connection string with password', /\b[a-z]+:\/\/[^\s:@/]+:[^\s@/]{6,}@[^\s]+/i],
    ['Alloy PAT', /\balloy_pat_[A-Za-z0-9]{16,}/],
    ['Resend key', /\bre_[A-Za-z0-9]{20,}/],
    ['Neon password', /\bnpg_[A-Za-z0-9]{8,}/]
];
const SKIP = [/^package-lock\.json$/, /\.(png|ico|icns|jpg|gif|woff2?)$/, /^scripts\/secret-scan\.mjs$/];
const ALLOW = [/127\.0\.0\.1/, /localhost/, /example\.com/];

const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean);
let findings = 0;
for (const file of files) {
    if (SKIP.some(re => re.test(file))) { continue; }
    let text;
    try { if (statSync(file).size > 2_000_000) { continue; } text = readFileSync(file, 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, index) => {
        for (const [name, re] of RULES) {
            if (re.test(line) && !ALLOW.some(a => a.test(line))) {
                findings++;
                console.error(`${file}:${index + 1}  ${name}`);
            }
        }
    });
}
if (findings > 0) { console.error(`secret-scan: ${findings} finding(s)`); process.exit(1); }
console.log(`secret-scan: clean (${files.length} files)`);
