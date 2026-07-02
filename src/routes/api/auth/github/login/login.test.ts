/**
 * Tests for GET /api/auth/github/login — the `return_to` stashing added in
 * iteration 2 (PR #36 feedback) for seamless login-after-finish.
 *
 * The login route accepts `?return_to=<local-path>`; a SAFE same-origin path is
 * stashed in a short-lived cookie so the callback can send the user back there.
 * Unsafe values (absolute URLs, protocol-relative, scheme, no leading slash) are
 * NOT stashed → the callback falls back to the default. See `.agent/interface.md`
 * §I7 / §I0.5. Everything else (state cookie, authorize redirect) is unchanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

import { GET } from './+server';
import { OAUTH_RETURN_COOKIE_NAME, OAUTH_STATE_COOKIE_NAME } from '$lib/server/env';

function makeEvent(returnTo: string | null) {
	const base = 'http://localhost:5173/api/auth/github/login';
	const url = new URL(
		returnTo === null ? base : `${base}?return_to=${encodeURIComponent(returnTo)}`
	);
	return {
		url,
		cookies: { set: vi.fn(), get: vi.fn(), delete: vi.fn() }
	};
}

function returnCookieCalls(event: ReturnType<typeof makeEvent>) {
	return event.cookies.set.mock.calls.filter((c) => c[0] === OAUTH_RETURN_COOKIE_NAME);
}

beforeEach(() => {
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
	mockEnv.GITHUB_CLIENT_ID = 'client-id';
	mockEnv.GITHUB_CLIENT_SECRET = 'client-secret';
});

describe('GET /api/auth/github/login — return_to handling', () => {
	it('still sets the CSRF state cookie and redirects to GitHub', async () => {
		const event = makeEvent(null);
		await expect(GET(event as never)).rejects.toMatchObject({ status: 302 });

		const stateCall = event.cookies.set.mock.calls.find((c) => c[0] === OAUTH_STATE_COOKIE_NAME);
		expect(stateCall).toBeDefined();
	});

	it('stashes a safe same-origin return path in the return cookie', async () => {
		const returnTo = '/challenge/2?completed=1&record=1';
		const event = makeEvent(returnTo);
		await expect(GET(event as never)).rejects.toMatchObject({ status: 302 });

		const calls = returnCookieCalls(event);
		expect(calls).toHaveLength(1);
		expect(calls[0][1]).toBe(returnTo);
		expect(calls[0][2]).toMatchObject({ httpOnly: true, path: '/', sameSite: 'lax' });
	});

	it('does NOT stash an unsafe (absolute / protocol-relative) return value', async () => {
		for (const bad of ['https://evil.com', '//evil.com', 'javascript:alert(1)', 'foo']) {
			const event = makeEvent(bad);
			await expect(GET(event as never)).rejects.toMatchObject({ status: 302 });
			expect(returnCookieCalls(event)).toHaveLength(0);
		}
	});

	it('does not set a return cookie when return_to is absent', async () => {
		const event = makeEvent(null);
		await expect(GET(event as never)).rejects.toMatchObject({ status: 302 });
		expect(returnCookieCalls(event)).toHaveLength(0);
	});
});
