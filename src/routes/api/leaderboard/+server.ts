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
	const seconds = ms / 1000;

	if (seconds < 60) {
		return `${seconds.toFixed(2)}s`;
	}

	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;

	return `${minutes}m ${remainingSeconds.toFixed(2)}s`;
}

export type LeaderboardEntry = {
	rank: number;
	username: string;
	time: string;
	durationMs: number;
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
					durationMs: leaderboard.durationMs
				})
				.from(leaderboard)
				.where(eq(leaderboard.challengeId, String(id)))
				.orderBy(asc(leaderboard.durationMs))
				.limit(10);

			return {
				challengeId: id,
				entries: entries.map((entry, index) => ({
					rank: index + 1,
					username: entry.username ?? 'Anonymous',
					time: formatDuration(entry.durationMs),
					durationMs: entry.durationMs
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
