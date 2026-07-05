/**
 * Generated isolated tmux config (issue #35 §5.3; issue #45, interface §2).
 *
 * Independent of the user's ~/.tmux.conf (passed via `-f`). Issue #45 makes
 * this config the foundation of the challenge-run fixes:
 *  - `exit-empty off` so the private server survives `kill-session` of its
 *    last session (the kill becomes observable and recovery possible),
 *  - a STATIC `status-left '#{@speedrun_prompt}'` indirection so the prompt
 *    has exactly one render source of truth (invariant PR1),
 *  - a SINK_HOOKS hook per pool command writing its own name to the event
 *    sink, turning the sink into a real command-event channel (defect 2).
 */

export type GeneratedConfig = { text: string };

export type KeyRebind = {
	key: string;
	repeat?: boolean;
	events: readonly string[];
	command: string;
};

export type CommandAlias = {
	names: readonly string[];
	events: readonly string[];
	command: string;
};

/**
 * Every hook installed in the generated conf; each writes its own name as one
 * line to the event sink. Covers each pool command's underlying tmux command
 * plus the notification hooks the observer/detector read. NEVER includes
 * hooks for commands the runner executes without suppression accounting
 * (`set-option`, `display-message`, `list-panes`, `refresh-client` — SUP1).
 */
export const SINK_HOOKS: readonly string[] = [
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
	'after-rotate-window',
	'after-select-pane',
	'after-select-window',
	'after-show-buffer',
	'after-source-file',
	'after-split-window',
	'after-swap-pane',
	'after-swap-window',
	'after-switch-client',
	'client-attached',
	'client-detached',
	'session-closed',
	'window-renamed',
	'pane-mode-changed',
	'pane-focus-in'
];

/**
 * What the (live) `after-select-window` hook writes to the sink. tmux fires
 * that hook for next/previous/last-window too, so it cannot be allowed to
 * write `after-select-window` — a generic move would masquerade as a targeted
 * select (issue #45 defect 2). It writes this neutral trigger instead, and
 * each window-nav input path (number keys, n/p/l, typed forms) writes its own
 * exact event via rebind/alias.
 */
export const WINDOW_NAV_TRIGGER = 'window-nav-trigger';

/** Sink event written by the `z` rebind; resize-pane has no after-hook. */
export const ZOOM_KEY_EVENT = 'zoom-key';

/** Private alias used only by the runner to reach the real attach-session command. */
export const RUNNER_ATTACH_COMMAND = 'speedrun-attach';

export const KEY_REBINDS: readonly KeyRebind[] = [
	...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
		key: String(n),
		events: ['after-select-window'],
		command: `select-window -t :=${n}`
	})),
	{ key: 'n', events: ['after-next-window'], command: 'next-window' },
	{ key: 'p', events: ['after-previous-window'], command: 'previous-window' },
	{ key: 'l', events: ['after-last-window'], command: 'last-window' },
	{ key: "';'", events: ['after-last-pane'], command: 'last-pane' },
	{ key: "'{'", events: ['after-swap-pane'], command: 'swap-pane -U' },
	{ key: "'}'", events: ['after-swap-pane'], command: 'swap-pane -D' },
	{ key: 'C-o', events: ['after-rotate-window'], command: 'rotate-window' },
	{ key: "'!'", events: ['after-break-pane'], command: 'break-pane' },
	{ key: "':'", events: ['after-command-prompt'], command: 'command-prompt' },
	{ key: 't', events: ['after-clock-mode'], command: 'clock-mode' },
	{ key: 'w', events: ['after-choose-tree'], command: 'choose-tree -Zw' },
	{ key: 's', events: ['after-choose-tree'], command: 'choose-tree -Zs' },
	{ key: "'('", events: ['after-switch-client'], command: 'switch-client -p' },
	{ key: "')'", events: ['after-switch-client'], command: 'switch-client -n' },
	{ key: 'Up', repeat: true, events: ['after-select-pane'], command: 'select-pane -U' },
	{ key: 'Down', repeat: true, events: ['after-select-pane'], command: 'select-pane -D' },
	{ key: 'Left', repeat: true, events: ['after-select-pane'], command: 'select-pane -L' },
	{ key: 'Right', repeat: true, events: ['after-select-pane'], command: 'select-pane -R' },
	{ key: 'o', events: ['after-select-pane'], command: 'select-pane -t :.+' },
	{ key: 'z', events: [ZOOM_KEY_EVENT], command: 'resize-pane -Z' },
	{ key: "']'", events: ['after-paste-buffer'], command: 'paste-buffer' },
	{ key: 'q', events: ['after-display-panes'], command: 'display-panes' },
	{ key: "'?'", events: ['after-list-keys'], command: 'list-keys' }
];

export const COMMAND_ALIASES: readonly CommandAlias[] = [
	{ names: ['show-buffer', 'showb'], events: ['after-show-buffer'], command: 'show-buffer' },
	{ names: ['source-file', 'source'], events: ['after-source-file'], command: 'source-file' },
	{ names: ['kill-session'], events: ['after-kill-session'], command: 'kill-session' },
	{
		names: ['select-window', 'selectw'],
		events: ['after-select-window'],
		command: 'select-window'
	},
	{ names: ['next-window', 'next'], events: ['after-next-window'], command: 'next-window' },
	{
		names: ['previous-window', 'prev'],
		events: ['after-previous-window'],
		command: 'previous-window'
	},
	{ names: ['last-window', 'last'], events: ['after-last-window'], command: 'last-window' },
	{ names: ['new-session', 'new'], events: ['after-new-session'], command: 'new-session -d' },
	{
		names: ['attach-session', 'attach', 'a'],
		events: ['after-attach-session'],
		command: 'switch-client'
	},
	{ names: ['list-sessions', 'ls'], events: ['after-list-sessions'], command: 'list-sessions' },
	{ names: ['list-windows', 'lsw'], events: ['after-list-windows'], command: 'list-windows' },
	{ names: ['list-buffers', 'lsb'], events: ['after-list-buffers'], command: 'list-buffers' },
	{
		names: ['delete-buffer', 'deleteb'],
		events: ['after-delete-buffer'],
		command: 'delete-buffer'
	},
	{ names: ['capture-pane', 'capturep'], events: ['after-capture-pane'], command: 'capture-pane' },
	{ names: ['join-pane', 'joinp'], events: ['after-join-pane'], command: 'join-pane' },
	{ names: ['swap-window', 'swapw'], events: ['after-swap-window'], command: 'swap-window' },
	{ names: ['list-keys', 'lsk'], events: ['after-list-keys'], command: 'list-keys' }
];

/**
 * Pure. Given tmux exec args and the set of hooks this tmux accepted, return
 * the exact sink-line multiset that one runner exec produces.
 */
export function expectedSinkEventsFor(args: string[], liveHooks: ReadonlySet<string>): string[] {
	const command = args[0];
	if (command === RUNNER_ATTACH_COMMAND) {
		const events: string[] = [];
		if (liveHooks.has('client-attached')) events.push('client-attached');
		if (liveHooks.has('after-attach-session')) events.push('after-attach-session');
		return events;
	}

	const alias = COMMAND_ALIASES.find((entry) => entry.names.includes(command));
	const canonicalCommand = alias ? firstWord(alias.command) : command;
	const events = alias ? [...alias.events] : [];
	const hook = `after-${canonicalCommand}`;

	if (SINK_HOOKS.includes(hook) && liveHooks.has(hook)) {
		events.push(canonicalCommand === 'select-window' ? WINDOW_NAV_TRIGGER : hook);
	}
	if (
		['next-window', 'previous-window', 'last-window'].includes(canonicalCommand) &&
		liveHooks.has('after-select-window')
	) {
		// Real tmux also fires after-select-window for generic window movement;
		// the hook writes only the neutral trigger so it never satisfies a step.
		events.push(WINDOW_NAV_TRIGGER);
	}
	if (canonicalCommand === 'detach-client' && liveHooks.has('client-detached')) {
		events.push('client-detached');
	}
	if (canonicalCommand === 'kill-session' && liveHooks.has('session-closed')) {
		events.push('session-closed');
	}

	return events;
}

/**
 * Build the isolated tmux.conf text. `eventSink` is the file path the hook
 * notifier appends event lines to (the observer tails it). Writing is
 * best-effort (`|| true`) so a missing sink never breaks tmux. (The previous
 * `printf %s\\n` notifier lost its backslash through the tmux→sh quoting
 * chain and produced newline-less garbage — `echo` survives it.)
 *
 * Real tmux (verified on 3.6a) whitelists `after-*` hook names: only 16 of
 * the SINK_HOOKS command hooks are settable; the rest are config errors the
 * server absorbs at startup (server.ts) and NEVER fire. Every pool command
 * whose hook is dead gets a fallback channel here:
 *  - key rebinds: the default key runs a sink write, then the default command
 *    (documented `prefix + <key>` actions),
 *  - command-alias interceptors: typed commands (`tmux show-buffer`,
 *    `tmux source-file`, window-nav command forms) expand to the sink write
 *    plus the real command (aliases are resolved before builtin names and do
 *    not recurse; trailing args attach to the final command).
 * Window navigation is special (defect 2): the live `after-select-window`
 * hook fires for ALL of select/next/previous/last-window, so it writes only
 * the neutral WINDOW_NAV_TRIGGER, and each input path — the number keys,
 * n/p/l, and the typed command forms — writes its own exact event. The write
 * happens before the command, so the event arrives even when the movement is
 * a no-op (prefix+0 on the already-active window) or fails (prefix+n with a
 * single window).
 */
export function buildIsolatedConfig(opts: { eventSink: string }): GeneratedConfig {
	const sink = opts.eventSink;
	const hookLines = SINK_HOOKS.map((evt) => {
		if (evt === 'window-renamed') {
			// Rename detection is state-diff based. This notification can arrive
			// late after setup/new-session and is trigger-only, so keep it inert.
			return `set-hook -g ${evt} 'run-shell "true # ${sink}"'`;
		}
		const line = evt === 'after-select-window' ? WINDOW_NAV_TRIGGER : evt;
		return `set-hook -g ${evt} 'run-shell "echo ${line} >> ${sink} || true"'`;
	});

	// R3 §9.3: `new-session -d` (the nested-guard-bypassing shim) creates the
	// session detached, leaving the client in its old session. This APPENDED
	// (`-ga`) after-new-session hook switches the requesting client into the
	// freshly created session so `tmux new` creates AND switches, per feedback.
	// A `switch-client` run from a hook does not fire after-switch-client, so it
	// writes no sink line — accounting is unchanged. For runner-origin detached
	// creates (no attached client) it is a quiet no-op.
	// Gate on a present client (`#{client_tty}` non-empty) so runner-origin
	// detached creates — where there is no attached client — are a quiet no-op
	// instead of a "no current client" error that would surface as the command's
	// exit code (§9.3 risk note).
	const switchOnNewSessionHook =
		'set-hook -ga after-new-session \'if-shell -F "#{client_tty}" "switch-client -t \\"#{hook_session}\\""\'';

	const write = (events: readonly string[]) =>
		events.map((evt) => `echo ${evt} >> ${sink} || true`).join('; ');

	const rebindLines = KEY_REBINDS.map((rebind) => {
		const repeat = rebind.repeat ? '-r ' : '';
		return `bind-key ${repeat}${rebind.key} { run-shell '${write(rebind.events)}' ; ${rebind.command} }`;
	});

	const eventAliasLines = COMMAND_ALIASES.flatMap((alias) =>
		alias.names.map((name) => `${name}=run-shell "${write(alias.events)}" ; ${alias.command}`)
	);
	const aliasConfigLines = [`${RUNNER_ATTACH_COMMAND}=attach-session`, ...eventAliasLines].map(
		(alias, i) => `set -s command-alias[${100 + i}] '${alias}'`
	);

	const text = [
		'# tmux-speedrun isolated challenge config (generated; do not edit)',
		'set -g mouse off',
		'set -g exit-empty off',
		'set -g status on',
		'set -g status-interval 1',
		"set -g @speedrun_prompt ''",
		"set -g status-left '#{@speedrun_prompt}'",
		'set -g status-left-length 120',
		"set -g status-right ''",
		'set -g status-right-length 120',
		"set -g status-style 'bg=colour24,fg=white'",
		...hookLines,
		switchOnNewSessionHook,
		...rebindLines,
		...aliasConfigLines,
		''
	].join('\n');

	return { text };
}

function firstWord(command: string): string {
	const [word] = command.split(' ');
	return word ?? command;
}
