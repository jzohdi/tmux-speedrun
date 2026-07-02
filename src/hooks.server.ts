import type { Handle } from '@sveltejs/kit';
import { SESSION_COOKIE_NAME } from '$lib/server/env';
import { verifySessionToken } from '$lib/server/auth/session';

/**
 * Read + verify the signed session cookie on every request and expose the
 * verified GitHub identity as `event.locals.user`. An absent or invalid cookie
 * yields `null` (verifySessionToken never throws on bad input).
 */
export const handle: Handle = async ({ event, resolve }) => {
	const raw = event.cookies.get(SESSION_COOKIE_NAME);
	event.locals.user = raw ? await verifySessionToken(raw) : null;
	return resolve(event);
};
