/**
 * OAuth CSRF `state` helpers.
 *
 * See `.agent/interface.md` §3. The authorize step sets a random `state` cookie;
 * the callback rejects unless the `state` query param equals the cookie.
 */

import { randomBytes, bytesToBase64, stringToBytes, constantTimeEqual } from '$lib/crypto';

/** Cryptographically-random state token, URL-safe. */
export function generateOAuthState(): string {
	return bytesToBase64(randomBytes(32)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Constant-time compare of the callback's state param against the cookie value.
 * Returns false if either input is missing/empty.
 */
export function verifyOAuthState(
	fromQuery: string | null,
	fromCookie: string | undefined
): boolean {
	if (!fromQuery || !fromCookie) return false;
	return constantTimeEqual(stringToBytes(fromQuery), stringToBytes(fromCookie));
}
