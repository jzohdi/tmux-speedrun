/**
 * Tests for the signed "pending result" cookie helper (`pending.ts`).
 *
 * Iteration 2 (PR #36 feedback): an anonymous finish no longer records
 * immediately — the result (challengeId + durationMs) is deferred behind a
 * short-lived, HMAC-signed cookie so it can be attached to a verified GitHub
 * identity after a later login, or to a free-text name at record time.
 *
 * Core invariant (see `.agent/interface.md` §I2 / §I0.2): `durationMs` and
 * `challengeId` cannot be forged between finish and record — a tampered,
 * truncated, wrong-secret, garbage, or > 1h-old token verifies as `null`.
 * The username is NEVER stored in this cookie.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stable session secret (>= 32 chars) so getSessionSecret() works.
vi.mock('$env/dynamic/private', () => ({
	env: { SESSION_SECRET: 'test-session-secret-at-least-32-chars-long-xxxx' }
}));

import {
	createPendingResultToken,
	verifyPendingResultToken,
	setPendingResultCookie,
	clearPendingResultCookie,
	MAX_PENDING_RESULT_AGE_MS,
	type PendingResultPayload
} from './pending';
import { PENDING_RESULT_COOKIE_NAME } from '$lib/server/env';

// base64url helpers mirroring the token encoding pinned in the interface spec.
function b64urlEncode(str: string): string {
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
	return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

function freshPayload(overrides: Partial<PendingResultPayload> = {}): PendingResultPayload {
	return { challengeId: 2, durationMs: 12_340, iat: Date.now(), ...overrides };
}

describe('createPendingResultToken / verifyPendingResultToken', () => {
	it('round-trips to { challengeId, durationMs } (iat dropped, no username)', async () => {
		const payload = freshPayload();
		const token = await createPendingResultToken(payload);
		const result = await verifyPendingResultToken(token);

		expect(result).toEqual({ challengeId: payload.challengeId, durationMs: payload.durationMs });
		// The username must never travel in this cookie.
		expect(JSON.stringify(result)).not.toContain('username');
	});

	it('produces a signed two-part base64url token', async () => {
		const token = await createPendingResultToken(freshPayload());
		const parts = token.split('.');
		expect(parts).toHaveLength(2);
		expect(parts[0].length).toBeGreaterThan(0);
		expect(parts[1].length).toBeGreaterThan(0);
	});

	it('rejects a token whose durationMs was altered but signature kept (non-forgeable time)', async () => {
		const token = await createPendingResultToken(freshPayload());
		const [payloadPart, sigPart] = token.split('.');

		const decoded = JSON.parse(b64urlDecode(payloadPart));
		decoded.durationMs = 1; // attacker tries to claim a world-record time
		const forged = `${b64urlEncode(JSON.stringify(decoded))}.${sigPart}`;

		expect(await verifyPendingResultToken(forged)).toBeNull();
	});

	it('rejects a token with a tampered signature', async () => {
		const token = await createPendingResultToken(freshPayload());
		const [payloadPart, sigPart] = token.split('.');
		const flipped = sigPart[0] === 'A' ? 'B' : 'A';

		expect(await verifyPendingResultToken(`${payloadPart}.${flipped}${sigPart.slice(1)}`)).toBeNull();
	});

	it('rejects a token signed under a different secret', async () => {
		const token = await createPendingResultToken(freshPayload());
		const [payloadPart] = token.split('.');
		const forged = `${payloadPart}.${b64urlEncode('not-a-real-signature')}`;

		expect(await verifyPendingResultToken(forged)).toBeNull();
	});

	it('returns null (never throws) for empty / garbage / truncated input', async () => {
		expect(await verifyPendingResultToken('')).toBeNull();
		expect(await verifyPendingResultToken('garbage')).toBeNull();
		expect(await verifyPendingResultToken('only-one-part')).toBeNull();

		const token = await createPendingResultToken(freshPayload());
		expect(await verifyPendingResultToken(token.slice(0, token.length - 4))).toBeNull();
	});

	it('rejects a token whose iat is older than the max age (1h expiry)', async () => {
		const stale = freshPayload({ iat: Date.now() - MAX_PENDING_RESULT_AGE_MS - 1000 });
		const token = await createPendingResultToken(stale);

		expect(await verifyPendingResultToken(token)).toBeNull();
	});

	it('accepts a token issued just within the max age', async () => {
		const recent = freshPayload({ iat: Date.now() - (MAX_PENDING_RESULT_AGE_MS - 5000) });
		const token = await createPendingResultToken(recent);

		expect(await verifyPendingResultToken(token)).toEqual({
			challengeId: recent.challengeId,
			durationMs: recent.durationMs
		});
	});
});

describe('setPendingResultCookie / clearPendingResultCookie', () => {
	function makeCookies() {
		return { set: vi.fn(), delete: vi.fn(), get: vi.fn() };
	}

	let cookies: ReturnType<typeof makeCookies>;
	beforeEach(() => {
		cookies = makeCookies();
	});

	it('writes a signed value under PENDING_RESULT_COOKIE_NAME that verifies back', async () => {
		const payload = freshPayload();
		await setPendingResultCookie(cookies as never, payload);

		expect(cookies.set).toHaveBeenCalledTimes(1);
		const [name, value, options] = cookies.set.mock.calls[0];
		expect(name).toBe(PENDING_RESULT_COOKIE_NAME);
		expect(await verifyPendingResultToken(value)).toEqual({
			challengeId: payload.challengeId,
			durationMs: payload.durationMs
		});
		expect(options).toMatchObject({ httpOnly: true, path: '/', sameSite: 'lax' });
	});

	it('clearPendingResultCookie deletes the cookie (path /)', () => {
		clearPendingResultCookie(cookies as never);

		expect(cookies.delete).toHaveBeenCalledTimes(1);
		const [name, options] = cookies.delete.mock.calls[0];
		expect(name).toBe(PENDING_RESULT_COOKIE_NAME);
		expect(options).toMatchObject({ path: '/' });
	});
});
