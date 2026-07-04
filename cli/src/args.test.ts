/**
 * Failing tests for `parseArgs` (`args.ts`) — issue #35, interface §9.1.
 * `argv` is the user's args (already sliced past `node <script>`).
 *
 * These fail because `parseArgs` is a not-yet-implemented stub.
 */

import { describe, it, expect } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs — command routing', () => {
	it('defaults to "help" with no args and default options', () => {
		const parsed = parseArgs([]);
		expect(parsed.command).toBe('help');
		expect(parsed.positionals).toEqual([]);
		expect(parsed.options).toEqual({
			server: undefined,
			noColor: false,
			json: false,
			verbose: false
		});
	});

	it('routes a known command and keeps its positionals', () => {
		const parsed = parseArgs(['challenge', '3']);
		expect(parsed.command).toBe('challenge');
		expect(parsed.positionals).toEqual(['3']);
	});

	it('routes bare known commands', () => {
		expect(parseArgs(['leaderboard']).command).toBe('leaderboard');
		expect(parseArgs(['login']).command).toBe('login');
		expect(parseArgs(['whoami']).command).toBe('whoami');
		expect(parseArgs(['practice']).command).toBe('practice');
	});

	it('maps an unknown command to "help"', () => {
		expect(parseArgs(['frobnicate']).command).toBe('help');
	});

	it('maps --help / -h to "help"', () => {
		expect(parseArgs(['--help']).command).toBe('help');
		expect(parseArgs(['challenge', '-h']).command).toBe('help');
	});
});

describe('parseArgs — global options', () => {
	it('parses --server <url> as an option, not a positional', () => {
		const parsed = parseArgs(['leaderboard', '--server', 'http://localhost:5173']);
		expect(parsed.command).toBe('leaderboard');
		expect(parsed.options.server).toBe('http://localhost:5173');
		expect(parsed.positionals).toEqual([]);
	});

	it('parses --no-color, --json, --verbose boolean flags', () => {
		const parsed = parseArgs(['whoami', '--json', '--no-color', '--verbose']);
		expect(parsed.options.json).toBe(true);
		expect(parsed.options.noColor).toBe(true);
		expect(parsed.options.verbose).toBe(true);
	});

	it('allows options interspersed with positionals', () => {
		const parsed = parseArgs(['leaderboard', '--json', '2']);
		expect(parsed.command).toBe('leaderboard');
		expect(parsed.positionals).toEqual(['2']);
		expect(parsed.options.json).toBe(true);
	});
});
