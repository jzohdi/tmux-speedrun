/**
 * OAuth CSRF `state` helpers.
 *
 * SCAFFOLD ONLY — signatures created by the tdd stage; see `.agent/interface.md` §3.
 * The implementation stage fills these in.
 */

/** Cryptographically-random state token, URL-safe. NOT IMPLEMENTED YET. */
export function generateOAuthState(): string {
	return '';
}

/**
 * Constant-time compare of the callback's state param against the cookie value.
 * NOT IMPLEMENTED YET.
 */
export function verifyOAuthState(
	fromQuery: string | null,
	fromCookie: string | undefined
): boolean {
	void fromQuery;
	void fromCookie;
	return false;
}
