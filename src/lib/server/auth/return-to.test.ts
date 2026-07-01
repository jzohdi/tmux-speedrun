/**
 * Tests for the OAuth `return_to` open-redirect guard (`return-to.ts`).
 *
 * Iteration 2 (PR #36 feedback): to make login-after-finish seamless, the login
 * route accepts a `return_to` path and the callback redirects there. That value
 * must be constrained to a same-origin *local path* — never an absolute URL or a
 * scheme — or it becomes an open-redirect. See `.agent/interface.md` §I3 / §I0.5.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeReturnPath } from './return-to';

describe('sanitizeReturnPath', () => {
	it('accepts a plain same-origin local path with query string', () => {
		const path = '/challenge/2?completed=1&record=1';
		expect(sanitizeReturnPath(path)).toBe(path);
	});

	it('accepts a simple root-relative path', () => {
		expect(sanitizeReturnPath('/')).toBe('/');
	});

	it('rejects a protocol-relative URL (//host)', () => {
		expect(sanitizeReturnPath('//evil.com')).toBeNull();
	});

	it('rejects a backslash-smuggled host (/\\host)', () => {
		expect(sanitizeReturnPath('/\\evil.com')).toBeNull();
	});

	it('rejects absolute http(s) URLs', () => {
		expect(sanitizeReturnPath('https://evil.com')).toBeNull();
		expect(sanitizeReturnPath('http://evil.com/path')).toBeNull();
	});

	it('rejects javascript: and other scheme URLs', () => {
		expect(sanitizeReturnPath('javascript:alert(1)')).toBeNull();
		expect(sanitizeReturnPath('data:text/html,x')).toBeNull();
	});

	it('rejects a path without a leading slash', () => {
		expect(sanitizeReturnPath('foo')).toBeNull();
		expect(sanitizeReturnPath('challenge/2')).toBeNull();
	});

	it('rejects empty, null and undefined', () => {
		expect(sanitizeReturnPath('')).toBeNull();
		expect(sanitizeReturnPath(null)).toBeNull();
		expect(sanitizeReturnPath(undefined)).toBeNull();
	});
});
