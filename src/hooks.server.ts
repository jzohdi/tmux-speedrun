import type { Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { SESSION_COOKIE_NAME } from '$lib/server/env';
import { verifySessionToken } from '$lib/server/auth/session';

/**
 * Read + verify the signed session cookie on every request and expose the
 * verified GitHub identity as `event.locals.user`. An absent or invalid cookie
 * yields `null` (verifySessionToken never throws on bad input).
 *
 * Also stamps baseline security headers on every response. The CSP itself is
 * configured in svelte.config.js (kit.csp) so SvelteKit can nonce its inline
 * hydration scripts.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const raw = event.cookies.get(SESSION_COOKIE_NAME);
	event.locals.user = raw ? await verifySessionToken(raw) : null;

	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	if (!dev) {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
	return response;
};
