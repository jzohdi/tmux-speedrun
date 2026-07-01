/**
 * Tests for GET /api/leaderboard — the `verified` flag added in iteration 2
 * (PR #36 feedback).
 *
 * Each entry now carries `verified: githubId != null` so the UI can badge
 * verified GitHub identities and a free-text name cannot visually impersonate
 * one. The `username ?? 'Anonymous'` fallback is unchanged.
 * See `.agent/interface.md` §I8.
 *
 * The DB query chain and the challenge-pool count are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { limitMock } = vi.hoisted(() => ({ limitMock: vi.fn() }));

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					orderBy: () => ({ limit: limitMock })
				})
			})
		})
	}
}));

vi.mock('$lib/server/challenges/pools', () => ({
	getChallengePoolCount: () => 1
}));

import { GET } from './+server';

function makeEvent() {
	return { setHeaders: vi.fn() };
}

beforeEach(() => {
	limitMock.mockReset().mockResolvedValue([
		{ username: 'octocat', durationMs: 1000, githubId: 42 },
		{ username: 'speedy', durationMs: 2000, githubId: null },
		{ username: null, durationMs: 3000, githubId: null }
	]);
});

describe('GET /api/leaderboard — verified flag', () => {
	it('marks entries with a githubId as verified and others as unverified', async () => {
		const res = await GET(makeEvent() as never);
		const body = await res.json();
		const entries = body['0'];

		expect(entries[0]).toMatchObject({ username: 'octocat', verified: true });
		expect(entries[1]).toMatchObject({ username: 'speedy', verified: false });
	});

	it('keeps the Anonymous fallback and marks null-username rows unverified', async () => {
		const res = await GET(makeEvent() as never);
		const body = await res.json();
		const entries = body['0'];

		expect(entries[2].username).toBe('Anonymous');
		expect(entries[2].verified).toBe(false);
	});

	it('exposes verified as a boolean on every entry', async () => {
		const res = await GET(makeEvent() as never);
		const body = await res.json();

		for (const entry of body['0']) {
			expect(typeof entry.verified).toBe('boolean');
		}
	});
});
