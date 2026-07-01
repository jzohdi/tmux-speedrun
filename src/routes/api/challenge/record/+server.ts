/**
 * POST /api/challenge/record
 *
 * Iteration 2 (PR #36 feedback): the explicit "save my time" step that replaces
 * the finish endpoint's silent anonymous insert. It resolves identity at record
 * time:
 *
 *   - signed in  → verified GitHub `username`/`githubId` from `locals.user`;
 *                  any body `username` is IGNORED (spoof-resistant, invariant I0.1)
 *   - signed out → optional sanitized free-text name, `githubId` null
 *
 * The deferred result travels in an HMAC-signed pending-result cookie; a
 * missing/expired/tampered cookie → 400. Recording is single-use: the cookie is
 * cleared on success, so a replay → 400. See `.agent/interface.md` §I6.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq, lt, and, count } from 'drizzle-orm';
import { parseRecordRequest } from '$lib/server/challenges/schemas';
import { PENDING_RESULT_COOKIE_NAME } from '$lib/server/env';
import { verifyPendingResultToken, clearPendingResultCookie } from '$lib/server/challenges/pending';
import { db } from '$lib/server/db';
import { leaderboard } from '$lib/server/db/schema';

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	// Verify the deferred result. Missing/expired/tampered → nothing to record.
	const pending = await verifyPendingResultToken(cookies.get(PENDING_RESULT_COOKIE_NAME) ?? '');
	if (!pending) {
		error(400, { message: 'No result to record.' });
	}

	const { challengeId, durationMs } = pending;

	// Parse the optional free-text username. A missing/empty body is allowed.
	let username: string | undefined;
	try {
		const body = await request.json().catch(() => ({}));
		({ username } = parseRecordRequest(body ?? {}));
	} catch {
		error(400, { message: 'Invalid request body.' });
	}

	// Identity resolution (invariant I0.1): a verified session always wins and the
	// body `username` is ignored. Free-text names apply only to anonymous entries.
	const user = locals.user;
	const insertValues = user
		? {
				challengeId: String(challengeId),
				durationMs,
				username: user.username,
				githubId: user.githubId
			}
		: {
				challengeId: String(challengeId),
				durationMs,
				username: username ?? null
			};

	let leaderboardPosition: number | undefined;
	try {
		await db.insert(leaderboard).values(insertValues);

		// Final rank: count of strictly-faster entries + 1.
		const result = await db
			.select({ count: count() })
			.from(leaderboard)
			.where(
				and(
					eq(leaderboard.challengeId, String(challengeId)),
					lt(leaderboard.durationMs, durationMs)
				)
			);
		leaderboardPosition = (result[0]?.count ?? 0) + 1;
	} catch (dbError) {
		// Log but don't fail the request — recording stays single-use regardless.
		console.error('Failed to record to leaderboard:', dbError);
	}

	// Single-use: clear the pending cookie so a replay yields a 400.
	clearPendingResultCookie(cookies);

	return json({
		recorded: true,
		leaderboardPosition,
		username: insertValues.username ?? null
	});
};
