import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, generateOtp, generateUserCode, hmacSha256Hex, lastChars, normalizeUserCode, safeEqual, sha256 } from '@server/utils/crypto.utils';

const KEY = randomBytes(32).toString('base64');

describe('crypto utils', () => {
    it('round-trips an encrypted secret and never stores plaintext', () => {
        const plain = 'not-a-real-key-value-1234';
        const enc = encryptSecret(plain, KEY);
        expect(enc.ciphertext).not.toContain(plain);
        expect(decryptSecret(enc, KEY)).toBe(plain);
    });
    it('fails to decrypt with the wrong key', () => {
        const enc = encryptSecret('value', KEY);
        expect(() => decryptSecret(enc, randomBytes(32).toString('base64'))).toThrow();
    });
    it('rejects a short encryption key', () => {
        expect(() => encryptSecret('value', Buffer.from('short').toString('base64'))).toThrow(/32 bytes/);
    });
    it('generates 6-digit OTP codes', () => {
        for (let i = 0; i < 50; i++) { expect(generateOtp()).toMatch(/^\d{6}$/); }
    });
    it('generates and normalizes device user codes', () => {
        const code = generateUserCode();
        expect(code).toMatch(/^[B-Z]{4}-[B-Z]{4}$/);
        expect(normalizeUserCode(code.toLowerCase().replace('-', ' '))).toBe(code);
    });
    it('hashes, compares and signs', () => {
        expect(sha256('a')).toHaveLength(64);
        expect(safeEqual('abc', 'abc')).toBe(true);
        expect(safeEqual('abc', 'abd')).toBe(false);
        expect(safeEqual('abc', 'ab')).toBe(false);
        expect(hmacSha256Hex('body', 'secret')).toHaveLength(64);
        expect(lastChars('abcdef')).toBe('cdef');
    });
});
