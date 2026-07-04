/**
 * Failing tests for GET /api/auth/cli/login — issue #35, interface §4.3 / §15.
 *
 * Valid { port, state } starts a CLI-bound OAuth round-trip: it sets the OAuth
 * CSRF state cookie AND the signed `tmux_cli_login` cookie, then redirects to
 * GitHub's authorize URL. Invalid port/state → redirect to '/?auth_error=cli'.
 *
 * These fail because the endpoint is a not-yet-implemented stub.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

import { GET } from './+server';
import { OAUTH_STATE_COOKIE_NAME } from '$lib/server/env';

// The CLI-login cookie name is added to env.ts by the implementation stage;
// referenced here as a literal so this test does not depend on the new export.
const CLI_LOGIN_COOKIE_NAME = 'tmux_cli_login';

const VALID_CLI_STATE = 'abcDEF012_-ghijklmnop';

function makeEvent(query: string) {
	const url = new URL(`http://localhost:5173/api/auth/cli/login${query}`);
	return { url, cookies: { set: vi.fn(), get: vi.fn(), delete: vi.fn() } };
}

beforeEach(() => {
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
	mockEnv.SESSION_SECRET = 'test-session-secret-at-least-32-chars-long-xxxx';
	mockEnv.GITHUB_CLIENT_ID = 'client-id';
	mockEnv.GITHUB_CLIENT_SECRET = 'client-secret';
});

describe('GET /api/auth/cli/login — valid CLI-bound OAuth start', () => {
	it('redirects (302) to the GitHub authorize URL', async () => {
		const event = makeEvent(`?port=49876&state=${VALID_CLI_STATE}`);
		await expect(GET(event as never)).rejects.toMatchObject({
			status: 302,
			location: expect.stringContaining('github.com/login/oauth/authorize')
		});
	});

	it('sets the OAuth CSRF state cookie', async () => {
		const event = makeEvent(`?port=49876&state=${VALID_CLI_STATE}`);
		await expect(GET(event as never)).rejects.toMatchObject({ status: 302 });
		const stateCall = event.cookies.set.mock.calls.find((c) => c[0] === OAUTH_STATE_COOKIE_NAME);
		expect(stateCall).toBeDefined();
	});

	it('sets the signed tmux_cli_login cookie carrying the CLI round-trip state', async () => {
		const event = makeEvent(`?port=49876&state=${VALID_CLI_STATE}`);
		await expect(GET(event as never)).rejects.toMatchObject({ status: 302 });
		const cliCall = event.cookies.set.mock.calls.find((c) => c[0] === CLI_LOGIN_COOKIE_NAME);
		expect(cliCall).toBeDefined();
		expect(typeof cliCall?.[1]).toBe('string');
		expect((cliCall?.[1] as string).length).toBeGreaterThan(0);
	});
});

describe('GET /api/auth/cli/login — invalid input', () => {
	it('redirects to /?auth_error=cli for an out-of-range port', async () => {
		const event = makeEvent(`?port=80&state=${VALID_CLI_STATE}`);
		await expect(GET(event as never)).rejects.toMatchObject({
			status: 302,
			location: '/?auth_error=cli'
		});
		expect(event.cookies.set.mock.calls.find((c) => c[0] === CLI_LOGIN_COOKIE_NAME)).toBeUndefined();
	});

	it('redirects to /?auth_error=cli for a malformed state', async () => {
		const event = makeEvent('?port=49876&state=bad%20state');
		await expect(GET(event as never)).rejects.toMatchObject({
			status: 302,
			location: '/?auth_error=cli'
		});
	});
});
