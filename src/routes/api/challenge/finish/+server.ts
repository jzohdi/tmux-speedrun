/**
 * POST /api/challenge/finish
 *
 * Validates challenge completion and records time to leaderboard.
 *
 * Flow:
 * 1. Validate request (proofB64)
 * 2. Read and validate session cookie
 * 3. Validate submitted proof against expected proof
 * 4. If valid, calculate duration and record to leaderboard
 * 5. Return result
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq, lt, and, count } from 'drizzle-orm';
import { validateChallenge } from '$lib/server/challenges';
import { parseFinishRequest } from '$lib/server/challenges/schemas';
import { verifyChallengeSessionToken } from '$lib/server/challenges/session-cookie';
import { getSessionSecret, CHALLENGE_COOKIE_NAME } from '$lib/server/env';
import { setPendingResultCookie } from '$lib/server/challenges/pending';
import { db } from '$lib/server/db';
import { leaderboard } from '$lib/server/db/schema';

/**
 * Maximum allowed challenge duration (1 hour).
 * Challenges taking longer are considered expired.
 */
const MAX_CHALLENGE_DURATION_MS = 60 * 60 * 1000;

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	// Parse and validate request body
	let requestData;
	try {
		const body = await request.json();
		requestData = parseFinishRequest(body);
	} catch (err) {
		if (err instanceof SyntaxError) {
			error(400, { message: 'Invalid JSON in request body' });
		}
		error(400, { message: 'Invalid request: ' + String(err) });
	}

	const { proofB64 } = requestData;

	// Read session cookie
	const sessionCookieRaw = cookies.get(CHALLENGE_COOKIE_NAME);
	if (!sessionCookieRaw) {
		error(400, { message: 'No active challenge session. Start a challenge first.' });
	}

	// Verify the HMAC-signed session cookie — a tampered/unsigned cookie is
	// rejected, so startTime and challengeId are server-authoritative.
	const sessionData = await verifyChallengeSessionToken(sessionCookieRaw);
	if (!sessionData) {
		error(400, { message: 'Invalid session data. Please start a new challenge.' });
	}

	const { challengeId, sessionId, encryptedProof, startTime } = sessionData;

	// Calculate duration
	const endTime = Date.now();
	const durationMs = endTime - startTime;

	// A signed cookie can still only come from this server, so a non-positive
	// duration means clock corruption — never a legitimate run.
	if (durationMs <= 0) {
		cookies.delete(CHALLENGE_COOKIE_NAME, { path: '/' });
		error(400, { message: 'Invalid challenge timing. Please start a new challenge.' });
	}

	// Check if challenge has expired
	if (durationMs > MAX_CHALLENGE_DURATION_MS) {
		// Clear the expired cookie
		cookies.delete(CHALLENGE_COOKIE_NAME, { path: '/' });
		error(400, { message: 'Challenge session expired. Please start a new challenge.' });
	}

	// Validate the proof
	const serverSecret = getSessionSecret();
	const isValid = await validateChallenge(serverSecret, sessionId, encryptedProof, proofB64);

	if (!isValid) {
		return json({
			valid: false,
			durationMs: 0,
			message: 'Invalid proof. Challenge not completed correctly.'
		});
	}

	// Clear the challenge session cookie (the crypto challenge is spent either way).
	cookies.delete(CHALLENGE_COOKIE_NAME, { path: '/' });

	// Iteration 2 (PR #36 feedback): identity is resolved at record time.
	//
	// - Signed in already → record immediately with the verified GitHub identity
	//   (comes ONLY from locals.user, never the request body → non-spoofable).
	// - Anonymous → DEFER: do not insert. Stash the result in a signed
	//   pending-result cookie and return a provisional rank, so the user can
	//   later attach a free-text name or a verified identity via /api/challenge/record.
	const user = locals.user;

	/** Count entries with strictly faster times for this challenge (+1 = rank). */
	async function computeRank(): Promise<number | undefined> {
		const result = await db
			.select({ count: count() })
			.from(leaderboard)
			.where(
				and(
					eq(leaderboard.challengeId, String(challengeId)),
					lt(leaderboard.durationMs, durationMs)
				)
			);
		return (result[0]?.count ?? 0) + 1;
	}

	if (user) {
		let leaderboardPosition: number | undefined;
		try {
			// onConflictDoNothing on the unique sessionId: a replayed cookie+proof
			// cannot insert a second row for the same challenge session.
			await db
				.insert(leaderboard)
				.values({
					challengeId: String(challengeId),
					durationMs,
					username: user.username,
					githubId: user.githubId,
					sessionId
				})
				.onConflictDoNothing({ target: leaderboard.sessionId });
			leaderboardPosition = await computeRank();
		} catch (dbError) {
			// Log error but don't fail the request - the challenge was still valid
			console.error('Failed to record to leaderboard:', dbError);
		}

		return json({
			valid: true,
			durationMs,
			recorded: true,
			leaderboardPosition,
			username: user.username
		});
	}

	// Anonymous: defer the result behind a signed cookie; provide a provisional rank.
	// sessionId travels in the signed payload so record's insert stays replay-proof.
	await setPendingResultCookie(cookies, { challengeId, durationMs, sessionId, iat: Date.now() });

	let leaderboardPosition: number | undefined;
	try {
		leaderboardPosition = await computeRank();
	} catch (dbError) {
		console.error('Failed to compute provisional rank:', dbError);
	}

	return json({
		valid: true,
		durationMs,
		recorded: false,
		leaderboardPosition
	});
};
