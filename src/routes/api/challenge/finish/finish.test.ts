/**
 * Tests for POST /api/challenge/finish — attaching the verified GitHub username.
 *
 * Core invariant (issue acceptance criteria): the username/githubId stamped on a
 * leaderboard row comes ONLY from the server-verified session (`locals.user`),
 * never from the request body. See `.agent/interface.md` §0.1 and §8.
 *
 * `db`, `validateChallenge`, and the private env are mocked so the handler runs
 * in isolation; assertions target the values passed to `db.insert(...).values()`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { insertValues, selectWhere, validateChallengeMock } = vi.hoisted(() => ({
	insertValues: vi.fn(),
	selectWhere: vi.fn(),
	validateChallengeMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({
	env: { SESSION_SECRET: 'test-session-secret-at-least-32-chars-long' }
}));

vi.mock('$lib/server/challenges', () => ({ validateChallenge: validateChallengeMock }));

vi.mock('$lib/server/db', () => ({
	db: {
		insert: () => ({ values: insertValues }),
		select: () => ({ from: () => ({ where: selectWhere }) })
	}
}));

import { POST } from './+server';
import { CHALLENGE_COOKIE_NAME } from '$lib/server/env';

type MaybeUser = { githubId: number; username: string } | null;

function makeEvent(user: MaybeUser, body: Record<string, unknown> = { proofB64: 'proof-abc' }) {
	const session = {
		challengeId: 0,
		sessionId: 'sess-1',
		encryptedProof: 'encrypted-proof',
		startTime: Date.now() - 1000
	};
	return {
		request: { json: async () => body },
		cookies: {
			get: (name: string) => (name === CHALLENGE_COOKIE_NAME ? JSON.stringify(session) : undefined),
			delete: vi.fn(),
			set: vi.fn()
		},
		locals: { user }
	};
}

beforeEach(() => {
	insertValues.mockReset().mockResolvedValue(undefined);
	selectWhere.mockReset().mockResolvedValue([{ count: 0 }]);
	validateChallengeMock.mockReset().mockResolvedValue(true);
});

describe('POST /api/challenge/finish — verified username', () => {
	it("stamps the signed-in user's GitHub username (and id) on the leaderboard row", async () => {
		await POST(makeEvent({ githubId: 12345, username: 'octocat' }) as never);

		expect(insertValues).toHaveBeenCalledTimes(1);
		const values = insertValues.mock.calls[0][0];
		expect(values.username).toBe('octocat');
		expect(values.githubId).toBe(12345);
		expect(values.challengeId).toBe('0');
	});

	it('inserts an anonymous row (no username/githubId) when no user is signed in', async () => {
		await POST(makeEvent(null) as never);

		expect(insertValues).toHaveBeenCalledTimes(1);
		const values = insertValues.mock.calls[0][0];
		expect(values.username ?? null).toBeNull();
		expect(values.githubId ?? null).toBeNull();
	});

	it('never lets a client-supplied username reach the row (not spoofable)', async () => {
		await POST(makeEvent(null, { proofB64: 'proof-abc', username: 'hacker' }) as never);

		expect(insertValues).toHaveBeenCalledTimes(1);
		const values = insertValues.mock.calls[0][0];
		expect(values.username ?? null).not.toBe('hacker');
	});
});
