/**
 * Failing tests for leaderboard rendering (`leaderboard-table.ts`) — issue #35,
 * interface §9.2 / §15. The table shows rank, username, and time; `--json`
 * emits the raw response verbatim (round-trips through JSON.parse).
 *
 * These fail because the render functions are not-yet-implemented stubs.
 */

import { describe, it, expect } from 'vitest';
import {
	renderLeaderboardTable,
	renderLeaderboardJson,
	type LeaderboardResponse
} from './leaderboard-table';

const data: LeaderboardResponse = {
	'0': [
		{ rank: 1, username: 'octocat', time: '12.3s', durationMs: 12300, verified: true },
		{ rank: 2, username: 'Anonymous', time: '15.0s', durationMs: 15000, verified: false }
	]
};

describe('renderLeaderboardTable', () => {
	it('renders rank, username and time for each entry', () => {
		const out = renderLeaderboardTable(data);
		expect(out).toContain('octocat');
		expect(out).toContain('12.3s');
		expect(out).toContain('Anonymous');
		expect(out).toContain('15.0s');
	});

	it('includes the challenge id as a heading', () => {
		expect(renderLeaderboardTable(data)).toContain('0');
	});

	it('handles an empty leaderboard without throwing', () => {
		expect(() => renderLeaderboardTable({ '0': [] })).not.toThrow();
	});
});

describe('renderLeaderboardJson', () => {
	it('emits the raw response, round-tripping through JSON.parse', () => {
		const out = renderLeaderboardJson(data);
		expect(JSON.parse(out)).toEqual(data);
	});
});
