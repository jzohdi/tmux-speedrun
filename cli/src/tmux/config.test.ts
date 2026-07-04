/**
 * Failing tests for the generated isolated tmux config (issue #45,
 * interface §2).
 *
 * Issue #45 makes the config the foundation of all three fixes:
 *  - `exit-empty off` so the private server survives `kill-session` (defect 3),
 *  - a STATIC `status-left '#{@speedrun_prompt}'` indirection so exactly one
 *    prompt source of truth exists (defect 1, invariant PR1),
 *  - an expanded `SINK_HOOKS` set covering every pool command so actions like
 *    `select-window` on the already-active window are observable (defect 2),
 *  - `expectedSinkEventsFor()` so runner-origin execs can be suppression-
 *    accounted (invariant SUP1).
 *
 * `SINK_HOOKS` / `expectedSinkEventsFor` are accessed via a cast because they
 * do not exist yet — these tests fail at runtime until they are implemented.
 */

import { describe, expect, it } from 'vitest';
import * as configModule from './config';
import { buildIsolatedConfig } from './config';

const SINK = '/tmp/speedrun-test-events.log';

const { SINK_HOOKS, expectedSinkEventsFor } = configModule as unknown as {
	SINK_HOOKS?: readonly string[];
	expectedSinkEventsFor?: (args: string[]) => string[];
};

/** Full normative hook list from interface §2.2. */
const EXPECTED_HOOKS = [
	'after-attach-session',
	'after-break-pane',
	'after-capture-pane',
	'after-choose-tree',
	'after-clock-mode',
	'after-command-prompt',
	'after-copy-mode',
	'after-delete-buffer',
	'after-display-panes',
	'after-join-pane',
	'after-kill-pane',
	'after-kill-session',
	'after-kill-window',
	'after-last-pane',
	'after-last-window',
	'after-list-buffers',
	'after-list-keys',
	'after-list-sessions',
	'after-list-windows',
	'after-new-session',
	'after-new-window',
	'after-next-window',
	'after-paste-buffer',
	'after-previous-window',
	'after-rename-session',
	'after-rename-window',
	'after-select-pane',
	'after-select-window',
	'after-show-buffer',
	'after-source-file',
	'after-split-window',
	'after-swap-pane',
	'after-swap-window',
	'after-rotate-window',
	'after-switch-client',
	'client-attached',
	'client-detached',
	'session-closed',
	'window-renamed',
	'pane-mode-changed',
	'pane-focus-in'
];

describe('buildIsolatedConfig — issue #45 additions (interface §2.1)', () => {
	const text = buildIsolatedConfig({ eventSink: SINK }).text;
	const lines = text.split('\n');

	it('keeps the private server alive with zero sessions (exit-empty off)', () => {
		expect(lines).toContain('set -g exit-empty off');
	});

	it('declares the @speedrun_prompt option with an empty default', () => {
		expect(lines).toContain("set -g @speedrun_prompt ''");
	});

	it('status-left is a STATIC reference to @speedrun_prompt (single render source, defect 1)', () => {
		expect(lines).toContain("set -g status-left '#{@speedrun_prompt}'");
		// The old direct-text status-left must be gone — runtime code never
		// rewrites status-left (invariant PR1).
		expect(text).not.toContain("set -g status-left '[tmux-speedrun] '");
	});

	it('keeps status-left-length 120', () => {
		expect(lines).toContain('set -g status-left-length 120');
	});
});

describe('SINK_HOOKS + generated hook lines (interface §2.2)', () => {
	it('exports SINK_HOOKS covering every pool-command hook and notification hook', () => {
		expect(SINK_HOOKS, 'config.ts must export SINK_HOOKS').toBeDefined();
		const missing = EXPECTED_HOOKS.filter((h) => !(SINK_HOOKS ?? []).includes(h));
		expect(missing).toEqual([]);
	});

	it('installs one sink-writing hook line per SINK_HOOKS entry', () => {
		const text = buildIsolatedConfig({ eventSink: SINK }).text;
		for (const hook of SINK_HOOKS ?? EXPECTED_HOOKS) {
			const line = text.split('\n').find((l) => l.startsWith(`set-hook -g ${hook} `));
			expect(line, `missing hook line for ${hook}`).toBeDefined();
			// Each hook writes its own name as one line to the sink.
			expect(line).toContain(SINK);
		}
	});

	it('never hooks commands the runner cannot account for (invariant SUP1)', () => {
		const text = buildIsolatedConfig({ eventSink: SINK }).text;
		const banned = [
			'after-set-option',
			'after-display-message',
			'after-list-panes',
			'after-refresh-client'
		];
		for (const hook of banned) {
			expect(text).not.toContain(`set-hook -g ${hook} `);
		}
	});
});

describe('expectedSinkEventsFor — runner exec → expected sink events (interface §2.3)', () => {
	it('is exported from config.ts', () => {
		expect(typeof expectedSinkEventsFor, 'config.ts must export expectedSinkEventsFor').toBe(
			'function'
		);
	});

	const cases: [string[], string[]][] = [
		[['list-sessions', '-F', '#{session_name}'], ['after-list-sessions']],
		[['list-buffers', '-F', '#{buffer_name}'], ['after-list-buffers']],
		[['show-buffer'], ['after-show-buffer']],
		[['select-window', '-t', ':=0'], ['after-select-window']],
		[['new-session', '-d', '-s', 'speedrun'], ['after-new-session']],
		// special multi-event mappings
		[['detach-client'], ['client-detached']],
		[['attach-session'], ['client-attached', 'after-attach-session']],
		[['kill-session'], ['after-kill-session', 'session-closed']],
		// unhooked / unknown commands map to nothing
		[['list-panes', '-a', '-F', 'x'], []],
		[['set-option', '-g', 'status-left', 'x'], []],
		[['display-message', 'hi'], []],
		[['refresh-client'], []],
		[['kill-server'], []],
		[['not-a-real-command'], []]
	];

	it.each(cases)('%j → %j', (args, events) => {
		expect(expectedSinkEventsFor, 'config.ts must export expectedSinkEventsFor').toBeDefined();
		expect(expectedSinkEventsFor!(args)).toEqual(events);
	});
});
