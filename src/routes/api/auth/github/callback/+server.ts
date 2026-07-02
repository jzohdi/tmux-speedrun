/**
 * GET /api/auth/github/callback
 *
 * GitHub redirects here with `code` + `state`. We verify the CSRF `state`
 * against the cookie, exchange the code for a token server-side (secret never
 * leaves the server), fetch the verified GitHub user, set a signed session
 * cookie, and redirect home. Any failure redirects home with an error signal.
 */

import { redirect, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getGitHubOAuthConfig,
	getGitHubRedirectUri,
	OAUTH_STATE_COOKIE_NAME,
	OAUTH_RETURN_COOKIE_NAME
} from '$lib/server/env';
import { verifyOAuthState } from '$lib/server/auth/state';
import { sanitizeReturnPath } from '$lib/server/auth/return-to';
import { exchangeCodeForToken, fetchGitHubUser } from '$lib/server/auth/github';
import { setSessionCookie } from '$lib/server/auth/session';

export const GET: RequestHandler = async ({ url, cookies }) => {
	// Read + clear the post-login return path (iteration 2). Clearing on every
	// path keeps it single-use; re-sanitized below as defense-in-depth.
	const returnCookie = cookies.get(OAUTH_RETURN_COOKIE_NAME);
	cookies.delete(OAUTH_RETURN_COOKIE_NAME, { path: '/' });

	const stateParam = url.searchParams.get('state');
	const stateCookie = cookies.get(OAUTH_STATE_COOKIE_NAME);

	if (!verifyOAuthState(stateParam, stateCookie)) {
		cookies.delete(OAUTH_STATE_COOKIE_NAME, { path: '/' });
		redirect(302, '/?auth_error=state');
	}

	// Single-use state — clear it now that it has been verified.
	cookies.delete(OAUTH_STATE_COOKIE_NAME, { path: '/' });

	const code = url.searchParams.get('code');
	if (!code) {
		redirect(302, '/?auth_error=oauth');
	}

	try {
		const config = getGitHubOAuthConfig();
		const redirectUri = getGitHubRedirectUri(url);
		const token = await exchangeCodeForToken({ config, code, redirectUri });
		const ghUser = await fetchGitHubUser(token);

		await setSessionCookie(cookies, {
			githubId: ghUser.id,
			username: ghUser.login,
			iat: Date.now()
		});
	} catch (err) {
		// Re-throw SvelteKit redirects; only treat real failures as OAuth errors.
		if (isRedirect(err)) throw err;
		redirect(302, '/?auth_error=oauth');
	}

	// Send the user back to where they left off, or home in a signed-in state.
	const safeReturn = sanitizeReturnPath(returnCookie);
	redirect(302, safeReturn ?? '/?signed_in=1');
};
