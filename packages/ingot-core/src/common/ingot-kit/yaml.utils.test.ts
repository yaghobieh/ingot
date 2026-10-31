import { describe, expect, it } from 'vitest';
import { parseYaml, stringifyYaml } from './yaml.utils';

describe('yaml subset', () => {
    it('parses nested maps, lists, flow lists, scalars and comments', () => {
        expect(parseYaml(`
# policy
secrets:
  denyRead:
    - .env   # local
    - "**/*.pem"
  redact: { }
network:
  allowedDomains: [github.com, 'npmjs.com']
budget:
  maxCostPerRun: 0.5
audit: true
model: ~
items:
  - name: a
    on: false
note: |
  line one
  line two
`)).toEqual({
            secrets: { denyRead: ['.env', '**/*.pem'], redact: '{ }' },
            network: { allowedDomains: ['github.com', 'npmjs.com'] },
            budget: { maxCostPerRun: 0.5 },
            audit: true,
            model: null,
            items: [{ name: 'a', on: false }],
            note: 'line one\nline two\n'
        });
    });

    it('reports the line of bad input', () => {
        expect(() => parseYaml('a: 1\n   b: 2\n')).toThrow('line 2');
    });

    it('writes YAML that parses back to the same value', () => {
        const value = { version: 1, secrets: { denyRead: ['.env', '**/*.pem', 'true'] }, network: { allowedDomains: [] }, list: [{ a: 1, b: 'x: y' }], empty: {} };
        expect(parseYaml(stringifyYaml(value))).toEqual(value);
    });
});
