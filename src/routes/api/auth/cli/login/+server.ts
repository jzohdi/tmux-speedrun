/**
 * GET /api/auth/cli/login?port=<int>&state=<cliState>
 *
 * Starts the CLI-bound GitHub OAuth flow (issue #35, interface §4.3): validates
 * port + state, sets the OAuth CSRF `state` cookie AND the signed
 * `tmux_cli_login` cookie ({port, cliState}), then 302-redirects to GitHub.
 * Invalid input → redirect(302, '/?auth_error=cli'); OAuth unconfigured →
 * '/?auth_error=not_configured'.
 *
 * The same fixed callback path (`GITHUB_CALLBACK_PATH`) as the web flow is used,
 * so no new GitHub OAuth App entry is needed; the callback branches on the
 * presence of the `tmux_cli_login` cookie.
 */

import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	isGitHubOAuthConfigured,
	getGitHubOAuthConfig,
	getGitHubRedirectUri,
	OAUTH_STATE_COOKIE_NAME,
	OAUTH_STATE_COOKIE_OPTIONS,
	CLI_LOGIN_COOKIE_NAME,
	CLI_LOGIN_COOKIE_OPTIONS
} from '$lib/server/env';
import { generateOAuthState } from '$lib/server/auth/state';
import { buildAuthorizeUrl } from '$lib/server/auth/github';
import { signCliLoginState } from '$lib/server/auth/cli-login';

const CLI_STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const MIN_PORT = 1024;
const MAX_PORT = 65535;

export const GET: RequestHandler = async ({ url, cookies }) => {
	const portParam = url.searchParams.get('port');
	const stateParam = url.searchParams.get('state');

	const port = Number(portParam);
	const validPort =
		portParam !== null &&
		/^\d+$/.test(portParam) &&
		Number.isInteger(port) &&
		port >= MIN_PORT &&
		port <= MAX_PORT;
	const validState = stateParam !== null && CLI_STATE_PATTERN.test(stateParam);

	if (!validPort || !validState) {
		redirect(302, '/?auth_error=cli');
	}

	if (!isGitHubOAuthConfigured()) {
		redirect(302, '/?auth_error=not_configured');
	}

	const { clientId } = getGitHubOAuthConfig();

	// Standard OAuth CSRF state (reused from the web flow).
	const state = generateOAuthState();
	cookies.set(OAUTH_STATE_COOKIE_NAME, state, OAUTH_STATE_COOKIE_OPTIONS);

	// Mark this OAuth round-trip as CLI-bound (carries the loopback target).
	const cliLogin = await signCliLoginState({ port, cliState: stateParam as string });
	cookies.set(CLI_LOGIN_COOKIE_NAME, cliLogin, CLI_LOGIN_COOKIE_OPTIONS);

	const redirectUri = getGitHubRedirectUri(url);
	const authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri, state });

	redirect(302, authorizeUrl);
};
