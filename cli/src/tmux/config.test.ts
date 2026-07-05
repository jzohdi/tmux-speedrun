/**
 * Tests for the generated isolated tmux config (issue #45, interface §2).
 *
 * Issue #45 makes the config the foundation of all three fixes:
 *  - `exit-empty off` so the private server survives `kill-session` (defect 3),
 *  - a STATIC `status-left '#{@speedrun_prompt}'` indirection so exactly one
 *    prompt source of truth exists (defect 1, invariant PR1),
 *  - an expanded `SINK_HOOKS` set covering every pool command so actions like
 *    `select-window` on the already-active window are observable (defect 2).
 *
 * R2 (PR #46 feedback round, plan §8): the ONESHOT invariant (OS1) — every
 * documented input form writes its sink event BEFORE the command runs, so a
 * no-op or erroring invocation still advances the step. This round pins:
 *  - the nested-context shims (`new-session` → `new-session -d`,
 *    `attach-session` → `switch-client`) that override tmux's nested guard,
 *  - the new write-first rebinds (arrows, o, z, ], q, ?) and typed-form
 *    aliases (ls/lsw/lsb/deleteb/capturep/joinp/swapw/lsk …),
 *  - the private runner alias `speedrun-attach`,
 *  - the exported KEY_REBINDS / COMMAND_ALIASES tables (single source of
 *    truth for conf lines AND suppression accounting),
 *  - `expectedSinkEventsFor(args, liveHooks)` — the exact per-machine
 *    multiset (replaces the shipped one-arg form; SUP1, R2-amended).
 *
 * New R2 exports are accessed via a cast because they do not exist yet —
 * those tests fail at runtime until the round is implemented.
 */

import { describe, expect, it } from 'vitest';
import * as configModule from './config';
import { buildIsolatedConfig } from './config';

const SINK = '/tmp/speedrun-test-events.log';

type KeyRebind = {
	key: string;
	repeat?: boolean;
	events: readonly string[];
	command: string;
};

type CommandAlias = {
	names: readonly string[];
	events: readonly string[];
	command: string;
};

const {
	SINK_HOOKS,
	WINDOW_NAV_TRIGGER,
	ZOOM_KEY_EVENT,
	RUNNER_ATTACH_COMMAND,
	KEY_REBINDS,
	COMMAND_ALIASES,
	expectedSinkEventsFor
} = configModule as unknown as {
	SINK_HOOKS?: readonly string[];
	WINDOW_NAV_TRIGGER?: string;
	ZOOM_KEY_EVENT?: string;
	RUNNER_ATTACH_COMMAND?: string;
	KEY_REBINDS?: readonly KeyRebind[];
	COMMAND_ALIASES?: readonly CommandAlias[];
	expectedSinkEventsFor?: (args: string[], liveHooks: ReadonlySet<string>) => string[];
};

/** bind-key key specs are written quoted in the conf ("';'"); normalize for lookups. */
const bareKey = (key: string) => key.replace(/^'(.*)'$/, '$1');

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

	it('the after-select-window hook writes the neutral WINDOW_NAV_TRIGGER, never its own name (defect 2)', () => {
		expect(WINDOW_NAV_TRIGGER).toBe('window-nav-trigger');
		const text = buildIsolatedConfig({ eventSink: SINK }).text;
		const line = text.split('\n').find((l) => l.startsWith('set-hook -g after-select-window '));
		expect(line).toBeDefined();
		expect(line).toContain('window-nav-trigger');
		expect(line).not.toContain(`echo after-select-window >> ${SINK}`);
	});

	it("exports ZOOM_KEY_EVENT = 'zoom-key' (the z rebind's sink event — resize-pane has no after-hook)", () => {
		expect(ZOOM_KEY_EVENT, 'config.ts must export ZOOM_KEY_EVENT (R2)').toBe('zoom-key');
	});

	it('never hooks OR aliases the runner’s guaranteed-silent commands (invariant SUP1, R2-amended)', () => {
		const text = buildIsolatedConfig({ eventSink: SINK }).text;
		const silent = [
			'set-option',
			'show-options',
			'show-hooks',
			'display-message',
			'list-panes',
			'refresh-client'
		];
		for (const cmd of silent) {
			expect(text, `must not hook after-${cmd}`).not.toContain(`set-hook -g after-${cmd} `);
			expect(text, `must not alias ${cmd}`).not.toContain(`'${cmd}=`);
		}
	});
});

// ---------------------------------------------------------------------------
// R2 — input interception tables (interface §2.4): the exported
// KEY_REBINDS / COMMAND_ALIASES tables are the single source of truth for
// the generated conf lines AND for suppression accounting. Write-first is
// the ONESHOT mechanism: the sink event arrives even when the command
// no-ops (prefix+Left with one pane) or errors (paste-buffer with zero
// buffers, tmux attach inside the run).
// ---------------------------------------------------------------------------

describe('KEY_REBINDS — write-first key rebinds (R2, interface §2.4b)', () => {
	const text = buildIsolatedConfig({ eventSink: SINK }).text;
	const lines = text.split('\n');

	/** Every documented prefix key must have a write-first rebind (normative §2.4b). */
	const EXPECTED_REBIND_KEYS = [
		...'0123456789'.split(''),
		'n',
		'p',
		'l',
		';',
		'{',
		'}',
		'C-o',
		'!',
		':',
		't',
		'w',
		's',
		'(',
		')',
		// R2 rows:
		'Up',
		'Down',
		'Left',
		'Right',
		'o',
		'z',
		']',
		'q',
		'?'
	];

	it('is exported and covers every documented prefix key', () => {
		expect(KEY_REBINDS, 'config.ts must export KEY_REBINDS (R2)').toBeDefined();
		const keys = new Set((KEY_REBINDS ?? []).map((r) => bareKey(r.key)));
		const missing = EXPECTED_REBIND_KEYS.filter((k) => !keys.has(k));
		expect(missing, `keys with no write-first rebind: ${missing.join(' ')}`).toEqual([]);
	});

	const r2Rows: [key: string, events: string[], command: string, repeat: boolean][] = [
		['Up', ['after-select-pane'], 'select-pane -U', true],
		['Down', ['after-select-pane'], 'select-pane -D', true],
		['Left', ['after-select-pane'], 'select-pane -L', true],
		['Right', ['after-select-pane'], 'select-pane -R', true],
		['o', ['after-select-pane'], 'select-pane -t :.+', false],
		['z', ['zoom-key'], 'resize-pane -Z', false],
		[']', ['after-paste-buffer'], 'paste-buffer', false],
		['q', ['after-display-panes'], 'display-panes', false],
		['?', ['after-list-keys'], 'list-keys', false]
	];

	it.each(r2Rows)('rebinds %s → writes %j, then runs %s', (key, events, command, repeat) => {
		expect(KEY_REBINDS, 'config.ts must export KEY_REBINDS (R2)').toBeDefined();
		const entry = (KEY_REBINDS ?? []).find((r) => bareKey(r.key) === key);
		expect(entry, `no KEY_REBINDS entry for key '${key}'`).toBeDefined();
		expect([...entry!.events]).toEqual(events);
		expect(entry!.command).toBe(command);
		if (repeat) {
			// tmux's default arrow bindings are repeatable; the rebind must keep that.
			expect(entry!.repeat, `'${key}' must keep the -r repeat flag`).toBe(true);
		}
	});

	it('emits one bind-key conf line per table entry — the write comes with the key, before the command', () => {
		expect(KEY_REBINDS, 'config.ts must export KEY_REBINDS (R2)').toBeDefined();
		for (const rebind of KEY_REBINDS ?? []) {
			const line = lines.find(
				(l) =>
					l.startsWith('bind-key') &&
					l.includes(rebind.command) &&
					rebind.events.every((e) => l.includes(`echo ${e} >> ${SINK}`))
			);
			expect(line, `missing bind-key line for key ${rebind.key} (${rebind.command})`).toBeDefined();
			if (rebind.repeat) {
				expect(line, `bind-key line for ${rebind.key} must carry -r`).toContain('-r');
			}
		}
	});
});

describe('COMMAND_ALIASES — typed-form interceptors + nested-context shims (R2, interface §2.4a/§2.4c)', () => {
	const text = buildIsolatedConfig({ eventSink: SINK }).text;
	const lines = text.split('\n');

	/** Full normative table: [names, events, real command] (§2.4c). */
	const expectedAliases: [names: string[], events: string[], command: string][] = [
		// shipped rows
		[['show-buffer', 'showb'], ['after-show-buffer'], 'show-buffer'],
		[['source-file', 'source'], ['after-source-file'], 'source-file'],
		[['kill-session'], ['after-kill-session'], 'kill-session'],
		[['select-window', 'selectw'], ['after-select-window'], 'select-window'],
		[['next-window', 'next'], ['after-next-window'], 'next-window'],
		[['previous-window', 'prev'], ['after-previous-window'], 'previous-window'],
		[['last-window', 'last'], ['after-last-window'], 'last-window'],
		// R2 nested-context shims (feedback cases 1 and 3): the shim overrides
		// tmux's nested-session guard INSIDE the run — `new-session -d` creates a
		// real detached session; `attach` becomes a switch-client. The write-first
		// event advances the step even when the trailing command errors.
		[['new-session', 'new'], ['after-new-session'], 'new-session -d'],
		[['attach-session', 'attach', 'a'], ['after-attach-session'], 'switch-client'],
		// R2 typed-form interceptors
		[['list-sessions', 'ls'], ['after-list-sessions'], 'list-sessions'],
		[['list-windows', 'lsw'], ['after-list-windows'], 'list-windows'],
		[['list-buffers', 'lsb'], ['after-list-buffers'], 'list-buffers'],
		[['delete-buffer', 'deleteb'], ['after-delete-buffer'], 'delete-buffer'],
		[['capture-pane', 'capturep'], ['after-capture-pane'], 'capture-pane'],
		[['join-pane', 'joinp'], ['after-join-pane'], 'join-pane'],
		[['swap-window', 'swapw'], ['after-swap-window'], 'swap-window'],
		[['list-keys', 'lsk'], ['after-list-keys'], 'list-keys']
	];

	it('is exported and covers every documented typed form and builtin short alias', () => {
		expect(COMMAND_ALIASES, 'config.ts must export COMMAND_ALIASES (R2)').toBeDefined();
		const names = new Set((COMMAND_ALIASES ?? []).flatMap((a) => [...a.names]));
		const missing = expectedAliases.flatMap(([n]) => n).filter((n) => !names.has(n));
		expect(missing, `typed forms with no alias interceptor: ${missing.join(' ')}`).toEqual([]);
	});

	it.each(expectedAliases)('aliases %j → writes %j, then runs %s', (names, events, command) => {
		expect(COMMAND_ALIASES, 'config.ts must export COMMAND_ALIASES (R2)').toBeDefined();
		const entry = (COMMAND_ALIASES ?? []).find((a) => a.names.includes(names[0]));
		expect(entry, `no COMMAND_ALIASES entry for '${names[0]}'`).toBeDefined();
		for (const name of names) {
			expect([...entry!.names], `'${name}' must be intercepted too`).toContain(name);
		}
		expect([...entry!.events]).toEqual(events);
		expect(entry!.command).toBe(command);
	});

	it('emits one command-alias conf line per name, with the REAL command last (trailing user args must attach to it)', () => {
		expect(COMMAND_ALIASES, 'config.ts must export COMMAND_ALIASES (R2)').toBeDefined();
		for (const alias of COMMAND_ALIASES ?? []) {
			for (const name of alias.names) {
				const line = lines.find((l) => l.includes(`'${name}=`));
				expect(line, `missing command-alias line for '${name}'`).toBeDefined();
				for (const event of alias.events) {
					expect(line, `alias '${name}' must write ${event} first`).toContain(
						`echo ${event} >> ${SINK}`
					);
				}
				// `tmux new -s foo` must expand so `-s foo` lands on new-session -d —
				// nothing (e.g. a display-message) may follow the real command.
				expect(
					line!.trimEnd().endsWith(`${alias.command}'`),
					`alias '${name}' must END with its real command '${alias.command}': ${line}`
				).toBe(true);
			}
		}
	});

	it('defines the private runner alias speedrun-attach=attach-session, OUTSIDE the event-writing tables', () => {
		// The runner's own attach must reach the REAL attach-session (the
		// user-facing spelling is shimmed to switch-client); alias expansion does
		// not recurse, so this exact-name alias is the escape hatch (§2.4).
		expect(RUNNER_ATTACH_COMMAND, 'config.ts must export RUNNER_ATTACH_COMMAND (R2)').toBe(
			'speedrun-attach'
		);
		expect(text).toContain('speedrun-attach=attach-session');
		const names = (COMMAND_ALIASES ?? []).flatMap((a) => [...a.names]);
		expect(
			names,
			'speedrun-attach writes no events and must not be in COMMAND_ALIASES'
		).not.toContain('speedrun-attach');
	});
});

// ---------------------------------------------------------------------------
// R2 — expectedSinkEventsFor(args, liveHooks): the EXACT multiset of sink
// lines one runner exec produces on THIS machine (interface §2.3). Replaces
// the shipped one-arg form. Getting this wrong in either direction is a bug:
// too few entries leak spurious "user" events (self-completing steps), too
// many swallow real user actions (stuck steps).
// ---------------------------------------------------------------------------

describe('expectedSinkEventsFor(args, liveHooks) — exact per-machine multiset (R2, interface §2.3)', () => {
	const events = (args: string[], live: string[]): string[] => {
		expect(typeof expectedSinkEventsFor, 'config.ts must export expectedSinkEventsFor').toBe(
			'function'
		);
		return [...expectedSinkEventsFor!(args, new Set(live))].sort();
	};

	it('one show-buffer exec on a hook-live tmux yields alias + hook lines (the review double-count case)', () => {
		expect(events(['show-buffer'], ['after-show-buffer'])).toEqual([
			'after-show-buffer',
			'after-show-buffer'
		]);
	});

	it('…and on a hook-dead tmux, the alias write alone', () => {
		expect(events(['show-buffer'], [])).toEqual(['after-show-buffer']);
	});

	it("the poll's list-sessions / list-buffers execs account alias + liveness-gated hook", () => {
		expect(events(['list-sessions', '-F', '#{session_name}'], ['after-list-sessions'])).toEqual([
			'after-list-sessions',
			'after-list-sessions'
		]);
		expect(events(['list-sessions', '-F', '#{session_name}'], [])).toEqual(['after-list-sessions']);
		expect(events(['list-buffers', '-F', '#{buffer_name}'], [])).toEqual(['after-list-buffers']);
	});

	it("select-window's live hook line is the neutral WINDOW_NAV_TRIGGER, not a second after-select-window", () => {
		expect(events(['select-window', '-t', ':=0'], ['after-select-window'])).toEqual(
			['after-select-window', 'window-nav-trigger'].sort()
		);
		expect(events(['select-window', '-t', ':=0'], [])).toEqual(['after-select-window']);
	});

	it('kill-session: alias write + hook-if-live + session-closed-if-live', () => {
		expect(events(['kill-session', '-t', 'x'], ['after-kill-session', 'session-closed'])).toEqual([
			'after-kill-session',
			'after-kill-session',
			'session-closed'
		]);
		expect(events(['kill-session', '-t', 'x'], ['session-closed'])).toEqual([
			'after-kill-session',
			'session-closed'
		]);
		expect(events(['kill-session', '-t', 'x'], [])).toEqual(['after-kill-session']);
	});

	it('detach-client is gated on client-detached liveness', () => {
		expect(events(['detach-client'], ['client-detached'])).toEqual(['client-detached']);
		expect(events(['detach-client'], [])).toEqual([]);
	});

	it("speedrun-attach models the runner's REAL attach: gated notification + hook, nothing else", () => {
		expect(events(['speedrun-attach'], ['client-attached', 'after-attach-session'])).toEqual([
			'after-attach-session',
			'client-attached'
		]);
		expect(events(['speedrun-attach'], ['client-attached'])).toEqual(['client-attached']);
		expect(events(['speedrun-attach'], [])).toEqual([]);
	});

	it('the attach-session SPELLING models the shim (switch-client) — never a real attach', () => {
		expect(
			events(['attach-session'], ['client-attached', 'after-attach-session', 'after-switch-client'])
		).toEqual(['after-attach-session', 'after-switch-client']);
		expect(events(['attach-session'], [])).toEqual(['after-attach-session']);
		expect(events(['a'], [])).toEqual(['after-attach-session']);
	});

	it('the new-session shim: alias write + liveness-gated after-new-session hook', () => {
		expect(events(['new-session', '-d', '-s', 'speedrun'], ['after-new-session'])).toEqual([
			'after-new-session',
			'after-new-session'
		]);
		expect(events(['new-session', '-d', '-s', 'speedrun'], [])).toEqual(['after-new-session']);
		expect(events(['new', '-s', 'x'], [])).toEqual(['after-new-session']);
	});

	it('guaranteed-silent runner commands account NOTHING, whatever is live (SUP1)', () => {
		const liveAll = [...(SINK_HOOKS ?? EXPECTED_HOOKS)];
		const silentExecs = [
			['list-panes', '-a', '-F', 'x'],
			['set-option', '-g', '@speedrun_prompt', 'x'],
			['show-options', '-s'],
			['show-hooks', '-g'],
			['display-message', 'hi'],
			['refresh-client'],
			['kill-server'],
			['not-a-real-command']
		];
		for (const args of silentExecs) {
			expect(events(args, liveAll), args.join(' ')).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// R3 — new-session create-AND-switch (interface §11.3). `new-session -d`
// bypasses tmux's nested guard but leaves the client in its old session; an
// APPENDED `after-new-session` hook switches the client into the freshly
// created session. Because a `switch-client` run FROM a hook does not fire
// after-switch-client, this adds NO sink line — accounting is unchanged.
// ---------------------------------------------------------------------------

describe('appended after-new-session switch-client hook (R3, interface §11.3)', () => {
	const text = buildIsolatedConfig({ eventSink: SINK }).text;
	const lines = text.split('\n');

	it('appends a switch-client hook so `tmux new` switches the client into the new session', () => {
		// `-ga` APPENDS to the event's hook list, kept SEPARATE from the
		// sink-writing `after-new-session` hook (both bindings coexist).
		const line = lines.find(
			(l) => l.startsWith('set-hook -ga after-new-session ') && l.includes('switch-client')
		);
		expect(
			line,
			'missing appended `set-hook -ga after-new-session ... switch-client` line'
		).toBeDefined();
	});

	it('keeps the original sink-writing after-new-session hook (both bindings coexist)', () => {
		const sinkLine = lines.find(
			(l) =>
				l.startsWith('set-hook -g after-new-session ') &&
				l.includes(`echo after-new-session >> ${SINK}`)
		);
		expect(sinkLine, 'the sink-writing after-new-session hook must remain').toBeDefined();
	});

	it('keeps after-new-session in SINK_HOOKS', () => {
		expect(SINK_HOOKS ?? EXPECTED_HOOKS).toContain('after-new-session');
	});

	it('the appended switch hook writes NO sink line — new-session accounting is unchanged (§11.3)', () => {
		expect(typeof expectedSinkEventsFor, 'config.ts must export expectedSinkEventsFor').toBe(
			'function'
		);
		// live hook → alias write + live-hook write (both `after-new-session`),
		// and NOTHING from the appended switch-client hook.
		expect(
			[
				...expectedSinkEventsFor!(['new-session', '-d', '-s', 'x'], new Set(['after-new-session']))
			].sort()
		).toEqual(['after-new-session', 'after-new-session']);
		// dead hook → alias write only.
		expect(expectedSinkEventsFor!(['new-session', '-d'], new Set())).toEqual(['after-new-session']);
	});
});
