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
	OAUTH_RETURN_COOKIE_NAME,
	CLI_LOGIN_COOKIE_NAME
} from '$lib/server/env';
import { verifyOAuthState } from '$lib/server/auth/state';
import { sanitizeReturnPath } from '$lib/server/auth/return-to';
import { exchangeCodeForToken, fetchGitHubUser } from '$lib/server/auth/github';
import { setSessionCookie, createSessionToken } from '$lib/server/auth/session';
import { verifyCliLoginState, buildLoopbackCallbackUrl } from '$lib/server/auth/cli-login';

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

		// Issue #35: CLI loopback branch. If this OAuth round-trip was started by
		// `tmux-speedrun login`, hand the freshly-minted (verified) session token
		// back to the waiting CLI over a strictly-guarded loopback redirect. The
		// browser cookie is still set (the user is logged into the website too).
		const cliRaw = cookies.get(CLI_LOGIN_COOKIE_NAME);
		if (cliRaw) {
			cookies.delete(CLI_LOGIN_COOKIE_NAME, { path: '/' }); // single-use
			const cli = await verifyCliLoginState(cliRaw);
			if (cli) {
				const sessionToken = await createSessionToken({
					githubId: ghUser.id,
					username: ghUser.login,
					iat: Date.now()
				});
				const loopback = buildLoopbackCallbackUrl({
					port: cli.port,
					cliState: cli.cliState,
					token: sessionToken
				});
				// Only path the token leaves over; guard failure falls through to home.
				if (loopback) redirect(302, loopback);
			}
		}
	} catch (err) {
		// Re-throw SvelteKit redirects; only treat real failures as OAuth errors.
		if (isRedirect(err)) throw err;
		redirect(302, '/?auth_error=oauth');
	}

	// Send the user back to where they left off, or home in a signed-in state.
	const safeReturn = sanitizeReturnPath(returnCookie);
	redirect(302, safeReturn ?? '/?signed_in=1');
};
