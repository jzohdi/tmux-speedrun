/**
 * POST /api/auth/logout
 *
 * Clears the session cookie, returning the user to the anonymous state.
 * POST-only so it can't be triggered via a cross-site <img>/GET.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearSessionCookie } from '$lib/server/auth/session';

export const POST: RequestHandler = async ({ cookies }) => {
	clearSessionCookie(cookies);
	return json({ ok: true });
};
