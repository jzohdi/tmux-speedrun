/**
 * Failing tests for the token store (`token-store.ts`) — issue #35,
 * interface §4.6 / §10. Focus on the pure, dependency-free surfaces:
 * `decodeSessionToken` (local decode, no HMAC check) and `sessionFilePath`
 * (XDG-aware config path).
 *
 * These fail because the functions are not-yet-implemented stubs.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { decodeSessionToken, sessionFilePath } from './token-store';

/** base64url encode, matching the server's session-token encoding (session.ts). */
function b64url(str: string): string {
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Build a session token `base64url(JSON(payload)).base64url(sig)`. */
function makeToken(payload: object, sig = 'deadbeefsignature'): string {
	return `${b64url(JSON.stringify(payload))}.${b64url(sig)}`;
}

describe('decodeSessionToken', () => {
	it('decodes githubId + username without verifying the signature', () => {
		const token = makeToken({ githubId: 12345, username: 'octocat', iat: 1_700_000_000_000 });
		expect(decodeSessionToken(token)).toEqual({ githubId: 12345, username: 'octocat' });
	});

	it('decodes even when the signature is bogus (server verifies on use)', () => {
		const token = makeToken({ githubId: 7, username: 'mona', iat: 1 }, 'not-a-real-signature');
		expect(decodeSessionToken(token)).toEqual({ githubId: 7, username: 'mona' });
	});

	it('returns null for a token without the payload.signature separator', () => {
		expect(decodeSessionToken('no-dot-here')).toBeNull();
	});

	it('returns null when the payload is not valid JSON', () => {
		expect(decodeSessionToken(`${b64url('not json{')}.${b64url('sig')}`)).toBeNull();
	});

	it('returns null when required fields are missing or mistyped', () => {
		expect(decodeSessionToken(makeToken({ username: 'octocat' }))).toBeNull();
		expect(decodeSessionToken(makeToken({ githubId: 'x', username: 'octocat' }))).toBeNull();
	});

	it('returns null for an empty token', () => {
		expect(decodeSessionToken('')).toBeNull();
	});
});

describe('sessionFilePath', () => {
	const original = process.env.XDG_CONFIG_HOME;
	afterEach(() => {
		if (original === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = original;
	});

	it('is a session.json under a tmux-speedrun config directory', () => {
		const p = sessionFilePath();
		expect(p).toContain('tmux-speedrun');
		expect(p.endsWith('session.json')).toBe(true);
	});

	it('honors $XDG_CONFIG_HOME', () => {
		process.env.XDG_CONFIG_HOME = '/tmp/xdg-test-config';
		expect(sessionFilePath()).toBe('/tmp/xdg-test-config/tmux-speedrun/session.json');
	});
});
