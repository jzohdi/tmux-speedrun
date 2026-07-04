/**
 * Failing tests for the CLI-login helper (`cli-login.ts`) — issue #35,
 * interface §4.2 / §4.4 and invariant AUTH1.
 *
 * Two concerns:
 *  1. `signCliLoginState` / `verifyCliLoginState` round-trip the {port, cliState}
 *     carried through the OAuth redirect, HMAC-signed with SESSION_SECRET; any
 *     tampering is rejected (returns null, never throws) — mirroring session.ts.
 *  2. `buildLoopbackCallbackUrl` is the security-critical open-redirect guard:
 *     it yields a loopback URL ONLY for 127.0.0.1/localhost + http + /callback +
 *     a valid port, and null for everything else (analogous to return-to.test.ts).
 *
 * These fail because `cli-login.ts` is a not-yet-implemented stub.
 */

import { describe, it, expect, vi } from 'vitest';

// Stable session secret (>= 32 chars) so getSessionSecret() works, matching session.test.ts.
vi.mock('$env/dynamic/private', () => ({
	env: { SESSION_SECRET: 'test-session-secret-at-least-32-chars-long-xxxx' }
}));

import {
	signCliLoginState,
	verifyCliLoginState,
	buildLoopbackCallbackUrl,
	type CliLoginState
} from './cli-login';

const state: CliLoginState = { port: 49876, cliState: 'abcDEF012_-ghijklmnop' };

describe('signCliLoginState / verifyCliLoginState', () => {
	it('round-trips a {port, cliState} through the signed cookie value', async () => {
		const signed = await signCliLoginState(state);
		expect(typeof signed).toBe('string');
		expect(signed.length).toBeGreaterThan(0);

		const parsed = await verifyCliLoginState(signed);
		expect(parsed).toEqual(state);
	});

	it('rejects a tampered payload (returns null, does not throw)', async () => {
		const signed = await signCliLoginState(state);
		const [payload, sig] = signed.split('.');
		// Flip a character in the payload; signature no longer matches.
		const tamperedChar = payload[0] === 'A' ? 'B' : 'A';
		const tampered = `${tamperedChar}${payload.slice(1)}.${sig}`;

		await expect(verifyCliLoginState(tampered)).resolves.toBeNull();
	});

	it('rejects a tampered signature', async () => {
		const signed = await signCliLoginState(state);
		const [payload] = signed.split('.');
		await expect(verifyCliLoginState(`${payload}.not-a-valid-signature`)).resolves.toBeNull();
	});

	it('rejects garbage / malformed values without throwing', async () => {
		await expect(verifyCliLoginState('')).resolves.toBeNull();
		await expect(verifyCliLoginState('no-dot-separator')).resolves.toBeNull();
		await expect(verifyCliLoginState('a.b.c')).resolves.toBeNull();
	});
});

describe('buildLoopbackCallbackUrl — loopback guard (AUTH1)', () => {
	const token = 'signed.session.token';
	const cliState = 'abcDEF012_-ghijklmnop';

	it('accepts 127.0.0.1 with a valid port and encodes token + state in the query', () => {
		const url = buildLoopbackCallbackUrl({ port: 49876, cliState, token });
		expect(url).not.toBeNull();
		const parsed = new URL(url as string);
		expect(parsed.protocol).toBe('http:');
		expect(parsed.hostname).toBe('127.0.0.1');
		expect(parsed.port).toBe('49876');
		expect(parsed.pathname).toBe('/callback');
		expect(parsed.searchParams.get('token')).toBe(token);
		expect(parsed.searchParams.get('state')).toBe(cliState);
	});

	it('builds a loopback URL bound to a loopback host (never a routable host)', () => {
		const url = buildLoopbackCallbackUrl({ port: 50000, cliState, token });
		expect(url).not.toBeNull();
		const hostname = new URL(url as string).hostname;
		expect(['127.0.0.1', 'localhost']).toContain(hostname);
	});

	it('rejects ports outside the [1024, 65535] range', () => {
		expect(buildLoopbackCallbackUrl({ port: 80, cliState, token })).toBeNull();
		expect(buildLoopbackCallbackUrl({ port: 1023, cliState, token })).toBeNull();
		expect(buildLoopbackCallbackUrl({ port: 70000, cliState, token })).toBeNull();
		expect(buildLoopbackCallbackUrl({ port: 0, cliState, token })).toBeNull();
	});

	it('rejects non-integer ports', () => {
		expect(buildLoopbackCallbackUrl({ port: 4988.5, cliState, token })).toBeNull();
		expect(buildLoopbackCallbackUrl({ port: NaN, cliState, token })).toBeNull();
	});

	it('rejects a cliState containing control chars', () => {
		expect(buildLoopbackCallbackUrl({ port: 49876, cliState: 'bad\nstate\t', token })).toBeNull();
	});
});
