/**
 * Tests for OAuth CSRF `state` helpers (`state.ts`).
 * See `.agent/interface.md` §3.
 */

import { describe, it, expect } from 'vitest';
import { generateOAuthState, verifyOAuthState } from './state';

describe('generateOAuthState', () => {
	it('produces a non-empty, URL-safe token', () => {
		const state = generateOAuthState();

		expect(typeof state).toBe('string');
		expect(state.length).toBeGreaterThan(0);
		// URL/cookie-safe: no chars that need escaping in a query string or cookie.
		expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('produces unique values across calls', () => {
		const values = new Set<string>();
		for (let i = 0; i < 50; i++) {
			values.add(generateOAuthState());
		}
		expect(values.size).toBe(50);
	});
});

describe('verifyOAuthState', () => {
	it('returns true only when both values are present and equal', () => {
		expect(verifyOAuthState('abc123', 'abc123')).toBe(true);
	});

	it('returns false on mismatch', () => {
		expect(verifyOAuthState('abc123', 'xyz789')).toBe(false);
	});

	it('returns false when the query value is missing', () => {
		expect(verifyOAuthState(null, 'abc123')).toBe(false);
	});

	it('returns false when the cookie value is missing', () => {
		expect(verifyOAuthState('abc123', undefined)).toBe(false);
	});

	it('returns false when both are empty', () => {
		expect(verifyOAuthState('', '')).toBe(false);
	});
});
