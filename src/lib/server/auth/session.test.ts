/**
 * Tests for the signed session helper (`session.ts`).
 *
 * Covers the core "verified-only / non-spoofable" invariant from the issue:
 * a session token round-trips, and any tampering (payload, signature, wrong
 * secret, truncation, garbage) is rejected → treated as anonymous.
 *
 * See `.agent/interface.md` §2.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Provide a stable session secret (>= 32 chars) so getSessionSecret() works.
vi.mock('$env/dynamic/private', () => ({
	env: { SESSION_SECRET: 'test-session-secret-at-least-32-chars-long-xxxx' }
}));

import {
	createSessionToken,
	verifySessionToken,
	setSessionCookie,
	clearSessionCookie,
	type SessionPayload
} from './session';
import { SESSION_COOKIE_NAME } from '$lib/server/env';

// base64url helpers mirroring the token encoding pinned in the interface spec.
function b64urlEncode(str: string): string {
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
	const padded = s.replace(/-/g, '+').replace(/_/g, '/');
	return atob(padded);
}

const payload: SessionPayload = { githubId: 12345, username: 'octocat', iat: 1_700_000_000_000 };

describe('createSessionToken / verifySessionToken', () => {
	it('round-trips a payload to the exposed SessionUser', async () => {
		const token = await createSessionToken(payload);
		const user = await verifySessionToken(token);

		expect(user).toEqual({ githubId: payload.githubId, username: payload.username });
	});

	it('produces a signed `payload.signature` token (two base64url parts)', async () => {
		const token = await createSessionToken(payload);

		expect(typeof token).toBe('string');
		const parts = token.split('.');
		expect(parts).toHaveLength(2);
		expect(parts[0].length).toBeGreaterThan(0);
		expect(parts[1].length).toBeGreaterThan(0);
	});

	it('rejects a payload whose username was swapped but signature kept (non-spoofable)', async () => {
		const token = await createSessionToken(payload);
		const [payloadPart, sigPart] = token.split('.');

		// Attacker rewrites the username while reusing the original signature.
		const decoded = JSON.parse(b64urlDecode(payloadPart));
		decoded.username = 'attacker';
		const forged = `${b64urlEncode(JSON.stringify(decoded))}.${sigPart}`;

		expect(await verifySessionToken(forged)).toBeNull();
	});

	it('rejects a token with a tampered signature', async () => {
		const token = await createSessionToken(payload);
		const [payloadPart, sigPart] = token.split('.');
		const flipped = sigPart[0] === 'A' ? 'B' : 'A';
		const forged = `${payloadPart}.${flipped}${sigPart.slice(1)}`;

		expect(await verifySessionToken(forged)).toBeNull();
	});

	it('rejects a token signed under a different secret', async () => {
		const token = await createSessionToken(payload);
		const [payloadPart] = token.split('.');
		// A random/forged signature (as if signed with a secret the attacker chose).
		const forged = `${payloadPart}.${b64urlEncode('not-a-real-signature-bytes')}`;

		expect(await verifySessionToken(forged)).toBeNull();
	});

	it('returns null (never throws) for garbage / empty / truncated input', async () => {
		expect(await verifySessionToken('')).toBeNull();
		expect(await verifySessionToken('not-a-token')).toBeNull();
		expect(await verifySessionToken('only-one-part')).toBeNull();

		const token = await createSessionToken(payload);
		expect(await verifySessionToken(token.slice(0, token.length - 4))).toBeNull();
	});
});

describe('setSessionCookie / clearSessionCookie', () => {
	function makeCookies() {
		return { set: vi.fn(), delete: vi.fn(), get: vi.fn() };
	}

	let cookies: ReturnType<typeof makeCookies>;
	beforeEach(() => {
		cookies = makeCookies();
	});

	it('setSessionCookie writes a signed value under SESSION_COOKIE_NAME', async () => {
		await setSessionCookie(cookies as never, payload);

		expect(cookies.set).toHaveBeenCalledTimes(1);
		const [name, value, options] = cookies.set.mock.calls[0];
		expect(name).toBe(SESSION_COOKIE_NAME);
		expect(typeof value).toBe('string');
		expect(value.length).toBeGreaterThan(0);
		// The stored value must verify back to the same user.
		expect(await verifySessionToken(value)).toEqual({
			githubId: payload.githubId,
			username: payload.username
		});
		expect(options).toMatchObject({ httpOnly: true, path: '/', sameSite: 'lax' });
	});

	it('clearSessionCookie deletes the session cookie', () => {
		clearSessionCookie(cookies as never);

		expect(cookies.delete).toHaveBeenCalledTimes(1);
		const [name, options] = cookies.delete.mock.calls[0];
		expect(name).toBe(SESSION_COOKIE_NAME);
		expect(options).toMatchObject({ path: '/' });
	});
});
