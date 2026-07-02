/**
 * Thin GitHub OAuth `fetch` wrappers.
 *
 * Uses only global `fetch` / web APIs (adapter-auto / Neon serverless compatible).
 * `buildAuthorizeUrl` MUST NOT include the secret (that URL is client-visible).
 *
 * See `.agent/interface.md` §4.
 */

import type { GitHubOAuthConfig } from '$lib/server/env';

export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_USER_URL = 'https://api.github.com/user';

/** Verified GitHub identity we care about. */
export type GitHubUser = { id: number; login: string };

/**
 * Build the authorize redirect URL.
 * Query params: client_id, redirect_uri, state, scope (EMPTY — public profile
 * only), allow_signup. MUST NOT include client_secret.
 */
export function buildAuthorizeUrl(params: {
	clientId: string;
	redirectUri: string;
	state: string;
}): string {
	const url = new URL(GITHUB_AUTHORIZE_URL);
	url.searchParams.set('client_id', params.clientId);
	url.searchParams.set('redirect_uri', params.redirectUri);
	url.searchParams.set('state', params.state);
	// Empty scope: public profile only, no repo access (issue requirement).
	url.searchParams.set('scope', '');
	url.searchParams.set('allow_signup', 'true');
	return url.toString();
}

/**
 * Exchange the OAuth code for an access token (server-side; uses the secret).
 * Throws on non-200, GitHub error payload, or missing access_token.
 */
export async function exchangeCodeForToken(params: {
	config: GitHubOAuthConfig;
	code: string;
	redirectUri: string;
}): Promise<string> {
	const response = await fetch(GITHUB_TOKEN_URL, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			client_id: params.config.clientId,
			client_secret: params.config.clientSecret,
			code: params.code,
			redirect_uri: params.redirectUri
		})
	});

	if (!response.ok) {
		throw new Error(`GitHub token exchange failed with status ${response.status}`);
	}

	const data = await response.json();
	if (!data || typeof data.access_token !== 'string' || data.access_token.length === 0) {
		const detail = data && typeof data.error === 'string' ? `: ${data.error}` : '';
		throw new Error(`GitHub token exchange returned no access_token${detail}`);
	}

	return data.access_token;
}

/**
 * Fetch the authenticated user. GitHub requires a User-Agent, and the token is
 * sent as a Bearer credential. Returns { id, login }. Throws on non-200 or
 * missing id/login.
 */
export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
	const response = await fetch(GITHUB_USER_URL, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: 'application/vnd.github+json',
			'User-Agent': 'tmux-speedrun'
		}
	});

	if (!response.ok) {
		throw new Error(`GitHub user fetch failed with status ${response.status}`);
	}

	const data = await response.json();
	if (!data || typeof data.id !== 'number' || typeof data.login !== 'string') {
		throw new Error('GitHub user response missing id/login');
	}

	return { id: data.id, login: data.login };
}
