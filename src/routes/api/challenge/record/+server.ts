/**
 * POST /api/challenge/record
 *
 * Iteration 2 (PR #36 feedback): the explicit "save my time" step that replaces
 * the finish endpoint's silent anonymous insert.
 *
 * Iteration 3 (PR #36 feedback): the free-text username is removed end-to-end.
 * The endpoint no longer reads the request body for a name, so identity is
 * resolved purely from the session:
 *
 *   - signed in  → verified GitHub `username`/`githubId` from `locals.user`
 *   - signed out → Anonymous: `username: null`, `githubId` null
 *
 * A client-supplied `username` can therefore never reach the leaderboard, which
 * strengthens the spoof-resistance invariant (§II0.1).
 *
 * The deferred result travels in an HMAC-signed pending-result cookie; a
 * missing/expired/tampered cookie → 400. Recording is single-use: the cookie is
 * cleared on success, so a replay → 400. See `.agent/interface.md` §II1.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq, lt, and, count } from 'drizzle-orm';
import { PENDING_RESULT_COOKIE_NAME } from '$lib/server/env';
import { verifyPendingResultToken, clearPendingResultCookie } from '$lib/server/challenges/pending';
import { db } from '$lib/server/db';
import { leaderboard } from '$lib/server/db/schema';

export const POST: RequestHandler = async ({ cookies, locals }) => {
	// Verify the deferred result. Missing/expired/tampered → nothing to record.
	const pending = await verifyPendingResultToken(cookies.get(PENDING_RESULT_COOKIE_NAME) ?? '');
	if (!pending) {
		error(400, { message: 'No result to record.' });
	}

	const { challengeId, durationMs, sessionId } = pending;

	// Identity resolution (invariant II0.1): the only named entries are verified
	// GitHub identities; anonymous entries are always null. No request body is
	// read, so a client can never inject a username.
	const user = locals.user;
	const insertValues = user
		? {
				challengeId: String(challengeId),
				durationMs,
				username: user.username,
				githubId: user.githubId,
				sessionId
			}
		: {
				challengeId: String(challengeId),
				durationMs,
				username: null,
				sessionId
			};

	let leaderboardPosition: number | undefined;
	try {
		// onConflictDoNothing on the unique sessionId: replaying a retained pending
		// cookie (the client controls its cookie jar) cannot duplicate the row.
		await db.insert(leaderboard).values(insertValues).onConflictDoNothing({
			target: leaderboard.sessionId
		});

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
