/**
 * Tests for POST /api/challenge/finish.
 *
 * Iteration 2 (PR #36 feedback) changes the anonymous path: a signed-out finish
 * no longer inserts immediately. Instead it DEFERS — sets an HMAC-signed
 * pending-result cookie and returns a provisional rank with `recorded: false` —
 * so the user can later attach a free-text name or a verified GitHub identity via
 * POST /api/challenge/record. A signed-in finish still records immediately with
 * the verified `username`/`githubId` and sets NO pending cookie.
 *
 * Core invariant (unchanged, must not regress): the username/githubId stamped on
 * a leaderboard row comes ONLY from the server-verified session (`locals.user`),
 * never from the request body. See `.agent/interface.md` §I5 / §I0.1.
 *
 * `db`, `validateChallenge`, and the private env are mocked; the pending-cookie
 * helper is left to run for real (SESSION_SECRET is mocked). Assertions target
 * `db.insert(...).values()`, the JSON response, and the cookies set.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { insertValues, selectWhere, validateChallengeMock } = vi.hoisted(() => ({
	insertValues: vi.fn(),
	selectWhere: vi.fn(),
	validateChallengeMock: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({
	env: { SESSION_SECRET: 'test-session-secret-at-least-32-chars-long-xxxx' }
}));

vi.mock('$lib/server/challenges', () => ({ validateChallenge: validateChallengeMock }));

vi.mock('$lib/server/db', () => ({
	db: {
		insert: () => ({ values: insertValues }),
		select: () => ({ from: () => ({ where: selectWhere }) })
	}
}));

import { POST } from './+server';
import { CHALLENGE_COOKIE_NAME, PENDING_RESULT_COOKIE_NAME } from '$lib/server/env';

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

function pendingCookieCalls(event: ReturnType<typeof makeEvent>) {
	return event.cookies.set.mock.calls.filter((c) => c[0] === PENDING_RESULT_COOKIE_NAME);
}

beforeEach(() => {
	insertValues.mockReset().mockResolvedValue(undefined);
	selectWhere.mockReset().mockResolvedValue([{ count: 0 }]);
	validateChallengeMock.mockReset().mockResolvedValue(true);
});

describe('POST /api/challenge/finish — signed in (records immediately)', () => {
	it('stamps the verified GitHub username/id and returns recorded: true', async () => {
		const event = makeEvent({ githubId: 12345, username: 'octocat' });
		const res = await POST(event as never);

		expect(insertValues).toHaveBeenCalledTimes(1);
		const values = insertValues.mock.calls[0][0];
		expect(values.username).toBe('octocat');
		expect(values.githubId).toBe(12345);
		expect(values.challengeId).toBe('0');

		const data = await res.json();
		expect(data.valid).toBe(true);
		expect(data.recorded).toBe(true);
		expect(data.username).toBe('octocat');
		expect(data.leaderboardPosition).toBe(1);
	});

	it('does NOT set a pending-result cookie for a signed-in finish', async () => {
		const event = makeEvent({ githubId: 12345, username: 'octocat' });
		await POST(event as never);

		expect(pendingCookieCalls(event)).toHaveLength(0);
	});
});

describe('POST /api/challenge/finish — anonymous (defers the result)', () => {
	it('does NOT insert a row for an anonymous finish', async () => {
		const event = makeEvent(null);
		await POST(event as never);

		expect(insertValues).not.toHaveBeenCalled();
	});

	it('sets a signed pending-result cookie and returns recorded: false with a provisional rank', async () => {
		selectWhere.mockResolvedValue([{ count: 4 }]); // 4 faster entries ⇒ provisional #5
		const event = makeEvent(null);
		const res = await POST(event as never);

		const pending = pendingCookieCalls(event);
		expect(pending).toHaveLength(1);
		expect(typeof pending[0][1]).toBe('string');
		expect(pending[0][1].length).toBeGreaterThan(0);

		const data = await res.json();
		expect(data.valid).toBe(true);
		expect(data.recorded).toBe(false);
		expect(data.leaderboardPosition).toBe(5);
	});

	it('never lets a client-supplied username get recorded (deferred, not spoofable)', async () => {
		const event = makeEvent(null, { proofB64: 'proof-abc', username: 'hacker' });
		await POST(event as never);

		// Nothing is inserted at finish time, so no client value can reach a row.
		expect(insertValues).not.toHaveBeenCalled();
	});
});

describe('POST /api/challenge/finish — invalid proof (unchanged)', () => {
	it('returns { valid: false } and records nothing when the proof is invalid', async () => {
		validateChallengeMock.mockResolvedValue(false);
		const event = makeEvent(null);
		const res = await POST(event as never);

		const data = await res.json();
		expect(data.valid).toBe(false);
		expect(insertValues).not.toHaveBeenCalled();
		expect(pendingCookieCalls(event)).toHaveLength(0);
	});
});
