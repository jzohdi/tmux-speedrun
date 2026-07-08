/**
 * Leaderboard rendering for the CLI.
 *
 * Issue #35, interface §9.2 / §15. Renders the `GET /api/leaderboard` response as
 * human-readable table(s), or as raw JSON for `--json`. Pure string builders — no
 * I/O — so they are unit-testable and reusable by the `leaderboard` command.
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

const HEADERS = ['#', 'User', 'Time'] as const;

/** Pad `value` on the right to `width` columns. */
function padRight(value: string, width: number): string {
	return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

/**
 * Strip control characters from server-provided text before writing it to the
 * user's terminal, so a stored leaderboard name can never smuggle ANSI escape
 * sequences (title changes, OSC clipboard writes, …) into this TTY.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
function sanitizeForTerminal(text: string): string {
	return text.replace(CONTROL_CHARS, '');
}

/** Render a single challenge's entries as an aligned text block. */
function renderChallenge(challengeId: string, entries: LeaderboardEntry[]): string {
	const heading = `Challenge ${challengeId}`;

	if (entries.length === 0) {
		return `${heading}\n  (no entries yet)`;
	}

	// A trailing check-mark marks a verified GitHub identity (verified = githubId != null).
	const rows = entries.map((entry) => {
		const username = sanitizeForTerminal(entry.username);
		return [
			String(entry.rank),
			entry.verified ? `${username} ✓` : username,
			sanitizeForTerminal(entry.time)
		];
	});

	const widths = HEADERS.map((header, column) =>
		Math.max(header.length, ...rows.map((row) => row[column].length))
	);

	const formatRow = (cells: string[]): string =>
		'  ' +
		cells
			.map((cell, column) => padRight(cell, widths[column]))
			.join('  ')
			.trimEnd();

	const lines = [heading, formatRow([...HEADERS]), ...rows.map(formatRow)];
	return lines.join('\n');
}

/** Render one or more challenge leaderboards as plain text. */
export function renderLeaderboardTable(data: LeaderboardResponse): string {
	const challengeIds = Object.keys(data).sort((a, b) => Number(a) - Number(b));

	if (challengeIds.length === 0) {
		return 'No leaderboard data.';
	}

	return challengeIds.map((id) => renderChallenge(id, data[id])).join('\n\n');
}

/** Render the raw response as pretty JSON (for `--json`). */
export function renderLeaderboardJson(data: LeaderboardResponse): string {
	return JSON.stringify(data, null, 2);
}
