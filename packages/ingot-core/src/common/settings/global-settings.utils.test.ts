import { describe, expect, it } from 'vitest';
import { GLOBAL_SETTINGS_TEMPLATE } from './global-settings.consts';
import { secretLikeKeys } from './global-settings.utils';

describe('IDEA-94 global settings', () => {
    it('flags credential-looking keys with a value, nested ones too', () => {
        expect(secretLikeKeys({ 'editor.fontSize': 14, 'openai.apiKey': 'x', models: { token: 'y', tokenLimit: 3 }, password: '' })).toEqual(['openai.apiKey', 'models.token']);
        expect(secretLikeKeys(undefined)).toEqual([]);
        expect(secretLikeKeys(['a'])).toEqual([]);
    });

    it('template defaults to the System theme and wraps lines, with no secrets', () => {
        const json = JSON.parse(GLOBAL_SETTINGS_TEMPLATE.replace(/^\s*\/\/.*$/gm, ''));
        expect(json['ingot.appearance']).toBe('system');
        expect(json['editor.wordWrap']).toBe('on');
        expect(secretLikeKeys(json)).toEqual([]);
    });
});
