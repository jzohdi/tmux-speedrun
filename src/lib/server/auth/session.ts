/**
 * Signed, stateless, cookie-based session for verified GitHub identities.
 *
 * SCAFFOLD ONLY — the tdd stage created these signatures so the failing tests
 * fail on assertions (missing behavior) rather than import errors. The
 * implementation stage fills these in per `.agent/interface.md` §2.
 */

import type { Cookies } from '@sveltejs/kit';

/** The session payload embedded in the signed cookie. */
export type SessionPayload = {
	githubId: number; // stable numeric GitHub id
	username: string; // GitHub login (verified)
	iat: number; // issued-at, epoch ms
};

/** The subset exposed to the app as event.locals.user. */
export type SessionUser = {
	githubId: number;
	username: string;
};

/**
 * Serialize + sign a session payload into a cookie string value.
 * NOT IMPLEMENTED YET.
 */
export async function createSessionToken(payload: SessionPayload): Promise<string> {
	void payload;
	return '';
}

/**
 * Verify signature + parse. Returns the SessionUser on success, or null on any failure.
 * NOT IMPLEMENTED YET.
 */
export async function verifySessionToken(raw: string): Promise<SessionUser | null> {
	void raw;
	return null;
}

/**
 * Set the signed session cookie.
 * NOT IMPLEMENTED YET.
 */
export async function setSessionCookie(cookies: Cookies, payload: SessionPayload): Promise<void> {
	void cookies;
	void payload;
}

/**
 * Delete the session cookie.
 * NOT IMPLEMENTED YET.
 */
export function clearSessionCookie(cookies: Cookies): void {
	void cookies;
}
