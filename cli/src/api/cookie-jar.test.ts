/**
 * Failing tests for the CLI `CookieJar` (`cookie-jar.ts`) — issue #35,
 * interface §2.1. Parses Set-Cookie lines, replays them as a Cookie header,
 * overwrites by name, and treats Max-Age=0 / past-Expires as deletes.
 *
 * These fail because `CookieJar` methods are not-yet-implemented stubs.
 */

import { describe, it, expect } from 'vitest';
import { CookieJar } from './cookie-jar';

describe('CookieJar — parse & replay', () => {
	it('stores the first k=v pair of each Set-Cookie and replays as a Cookie header', () => {
		const jar = new CookieJar();
		jar.storeSetCookies([
			'tmux_challenge_session=abc123; Path=/; HttpOnly; SameSite=Lax',
			'tmux_pending_result=def456; Path=/; HttpOnly'
		]);

		expect(jar.get('tmux_challenge_session')).toBe('abc123');
		expect(jar.get('tmux_pending_result')).toBe('def456');

		const header = jar.header();
		expect(header).toBeDefined();
		expect(header).toContain('tmux_challenge_session=abc123');
		expect(header).toContain('tmux_pending_result=def456');
	});

	it('returns undefined header when the jar is empty', () => {
		expect(new CookieJar().header()).toBeUndefined();
	});

	it('ignores cookie attributes when matching (Secure/HttpOnly/Domain/Path)', () => {
		const jar = new CookieJar();
		jar.storeSetCookies(['tmux_session=tok; Domain=example.com; Path=/; Secure; HttpOnly']);
		expect(jar.get('tmux_session')).toBe('tok');
	});
});

describe('CookieJar — overwrite & delete semantics', () => {
	it('a later Set-Cookie for the same name overwrites the earlier value', () => {
		const jar = new CookieJar();
		jar.storeSetCookies(['tmux_session=old; Path=/']);
		jar.storeSetCookies(['tmux_session=new; Path=/']);
		expect(jar.get('tmux_session')).toBe('new');
	});

	it('treats Max-Age=0 as a delete (removes the cookie from the jar)', () => {
		const jar = new CookieJar();
		jar.storeSetCookies(['tmux_session=tok; Path=/']);
		jar.storeSetCookies(['tmux_session=; Path=/; Max-Age=0']);
		expect(jar.get('tmux_session')).toBeUndefined();
	});

	it('treats an already-past Expires as a delete', () => {
		const jar = new CookieJar();
		jar.storeSetCookies(['tmux_session=tok; Path=/']);
		jar.storeSetCookies(['tmux_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT']);
		expect(jar.get('tmux_session')).toBeUndefined();
	});
});

describe('CookieJar — manual seed & clear', () => {
	it('set() seeds a cookie (e.g. tmux_session from the token store)', () => {
		const jar = new CookieJar();
		jar.set('tmux_session', 'seeded-token');
		expect(jar.get('tmux_session')).toBe('seeded-token');
		expect(jar.header()).toContain('tmux_session=seeded-token');
	});

	it('clear() empties the jar', () => {
		const jar = new CookieJar();
		jar.set('tmux_session', 'tok');
		jar.clear();
		expect(jar.get('tmux_session')).toBeUndefined();
		expect(jar.header()).toBeUndefined();
	});
});
