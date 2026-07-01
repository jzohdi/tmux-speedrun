/**
 * Server-side environment configuration.
 *
 * This module provides type-safe access to required environment variables
 * and validates their presence at startup.
 *
 * Required environment variables:
 * - SESSION_SECRET: 32+ character secret for signing cookies and encrypting proofs
 *
 * Note: Uses SvelteKit's $env/dynamic/private for proper environment variable handling.
 */

import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { stringToBytes } from '$lib/crypto';

/**
 * Get the session secret as bytes for cryptographic operations.
 *
 * The session secret is used to:
 * 1. Sign session cookies (prevent tampering)
 * 2. Encrypt expected proofs (stateless validation)
 *
 * @returns Session secret as Uint8Array
 * @throws Error if SESSION_SECRET is not set or too short
 */
export function getSessionSecret(): Uint8Array<ArrayBuffer> {
	const secret = env.SESSION_SECRET;

	if (!secret) {
		throw new Error(
			'SESSION_SECRET environment variable is required. ' +
				'Generate one with: openssl rand -base64 32'
		);
	}

	if (secret.length < 32) {
		throw new Error(
			'SESSION_SECRET must be at least 32 characters. ' +
				'Generate one with: openssl rand -base64 32'
		);
	}

	return stringToBytes(secret);
}

/**
 * Validate that all required environment variables are set.
 * Call this at application startup.
 *
 * @throws Error if any required variable is missing
 */
export function validateEnvironment(): void {
	getSessionSecret();
}

/**
 * Get the challenge session cookie name.
 */
export const CHALLENGE_COOKIE_NAME = 'tmux_challenge_session';

/**
 * Default cookie options for the challenge session.
 */
export const COOKIE_OPTIONS = {
	httpOnly: true,
	secure: !dev, // Secure in production, not in dev
	sameSite: 'lax' as const,
	path: '/',
	maxAge: 60 * 60 // 1 hour TTL
};

// ---------------------------------------------------------------------------
// GitHub OAuth / auth session configuration.
//
// SCAFFOLD ONLY — constants and getter signatures added by the tdd stage so the
// failing auth tests fail on assertions rather than import errors. The getter
// bodies are NOT implemented; the implementation stage fills them in per
// `.agent/interface.md` §1.
// ---------------------------------------------------------------------------

/** Auth session cookie name. */
export const SESSION_COOKIE_NAME = 'tmux_session';

/** OAuth CSRF state cookie name. */
export const OAUTH_STATE_COOKIE_NAME = 'tmux_oauth_state';

/** Long-lived auth session cookie (30 days). sameSite 'lax' so it survives the GitHub redirect. */
export const SESSION_COOKIE_OPTIONS = {
	httpOnly: true,
	secure: !dev,
	sameSite: 'lax' as const,
	path: '/',
	maxAge: 60 * 60 * 24 * 30 // 30 days
};

/** Short-lived CSRF state cookie (10 min). */
export const OAUTH_STATE_COOKIE_OPTIONS = {
	httpOnly: true,
	secure: !dev,
	sameSite: 'lax' as const,
	path: '/',
	maxAge: 60 * 10 // 10 minutes
};

/** Fixed OAuth callback path. The GitHub OAuth App callback URL must be `${ORIGIN}` + this. */
export const GITHUB_CALLBACK_PATH = '/api/auth/github/callback';

export type GitHubOAuthConfig = { clientId: string; clientSecret: string };

/**
 * Reads GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET from $env/dynamic/private.
 * Throws a clear Error if either is missing/empty.
 * NOT IMPLEMENTED YET.
 */
export function getGitHubOAuthConfig(): GitHubOAuthConfig {
	throw new Error('not implemented');
}

/** true when both GitHub OAuth env vars are present (non-empty). NOT IMPLEMENTED YET. */
export function isGitHubOAuthConfigured(): boolean {
	return false;
}

/**
 * Resolve the absolute OAuth redirect URI. NOT IMPLEMENTED YET.
 */
export function getGitHubRedirectUri(requestUrl: URL): string {
	void requestUrl;
	return '';
}
