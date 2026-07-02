/**
 * Tests for GET /api/auth/github/callback — the `return_to` redirect added in
 * iteration 2 (PR #36 feedback) for seamless login-after-finish.
 *
 * After a successful token exchange + session cookie, the callback reads and
 * CLEARS the return cookie, re-validates it (defense-in-depth), and redirects to
 * that local path — or falls back to `/?signed_in=1` when it is absent/unsafe.
 * CSRF/state handling and error paths are otherwise unchanged.
 * See `.agent/interface.md` §I7.
 *
 * The GitHub network calls and the session cookie are mocked; `verifyOAuthState`
 * and `sanitizeReturnPath` run for real.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv, exchangeMock, fetchUserMock, setSessionMock } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>,
	exchangeMock: vi.fn(),
	fetchUserMock: vi.fn(),
	setSessionMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

vi.mock('$lib/server/auth/github', () => ({
	exchangeCodeForToken: exchangeMock,
	fetchGitHubUser: fetchUserMock
}));

vi.mock('$lib/server/auth/session', () => ({
	setSessionCookie: setSessionMock
}));

import { GET } from './+server';
import { OAUTH_STATE_COOKIE_NAME, OAUTH_RETURN_COOKIE_NAME } from '$lib/server/env';

const STATE = 'state-token-123';

function makeEvent(opts: { returnCookie?: string | undefined } = {}) {
	const { returnCookie } = opts;
	const url = new URL(
		`http://localhost:5173/api/auth/github/callback?code=the-code&state=${STATE}`
	);
	const store: Record<string, string | undefined> = {
		[OAUTH_STATE_COOKIE_NAME]: STATE,
		[OAUTH_RETURN_COOKIE_NAME]: returnCookie
	};
	return {
		url,
		cookies: {
			get: (name: string) => store[name],
			set: vi.fn(),
			delete: vi.fn()
		}
	};
}

beforeEach(() => {
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
	mockEnv.GITHUB_CLIENT_ID = 'client-id';
	mockEnv.GITHUB_CLIENT_SECRET = 'client-secret';
	exchangeMock.mockReset().mockResolvedValue('gho_token');
	fetchUserMock.mockReset().mockResolvedValue({ id: 42, login: 'octocat' });
	setSessionMock.mockReset().mockResolvedValue(undefined);
});

describe('GET /api/auth/github/callback — return_to redirect', () => {
	it('redirects to the stashed local path and clears the return cookie', async () => {
		const returnPath = '/challenge/2?completed=1&record=1';
		const event = makeEvent({ returnCookie: returnPath });

		await expect(GET(event as never)).rejects.toMatchObject({ status: 302, location: returnPath });
		expect(setSessionMock).toHaveBeenCalledTimes(1);
		expect(event.cookies.delete).toHaveBeenCalledWith(
			OAUTH_RETURN_COOKIE_NAME,
			expect.objectContaining({ path: '/' })
		);
	});

	it('falls back to /?signed_in=1 when there is no return cookie', async () => {
		const event = makeEvent({ returnCookie: undefined });

		await expect(GET(event as never)).rejects.toMatchObject({
			status: 302,
			location: '/?signed_in=1'
		});
	});

	it('falls back to the default when the return cookie is unsafe (defense-in-depth)', async () => {
		const event = makeEvent({ returnCookie: 'https://evil.com' });

		await expect(GET(event as never)).rejects.toMatchObject({
			status: 302,
			location: '/?signed_in=1'
		});
	});
});
