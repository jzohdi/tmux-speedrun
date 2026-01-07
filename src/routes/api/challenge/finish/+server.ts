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
import { parseFinishRequest, parseSessionCookie } from '$lib/server/challenges/schemas';
import { getSessionSecret, CHALLENGE_COOKIE_NAME } from '$lib/server/env';
import { db } from '$lib/server/db';
import { leaderboard } from '$lib/server/db/schema';

/**
 * Maximum allowed challenge duration (1 hour).
 * Challenges taking longer are considered expired.
 */
const MAX_CHALLENGE_DURATION_MS = 60 * 60 * 1000;

export const POST: RequestHandler = async ({ request, cookies }) => {
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

	// Parse and validate session data
	let sessionData;
	try {
		const parsed = JSON.parse(sessionCookieRaw);
		sessionData = parseSessionCookie(parsed);
	} catch {
		error(400, { message: 'Invalid session data. Please start a new challenge.' });
	}

	const { challengeId, sessionId, encryptedProof, startTime } = sessionData;

	// Calculate duration
	const endTime = Date.now();
	const durationMs = endTime - startTime;

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

	// Clear the session cookie (challenge completed)
	cookies.delete(CHALLENGE_COOKIE_NAME, { path: '/' });

	// Record to leaderboard
	let leaderboardPosition: number | undefined;
	try {
		// Insert the result
		await db.insert(leaderboard).values({
			challengeId: String(challengeId),
			durationMs
		});

		// Get leaderboard position (count of entries with faster times + 1)
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
		// Log error but don't fail the request - the challenge was still valid
		console.error('Failed to record to leaderboard:', dbError);
	}

	return json({
		valid: true,
		durationMs,
		leaderboardPosition
	});
};
