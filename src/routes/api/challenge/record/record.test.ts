/**
 * Tests for POST /api/challenge/record (iteration 2 — PR #36 feedback).
 *
 * `record` is the explicit "save my time" step that replaces the finish
 * endpoint's silent anonymous insert. It resolves identity at record time:
 *
 *   - signed in  → verified GitHub `username`/`githubId` from `locals.user`;
 *                  any body `username` is IGNORED (spoof-resistant, invariant I0.1)
 *   - signed out → optional sanitized free-text name, `githubId` null
 *
 * The deferred result travels in an HMAC-signed pending-result cookie; a
 * missing/expired/tampered cookie → 400. Recording is single-use: the cookie is
 * cleared on success, so a replay → 400. See `.agent/interface.md` §I6 / §I0.
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
	const {
		user = null,
		body = {},
		challengeId = 3,
		durationMs = 12_340,
		pending = await createPendingResultToken({ challengeId, durationMs, iat: Date.now() })
	} = opts;

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

describe('POST /api/challenge/record — anonymous (free-text name)', () => {
	it('records the sanitized free-text username with null githubId', async () => {
		const event = await makeEvent({ user: null, body: { username: '  speedy  ' } });

		await POST(event as never);

		const values = insertValues.mock.calls[0][0];
		expect(values.username).toBe('speedy');
		expect(values.githubId ?? null).toBeNull();
	});

	it('records as Anonymous (null username) when no name is given', async () => {
		const event = await makeEvent({ user: null, body: {} });

		await POST(event as never);

		const values = insertValues.mock.calls[0][0];
		expect(values.username ?? null).toBeNull();
		expect(values.githubId ?? null).toBeNull();
	});

	it('records as Anonymous (null username) for a blank/whitespace name', async () => {
		const event = await makeEvent({ user: null, body: { username: '   ' } });

		await POST(event as never);

		const values = insertValues.mock.calls[0][0];
		expect(values.username ?? null).toBeNull();
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
		const good = await createPendingResultToken({ challengeId: 3, durationMs: 5000, iat: Date.now() });
		const [payloadPart, sigPart] = good.split('.');
		const flipped = sigPart[0] === 'A' ? 'B' : 'A';
		await expect400(await makeEvent({ pending: `${payloadPart}.${flipped}${sigPart.slice(1)}` }));
	});
});
