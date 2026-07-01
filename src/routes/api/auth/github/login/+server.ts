/**
 * GET /api/auth/github/login
 *
 * Starts the GitHub OAuth Authorization Code flow: sets a random CSRF `state`
 * cookie and 302-redirects to GitHub's authorize URL. When OAuth is not
 * configured, redirects home with an error signal (never a 500).
 */

import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	isGitHubOAuthConfigured,
	getGitHubOAuthConfig,
	getGitHubRedirectUri,
	OAUTH_STATE_COOKIE_NAME,
	OAUTH_STATE_COOKIE_OPTIONS,
	OAUTH_RETURN_COOKIE_NAME,
	OAUTH_RETURN_COOKIE_OPTIONS
} from '$lib/server/env';
import { generateOAuthState } from '$lib/server/auth/state';
import { sanitizeReturnPath } from '$lib/server/auth/return-to';
import { buildAuthorizeUrl } from '$lib/server/auth/github';

export const GET: RequestHandler = async ({ cookies, url }) => {
	if (!isGitHubOAuthConfigured()) {
		redirect(302, '/?auth_error=not_configured');
	}

	const { clientId } = getGitHubOAuthConfig();
	const state = generateOAuthState();
	cookies.set(OAUTH_STATE_COOKIE_NAME, state, OAUTH_STATE_COOKIE_OPTIONS);

	// Iteration 2 (PR #36 feedback): stash a validated same-origin return path so
	// the callback can send the user back to where they left off (login-after-finish).
	// Unsafe values are dropped (open-redirect guard) → callback falls back to default.
	const safeReturn = sanitizeReturnPath(url.searchParams.get('return_to'));
	if (safeReturn) {
		cookies.set(OAUTH_RETURN_COOKIE_NAME, safeReturn, OAUTH_RETURN_COOKIE_OPTIONS);
	}

	const redirectUri = getGitHubRedirectUri(url);
	const authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri, state });

	redirect(302, authorizeUrl);
};
