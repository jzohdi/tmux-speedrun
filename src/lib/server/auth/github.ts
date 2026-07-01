/**
 * Thin GitHub OAuth `fetch` wrappers.
 *
 * SCAFFOLD ONLY — signatures created by the tdd stage; see `.agent/interface.md` §4.
 * The implementation stage fills these in. `buildAuthorizeUrl` MUST NOT include the secret.
 */

import type { GitHubOAuthConfig } from '$lib/server/env';

export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_USER_URL = 'https://api.github.com/user';

/** Verified GitHub identity we care about. */
export type GitHubUser = { id: number; login: string };

/**
 * Build the authorize redirect URL. NOT IMPLEMENTED YET.
 */
export function buildAuthorizeUrl(params: {
	clientId: string;
	redirectUri: string;
	state: string;
}): string {
	void params;
	return '';
}

/**
 * Exchange the OAuth code for an access token (server-side; uses the secret).
 * NOT IMPLEMENTED YET.
 */
export async function exchangeCodeForToken(params: {
	config: GitHubOAuthConfig;
	code: string;
	redirectUri: string;
}): Promise<string> {
	void params;
	throw new Error('not implemented');
}

/**
 * Fetch the authenticated user. NOT IMPLEMENTED YET.
 */
export async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
	void accessToken;
	throw new Error('not implemented');
}
