import { describe, expect, it } from 'vitest';
import { completeDevSignIn } from './dev-sign-in';

const DEV_URL = 'http://localhost:3200/api/dev/login?email=test%40ingot.dev&next=%2Fide%2Fauthorize%3Fredirect_uri%3Dhttp%253A%252F%252F127.0.0.1%253A4555%252Fcallback%26state%3Ds1%26code_challenge%3Dc1%26code_challenge_method%3DS256%26client_name%3DIngot';

const fakeFetch = (redirectTo: string, calls: { url: string; init?: RequestInit }[]): typeof fetch => (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith('http://localhost:3200/api/dev/login')) {
        return new Response(null, { status: 302, headers: [['set-cookie', 'ingot_session=abc; Path=/; HttpOnly'], ['location', '/ide/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A4555%2Fcallback&state=s1&code_challenge=c1&code_challenge_method=S256&client_name=Ingot']] });
    }
    if (url === 'http://localhost:3200/api/ide/authorize') {
        return Response.json({ redirectTo });
    }
    return new Response('ok');
}) as typeof fetch;

describe('completeDevSignIn (local dev only)', () => {
    it('logs in, approves the authorize request with the session cookie, then calls the loopback callback', async () => {
        const calls: { url: string; init?: RequestInit }[] = [];
        await completeDevSignIn(DEV_URL, fakeFetch('http://127.0.0.1:4555/callback?code=k&state=s1', calls));
        expect(calls.map(c => c.url)).toEqual([DEV_URL, 'http://localhost:3200/api/ide/authorize', 'http://127.0.0.1:4555/callback?code=k&state=s1']);
        const approve = calls[1].init!;
        expect((approve.headers as Record<string, string>).cookie).toBe('ingot_session=abc');
        expect(JSON.parse(String(approve.body))).toMatchObject({ redirectUri: 'http://127.0.0.1:4555/callback', state: 's1', codeChallenge: 'c1', approve: true });
    });

    it('never hands a code to a non-local redirect', async () => {
        await expect(completeDevSignIn(DEV_URL, fakeFetch('https://evil.example/cb?code=k', []))).rejects.toThrow(/local callback/);
    });
});
