/**
 * Tests for the GitHub OAuth configuration getters added to `env.ts`.
 * See `.agent/interface.md` §1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({
	mockEnv: {} as Record<string, string | undefined>
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

import {
	getGitHubOAuthConfig,
	isGitHubOAuthConfigured,
	getGitHubRedirectUri,
	GITHUB_CALLBACK_PATH
} from './env';

beforeEach(() => {
	for (const key of Object.keys(mockEnv)) delete mockEnv[key];
});

describe('isGitHubOAuthConfigured', () => {
	it('is true when both id and secret are present', () => {
		mockEnv.GITHUB_CLIENT_ID = 'id';
		mockEnv.GITHUB_CLIENT_SECRET = 'secret';
		expect(isGitHubOAuthConfigured()).toBe(true);
	});

	it('is false when either is missing', () => {
		mockEnv.GITHUB_CLIENT_ID = 'id';
		expect(isGitHubOAuthConfigured()).toBe(false);
	});

	it('treats an empty string as not configured', () => {
		mockEnv.GITHUB_CLIENT_ID = 'id';
		mockEnv.GITHUB_CLIENT_SECRET = '';
		expect(isGitHubOAuthConfigured()).toBe(false);
	});
});

describe('getGitHubOAuthConfig', () => {
	it('returns the id and secret when configured', () => {
		mockEnv.GITHUB_CLIENT_ID = 'my-id';
		mockEnv.GITHUB_CLIENT_SECRET = 'my-secret';
		expect(getGitHubOAuthConfig()).toEqual({ clientId: 'my-id', clientSecret: 'my-secret' });
	});

	it('throws when the id or secret is missing/empty', () => {
		mockEnv.GITHUB_CLIENT_ID = 'my-id';
		expect(() => getGitHubOAuthConfig()).toThrow();

		mockEnv.GITHUB_CLIENT_SECRET = '';
		expect(() => getGitHubOAuthConfig()).toThrow();
	});
});

describe('getGitHubRedirectUri', () => {
	it('prefers ORIGIN and appends the fixed callback path', () => {
		mockEnv.ORIGIN = 'https://speedrun.example.com';
		const uri = getGitHubRedirectUri(new URL('https://ignored.local/api/auth/github/login'));
		expect(uri).toBe(`https://speedrun.example.com${GITHUB_CALLBACK_PATH}`);
	});

	it('trims a trailing slash from ORIGIN', () => {
		mockEnv.ORIGIN = 'https://speedrun.example.com/';
		const uri = getGitHubRedirectUri(new URL('https://ignored.local/x'));
		expect(uri).toBe(`https://speedrun.example.com${GITHUB_CALLBACK_PATH}`);
	});

	it('falls back to the request origin when ORIGIN is unset', () => {
		const uri = getGitHubRedirectUri(new URL('http://localhost:5173/api/auth/github/login'));
		expect(uri).toBe(`http://localhost:5173${GITHUB_CALLBACK_PATH}`);
	});
});
