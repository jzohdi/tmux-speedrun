/**
 * GET /api/leaderboard
 *
 * Returns the top 10 leaderboard entries for all challenges.
 *
 * Response shape:
 * {
 *   "0": [{ rank: 1, username: "player", time: "12.34s", durationMs: 12340 }, ...],
 *   "1": [...],
 *   ...
 * }
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { eq, asc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { leaderboard } from '$lib/server/db/schema';
import { getChallengePoolCount } from '$lib/server/challenges/pools';

/**
 * Format duration in milliseconds to a human-readable string.
 * Examples: "12.34s", "1m 23.45s"
 */
function formatDuration(ms: number): string {
	// Round to centiseconds first so boundary values don't render with a
	// rounded-up seconds field (e.g. 59999ms as "60.00s" or 119999ms as
	// "1m 60.00s").
	const totalSeconds = Math.round(ms / 10) / 100;

	if (totalSeconds < 60) {
		return `${totalSeconds.toFixed(2)}s`;
	}

	const minutes = Math.floor(totalSeconds / 60);
	const remainingSeconds = totalSeconds - minutes * 60;

	return `${minutes}m ${remainingSeconds.toFixed(2)}s`;
}

/**
 * Strip control characters from a username before serving it. Current writes
 * are GitHub logins (safe charset), but legacy rows may hold free-text names;
 * without this a stored name could smuggle ANSI escapes into terminal clients.
 */
function sanitizeUsername(name: string): string {
	// eslint-disable-next-line no-control-regex
	return name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '');
}

export type LeaderboardEntry = {
	rank: number;
	username: string;
	time: string;
	durationMs: number;
	verified: boolean; // true iff githubId != null (a verified GitHub identity)
};

export type LeaderboardResponse = Record<string, LeaderboardEntry[]>;

export const GET: RequestHandler = async ({ setHeaders }) => {
	const challengeCount = getChallengePoolCount();
	const challengeIds = Array.from({ length: challengeCount }, (_, i) => i);

	// Fetch top 10 for each challenge in parallel
	const results = await Promise.all(
		challengeIds.map(async (id) => {
			const entries = await db
				.select({
					username: leaderboard.username,
					durationMs: leaderboard.durationMs,
					githubId: leaderboard.githubId
				})
				.from(leaderboard)
				.where(eq(leaderboard.challengeId, String(id)))
				.orderBy(asc(leaderboard.durationMs))
				.limit(10);

			return {
				challengeId: id,
				entries: entries.map((entry, index) => ({
					rank: index + 1,
					username: sanitizeUsername(entry.username ?? 'Anonymous'),
					time: formatDuration(entry.durationMs),
					durationMs: entry.durationMs,
					verified: entry.githubId != null
				}))
			};
		})
	);

	// Transform array to record keyed by challengeId
	const response: LeaderboardResponse = {};
	for (const result of results) {
		response[String(result.challengeId)] = result.entries;
	}

	// Set cache headers for CDN/browser caching
	// Fresh for 60 seconds, serve stale for up to 5 minutes while revalidating
	setHeaders({
		'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
	});

	return json(response);
};
