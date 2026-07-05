/**
 * Failing tests for the R4 login-origin fix (issue #45, PR #46 third feedback
 * round, interface §12.2). `login` (and every other CLI API call) builds its URL
 * from `resolveConfig().baseUrl`, which falls back to `DEFAULT_API_ORIGIN` when
 * neither `--server` nor `TMUX_SPEEDRUN_API` is set. That constant currently
 * points at the Vercel preview origin, so `tmux-speedrun login` opens the wrong
 * host and the GitHub OAuth callback redirects through it. The canonical
 * production origin is `https://tmux-speedrun.xyz`.
 *
 * The dev escape hatches (`--server`, `TMUX_SPEEDRUN_API`) must still win.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_API_ORIGIN, resolveConfig } from './config';
import type { GlobalOptions } from './args';

const CANONICAL_ORIGIN = 'https://tmux-speedrun.xyz';
const EMPTY_OPTIONS = {} as GlobalOptions;

describe('DEFAULT_API_ORIGIN — canonical production origin (interface §12.2)', () => {
	const savedEnv = process.env.TMUX_SPEEDRUN_API;

	beforeEach(() => {
		delete process.env.TMUX_SPEEDRUN_API;
	});
	afterEach(() => {
		if (savedEnv === undefined) delete process.env.TMUX_SPEEDRUN_API;
		else process.env.TMUX_SPEEDRUN_API = savedEnv;
	});

	it('points at https://tmux-speedrun.xyz (not the Vercel preview origin)', () => {
		expect(DEFAULT_API_ORIGIN).toBe(CANONICAL_ORIGIN);
	});

	it('resolveConfig with no override resolves baseUrl to the canonical origin', () => {
		expect(resolveConfig(EMPTY_OPTIONS).baseUrl).toBe(CANONICAL_ORIGIN);
	});

	it('builds the CLI login URL against the canonical origin', () => {
		const { baseUrl } = resolveConfig(EMPTY_OPTIONS);
		const url = `${baseUrl}/api/auth/cli/login?port=1234&state=abc`;
		expect(url).toBe('https://tmux-speedrun.xyz/api/auth/cli/login?port=1234&state=abc');
	});

	it('--server flag still overrides the default origin', () => {
		expect(resolveConfig({ server: 'http://localhost:5173' } as GlobalOptions).baseUrl).toBe(
			'http://localhost:5173'
		);
	});

	it('TMUX_SPEEDRUN_API env still overrides the default origin', () => {
		process.env.TMUX_SPEEDRUN_API = 'http://localhost:4000';
		expect(resolveConfig(EMPTY_OPTIONS).baseUrl).toBe('http://localhost:4000');
	});
});
