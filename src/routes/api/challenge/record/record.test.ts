/**
 * Tests for POST /api/challenge/record (iteration 3 — PR #36 feedback).
 *
 * `record` is the explicit "save my time" step that replaces the finish
 * endpoint's silent anonymous insert. It resolves identity at record time:
 *
 *   - signed in  → verified GitHub `username`/`githubId` from `locals.user`
 *   - signed out → Anonymous: `username: null`, `githubId` null
 *
 * Iteration 3 removes the free-text username entirely. The endpoint no longer
 * reads the request body for a name, so a client-supplied `username` is IGNORED
 * in BOTH branches — the only named entries are verified GitHub identities and
 * anonymous entries are always `null`. This strengthens the spoof-resistance
 * invariant end-to-end (interface §II0.1 / §II1).
 *
 * The deferred result travels in an HMAC-signed pending-result cookie; a
 * missing/expired/tampered cookie → 400. Recording is single-use: the cookie is
 * cleared on success, so a replay → 400. See `.agent/interface.md` §II1.
 *
 * `db`, the pending cookie, and the private env are mocked/real-signed so the
 * handler runs in isolation; assertions target `db.insert(...).values()`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { insertValues, selectWhere } = vi.hoisted(() => ({
	insertValues: vi.fn(),
	selectWhere: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({
	env: { SESSION_SECRET: 'test-session-secret-at-least-32-chars-long-xxxx' }
}));

vi.mock('$lib/server/db', () => ({
	db: {
		insert: () => ({ values: insertValues }),
		select: () => ({ from: () => ({ where: selectWhere }) })
	}
}));

import { POST } from './+server';
import { PENDING_RESULT_COOKIE_NAME } from '$lib/server/env';
import { createPendingResultToken } from '$lib/server/challenges/pending';

type MaybeUser = { githubId: number; username: string } | null;

async function makeEvent(opts: {
	user?: MaybeUser;
	body?: Record<string, unknown>;
	pending?: string | undefined; // raw cookie value; undefined ⇒ no cookie
	challengeId?: number;
	durationMs?: number;
}) {
	const { user = null, body = {}, challengeId = 3, durationMs = 12_340 } = opts;

	// Only synthesize a signed cookie when `pending` is omitted entirely. An
	// explicit `pending: undefined` means "no cookie" — a destructuring default
	// would otherwise fire on explicit undefined and mask the absent-cookie case.
	const pending =
		'pending' in opts
			? opts.pending
			: await createPendingResultToken({ challengeId, durationMs, iat: Date.now() });

	return {
		request: { json: async () => body },
		cookies: {
			get: (name: string) => (name === PENDING_RESULT_COOKIE_NAME ? pending : undefined),
			delete: vi.fn(),
			set: vi.fn()
		},
		locals: { user }
	};
}

beforeEach(() => {
	insertValues.mockReset().mockResolvedValue(undefined);
	selectWhere.mockReset().mockResolvedValue([{ count: 2 }]);
});

describe('POST /api/challenge/record — signed in (verified identity)', () => {
	it('records the verified GitHub username/id and ignores any body username', async () => {
		const event = await makeEvent({
			user: { githubId: 999, username: 'octocat' },
			body: { username: 'hacker' } // attempted spoof
		});

		const res = await POST(event as never);

		expect(insertValues).toHaveBeenCalledTimes(1);
		const values = insertValues.mock.calls[0][0];
		expect(values.username).toBe('octocat');
		expect(values.githubId).toBe(999);
		expect(values.username).not.toBe('hacker');
		expect(values.challengeId).toBe('3');

		const data = await res.json();
		expect(data.recorded).toBe(true);
		expect(data.username).toBe('octocat');
		expect(data.leaderboardPosition).toBe(3); // 2 faster + 1
	});

	it('clears the pending-result cookie (single-use)', async () => {
		const event = await makeEvent({ user: { githubId: 1, username: 'octocat' } });

		await POST(event as never);

		expect(event.cookies.delete).toHaveBeenCalledWith(
			PENDING_RESULT_COOKIE_NAME,
			expect.objectContaining({ path: '/' })
		);
	});
});

describe('POST /api/challenge/record — anonymous (always null username)', () => {
	it('records as Anonymous (null username, null githubId) when no name is given', async () => {
		const event = await makeEvent({ user: null, body: {} });

		await POST(event as never);

		const values = insertValues.mock.calls[0][0];
		expect(values.username ?? null).toBeNull();
		expect(values.githubId ?? null).toBeNull();
		expect(values.challengeId).toBe('3');
	});

	it('IGNORES a body username on the anonymous path — always records null', async () => {
		// Iteration 3: the free-text name is gone end-to-end. A crafted client body
		// carrying a `username` must NOT reach the leaderboard; the entry stays
		// Anonymous (null). This is the key iteration-3 invariant (§II0.1).
		const event = await makeEvent({ user: null, body: { username: 'sneaky-name' } });

		await POST(event as never);

		const values = insertValues.mock.calls[0][0];
		expect(values.username ?? null).toBeNull();
		expect(values.username).not.toBe('sneaky-name');
		expect(values.githubId ?? null).toBeNull();
	});

	it('reports the recorded username as null in the response', async () => {
		const event = await makeEvent({ user: null, body: { username: 'sneaky-name' } });

		const res = await POST(event as never);
		const data = await res.json();

		expect(data.recorded).toBe(true);
		expect(data.username ?? null).toBeNull();
		expect(data.leaderboardPosition).toBe(3); // 2 faster + 1
	});

	it('clears the pending-result cookie on the anonymous path (single-use)', async () => {
		const event = await makeEvent({ user: null, body: {} });

		await POST(event as never);

		expect(event.cookies.delete).toHaveBeenCalledWith(
			PENDING_RESULT_COOKIE_NAME,
			expect.objectContaining({ path: '/' })
		);
	});
});

describe('POST /api/challenge/record — no valid pending result', () => {
	async function expect400(event: unknown) {
		await expect(POST(event as never)).rejects.toMatchObject({ status: 400 });
		expect(insertValues).not.toHaveBeenCalled();
	}

	it('400s when the pending cookie is absent', async () => {
		await expect400(await makeEvent({ pending: undefined }));
	});

	it('400s when the pending cookie is garbage', async () => {
		await expect400(await makeEvent({ pending: 'not-a-valid-token' }));
	});

	it('400s when the pending cookie signature was tampered', async () => {
		const good = await createPendingResultToken({
			challengeId: 3,
			durationMs: 5000,
			iat: Date.now()
		});
		const [payloadPart, sigPart] = good.split('.');
		const flipped = sigPart[0] === 'A' ? 'B' : 'A';
		await expect400(await makeEvent({ pending: `${payloadPart}.${flipped}${sigPart.slice(1)}` }));
	});
});
