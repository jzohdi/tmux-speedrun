/**
 * Leaderboard rendering for the CLI.
 *
 * TDD STUB — issue #35, interface §9.2 / §15. Renders the `GET /api/leaderboard`
 * response as human-readable table(s), or as raw JSON for `--json`.
 *
 * Bodies throw so tdd tests fail on the missing feature, not an import error.
 */

export type LeaderboardEntry = {
	rank: number;
	username: string;
	time: string;
	durationMs: number;
	verified: boolean;
};

/** Mirrors the server's `LeaderboardResponse`: challengeId → entries. */
export type LeaderboardResponse = Record<string, LeaderboardEntry[]>;

const NOT_IMPLEMENTED = 'leaderboard-table: not implemented (tdd stub)';

/** Render one or more challenge leaderboards as plain text. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function renderLeaderboardTable(data: LeaderboardResponse): string {
	throw new Error(NOT_IMPLEMENTED);
}

/** Render the raw response as pretty JSON (for `--json`). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function renderLeaderboardJson(data: LeaderboardResponse): string {
	throw new Error(NOT_IMPLEMENTED);
}
