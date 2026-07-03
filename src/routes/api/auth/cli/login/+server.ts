/**
 * GET /api/auth/cli/login?port=<int>&state=<cliState>
 *
 * TDD STUB — issue #35, interface §4.3. Starts the CLI-bound GitHub OAuth flow:
 * validates port + state, sets the OAuth CSRF `state` cookie AND the signed
 * `tmux_cli_login` cookie ({port, cliState}), then 302-redirects to GitHub.
 * Invalid input → redirect(302, '/?auth_error=cli'); OAuth unconfigured →
 * '/?auth_error=not_configured'.
 *
 * The body is a placeholder so the endpoint test fails on the missing feature.
 */

import { redirect } from '@sveltejs/kit';

// Typed loosely to avoid depending on generated ./$types in the tdd stub.
type MinimalEvent = {
	url: URL;
	cookies: { set: (...a: unknown[]) => void; get: (name: string) => string | undefined; delete: (...a: unknown[]) => void };
};

export const GET = async (_event: MinimalEvent): Promise<Response> => {
	redirect(302, '/?auth_error=not_implemented');
};
