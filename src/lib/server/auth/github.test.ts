/**
 * Tests for the GitHub OAuth `fetch` wrappers (`github.ts`).
 *
 * Network calls are exercised against a mocked global `fetch`.
 * See `.agent/interface.md` §4.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	GITHUB_AUTHORIZE_URL,
	GITHUB_TOKEN_URL,
	GITHUB_USER_URL,
	buildAuthorizeUrl,
	exchangeCodeForToken,
	fetchGitHubUser
} from './github';

const config = { clientId: 'client-id-123', clientSecret: 'super-secret-value' };
const redirectUri = 'https://app.example.com/api/auth/github/callback';

describe('buildAuthorizeUrl', () => {
	const url = () =>
		buildAuthorizeUrl({ clientId: config.clientId, redirectUri, state: 'state-token-abc' });

	it('targets the GitHub authorize endpoint', () => {
		expect(url().startsWith(GITHUB_AUTHORIZE_URL)).toBe(true);
	});

	it('includes client_id, redirect_uri and state', () => {
		const params = new URL(url()).searchParams;
		expect(params.get('client_id')).toBe(config.clientId);
		expect(params.get('redirect_uri')).toBe(redirectUri);
		expect(params.get('state')).toBe('state-token-abc');
	});

	it('requests an EMPTY scope (public profile only — no repo access)', () => {
		const params = new URL(url()).searchParams;
		const scope = params.get('scope');
		expect(scope === null || scope === '').toBe(true);
		expect(url()).not.toContain('repo');
	});

	it('never leaks the client secret into the (client-visible) URL', () => {
		expect(url()).not.toContain('client_secret');
		expect(url()).not.toContain(config.clientSecret);
	});
});

describe('exchangeCodeForToken', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('POSTs to the token endpoint and returns the access token', async () => {
		(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ access_token: 'gho_accesstoken', token_type: 'bearer' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);

		const token = await exchangeCodeForToken({ config, code: 'the-code', redirectUri });

		expect(token).toBe('gho_accesstoken');
		const [calledUrl] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(String(calledUrl)).toBe(GITHUB_TOKEN_URL);
	});

	it('throws when GitHub returns an error payload (no access_token)', async () => {
		(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ error: 'bad_verification_code' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);

		await expect(exchangeCodeForToken({ config, code: 'bad', redirectUri })).rejects.toThrow();
	});

	it('throws on a non-200 response', async () => {
		(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('nope', { status: 500 }));

		await expect(exchangeCodeForToken({ config, code: 'x', redirectUri })).rejects.toThrow();
	});
});

describe('fetchGitHubUser', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns the verified { id, login } from the user endpoint', async () => {
		(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response(JSON.stringify({ id: 583231, login: 'octocat', name: 'The Octocat' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);

		const user = await fetchGitHubUser('gho_accesstoken');

		expect(user).toEqual({ id: 583231, login: 'octocat' });
		const [calledUrl, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(String(calledUrl)).toBe(GITHUB_USER_URL);
		// GitHub requires a User-Agent, and the token must be sent as a Bearer credential.
		const headers = new Headers((init as RequestInit)?.headers);
		expect(headers.get('authorization')).toContain('gho_accesstoken');
		expect(headers.get('user-agent')).toBeTruthy();
	});

	it('throws on a non-200 response', async () => {
		(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			new Response('unauthorized', { status: 401 })
		);

		await expect(fetchGitHubUser('bad-token')).rejects.toThrow();
	});
});
