/**
 * Route-level regression for issue #43: challenge 5 is unreachable (404).
 *
 * The home page lists challenges 0–5 (from the metadata source), but the route
 * loader gated validity on the legacy `CHALLENGES` array (0–4 only), so
 * `/challenge/5` threw a 404. This test pins the fix: the loader's accepted id
 * range must be derived from the same metadata the home page renders, so every
 * listed challenge is reachable and the two lists can never drift again.
 *
 * The loader `load` is a plain async function — we invoke it directly with a
 * minimal event stub. `cookies.get` returns `undefined`, so the loader passes an
 * empty string to `verifyPendingResultToken`, which short-circuits to `null`
 * without touching `getSessionSecret()` (see `pending.ts`). No SESSION_SECRET
 * env setup is required.
 *
 * Contract: `.agent/interface.md` §Contract 3.
 */

import { describe, expect, it } from 'vitest';

import { load } from './+page.server';

type LoadEvent = Parameters<typeof load>[0];

/** Minimal event stub: no pending cookie, anonymous user. */
function makeEvent(id: string): LoadEvent {
	return {
		params: { id },
		cookies: { get: () => undefined },
		locals: { user: null }
	} as unknown as LoadEvent;
}

/** Invoke `load` and return the caught throw (or `undefined` if it resolved). */
async function loadError(id: string): Promise<unknown> {
	try {
		await load(makeEvent(id));
		return undefined;
	} catch (err) {
		return err;
	}
}

describe('GET /challenge/[id] loader — reachability (issue #43)', () => {
	it('loads challenge 5 (previously a 404) as a playable challenge', async () => {
		const data = await load(makeEvent('5'));

		expect(data.challengeIndex).toBe(5);
		expect(data.totalChallenges).toBe(6);
		expect(data.difficultyLabel).toBe('Advanced');
		expect(data.pendingResult).toBeNull();
	});

	it('loads challenge 0 (lower bound) with the metadata-derived total', async () => {
		const data = await load(makeEvent('0'));

		expect(data.challengeIndex).toBe(0);
		expect(data.totalChallenges).toBe(6);
	});

	it('still 404s for challenge 6 (one past the last valid id)', async () => {
		const err = await loadError('6');

		expect(err).toMatchObject({ status: 404 });
	});

	it('still 404s for a negative / non-numeric id', async () => {
		expect(await loadError('-1')).toMatchObject({ status: 404 });
		expect(await loadError('abc')).toMatchObject({ status: 404 });
	});
});
