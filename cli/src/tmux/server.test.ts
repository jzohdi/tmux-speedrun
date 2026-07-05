/**
 * Unit tests for the server module's pure helpers (issue #45 R2, interface §3).
 *
 * `sanitizedClientEnv` strips TMUX / TMUX_PANE from the env handed to the two
 * runner client spawns (`attach()` and `absorbConfigErrors()`), so the real
 * `attach-session` (reached via the private `speedrun-attach` alias) never
 * trips tmux's nested-session guard when the CLI itself is launched from
 * inside a user's tmux — a latent same-kind blocker: preflight allows such a
 * launch, and today it would break every runner attach.
 *
 * Accessed via a cast because the export does not exist yet — these tests
 * fail at runtime until R2 is implemented. (The spawn-usage regression —
 * both client spawns use speedrun-attach + this helper — lives in
 * live-server.integration.test.ts, where the spawnImpl seam is exercised.)
 */

import { describe, expect, it } from 'vitest';
import * as serverModule from './server';

const { sanitizedClientEnv } = serverModule as unknown as {
	sanitizedClientEnv?: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
};

function requireHelper() {
	expect(
		typeof sanitizedClientEnv,
		'server.ts must export sanitizedClientEnv (R2, interface §3)'
	).toBe('function');
	return sanitizedClientEnv!;
}

describe('sanitizedClientEnv — nested-launch hardening (R2, interface §3)', () => {
	it('strips exactly TMUX and TMUX_PANE', () => {
		const helper = requireHelper();
		const result = helper({
			TMUX: '/tmp/tmux-501/default,12345,0',
			TMUX_PANE: '%7',
			PATH: '/usr/bin',
			HOME: '/Users/someone',
			TERM: 'xterm-256color'
		});
		expect('TMUX' in result).toBe(false);
		expect('TMUX_PANE' in result).toBe(false);
		expect(result.PATH).toBe('/usr/bin');
		expect(result.HOME).toBe('/Users/someone');
		expect(result.TERM).toBe('xterm-256color');
	});

	it('preserves every other variable verbatim — including tmux-adjacent names', () => {
		const helper = requireHelper();
		const result = helper({
			TMUX: 'x',
			TMUX_PANE: '%1',
			TMUX_PLUGIN_MANAGER_PATH: '/keep/me',
			MY_TMUX_THING: 'keep'
		});
		expect(result.TMUX_PLUGIN_MANAGER_PATH).toBe('/keep/me');
		expect(result.MY_TMUX_THING).toBe('keep');
	});

	it('does not mutate its input', () => {
		const helper = requireHelper();
		const input: NodeJS.ProcessEnv = { TMUX: 'x', TMUX_PANE: '%1', PATH: '/usr/bin' };
		helper(input);
		expect(input.TMUX).toBe('x');
		expect(input.TMUX_PANE).toBe('%1');
	});

	it('returns a copy even when there is nothing to strip', () => {
		const helper = requireHelper();
		const input: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
		const result = helper(input);
		expect(result).toEqual(input);
		expect(result).not.toBe(input);
	});
});
