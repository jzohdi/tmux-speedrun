/**
 * Leaderboard query configuration for TanStack Query.
 *
 * Provides a createLeaderboardQuery function that returns a configured query
 * for fetching top 10 leaderboard entries for all challenges.
 */

import { createQuery, type CreateQueryResult } from '@tanstack/svelte-query';
import type { LeaderboardResponse, LeaderboardEntry } from '../../routes/api/leaderboard/+server';

// Re-export types for convenience
export type { LeaderboardResponse, LeaderboardEntry };

/**
 * Query key for leaderboard data.
 * Used for cache invalidation and deduplication.
 */
export const LEADERBOARD_QUERY_KEY = ['leaderboard'] as const;

/**
 * Fetch leaderboard data from the API.
 */
async function fetchLeaderboard(): Promise<LeaderboardResponse> {
	const response = await fetch('/api/leaderboard');

	if (!response.ok) {
		throw new Error(`Failed to fetch leaderboard: ${response.status}`);
	}

	const data: unknown = await response.json();

	return data as LeaderboardResponse;
}

/**
 * Type for the leaderboard query result.
 */
export type LeaderboardQueryResult = CreateQueryResult<LeaderboardResponse, Error>;

/**
 * Create a TanStack Query for leaderboard data.
 *
 * Configuration:
 * - staleTime: 60 seconds - data considered fresh, no refetch
 * - gcTime: 5 minutes - keep in cache after all observers unmount
 * - refetchOnWindowFocus: true - refresh when user returns to tab
 *
 * NOTE: In TanStack Query v6 for Svelte 5, createQuery expects an Accessor
 * (a function returning options) and returns a reactive result object (not a store).
 *
 * @returns A TanStack Query result object for leaderboard data
 */
export function createLeaderboardQuery(): LeaderboardQueryResult {
	return createQuery<LeaderboardResponse, Error>(() => ({
		queryKey: LEADERBOARD_QUERY_KEY,
		queryFn: fetchLeaderboard,
		staleTime: 60 * 1000, // Consider fresh for 60 seconds
		gcTime: 5 * 60 * 1000, // Keep in garbage collection cache for 5 minutes
		refetchOnWindowFocus: true // Refresh when user returns to tab
	}));
}

/**
 * Get leaderboard entries for a specific challenge from the response.
 *
 * @param data - The full leaderboard response
 * @param challengeId - The challenge ID (0-5)
 * @returns Array of leaderboard entries, or empty array if not found
 */
export function getEntriesForChallenge(
	data: LeaderboardResponse | undefined,
	challengeId: number | string
): LeaderboardEntry[] {
	if (!data) {
		return [];
	}

	return data[String(challengeId)] ?? [];
}
