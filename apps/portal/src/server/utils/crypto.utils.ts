import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
    DEVICE_USER_CODE_ALPHABET, DEVICE_USER_CODE_HALF, ENCRYPTION_ALGORITHM, ENCRYPTION_IV_BYTES, ENCRYPTION_KEY_BYTES, OTP_LENGTH, SECRET_LAST_CHARS
} from '@server/utils/crypto.consts';
import type { EncryptedSecret } from '@server/utils/crypto.types';

const BASE = 10;

export function randomToken(bytes: number): string {
    return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export function generateOtp(): string {
    return Array.from({ length: OTP_LENGTH }, () => randomInt(BASE).toString()).join('');
}

export function generateUserCode(): string {
    const pick = () => DEVICE_USER_CODE_ALPHABET[randomInt(DEVICE_USER_CODE_ALPHABET.length)];
    const half = () => Array.from({ length: DEVICE_USER_CODE_HALF }, pick).join('');
    return `${half()}-${half()}`;
}

export function normalizeUserCode(input: string): string {
    const clean = input.toUpperCase().replace(/[^A-Z]/g, '');
    return clean.length === DEVICE_USER_CODE_HALF * 2 ? `${clean.slice(0, DEVICE_USER_CODE_HALF)}-${clean.slice(DEVICE_USER_CODE_HALF)}` : clean;
}

export function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}

function keyFrom(base64Key: string): Buffer {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== ENCRYPTION_KEY_BYTES) { throw new Error('security.encryptionKey must be 32 bytes, base64-encoded'); }
    return key;
}

export function encryptSecret(plain: string, base64Key: string): EncryptedSecret {
    const iv = randomBytes(ENCRYPTION_IV_BYTES);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, keyFrom(base64Key), iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

export function decryptSecret(secret: EncryptedSecret, base64Key: string): string {
    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, keyFrom(base64Key), Buffer.from(secret.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export function lastChars(value: string): string {
    return value.slice(-SECRET_LAST_CHARS);
}

export function hmacSha256Hex(body: string, secret: string): string {
    return createHmac('sha256', secret).update(body).digest('hex');
}
