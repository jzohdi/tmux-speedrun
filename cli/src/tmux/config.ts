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

/**
 * Pure. Given tmux exec args, return the sink event lines that exec will
 * cause, for runner self-suppression accounting (interface §2.3, SUP1). The
 * command word is args[0] (full command names; the runner never uses aliases).
 */
export function expectedSinkEventsFor(args: string[]): string[] {
	const command = args[0];
	switch (command) {
		case 'detach-client':
			return ['client-detached'];
		case 'attach-session':
			return ['client-attached', 'after-attach-session'];
		case 'kill-session':
			return ['after-kill-session', 'session-closed'];
	}
	const hook = `after-${command}`;
	return SINK_HOOKS.includes(hook) ? [hook] : [];
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
		const line = evt === 'after-select-window' ? WINDOW_NAV_TRIGGER : evt;
		return `set-hook -g ${evt} 'run-shell "echo ${line} >> ${sink} || true"'`;
	});

	const write = (events: string[]) =>
		events.map((evt) => `echo ${evt} >> ${sink} || true`).join('; ');

	const rebind = (key: string, events: string, command: string) =>
		`bind-key ${key} { run-shell '${events}' ; ${command} }`;
	const rebindLines = [
		...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) =>
			rebind(String(n), write(['after-select-window']), `select-window -t :=${n}`)
		),
		rebind('n', write(['after-next-window']), 'next-window'),
		rebind('p', write(['after-previous-window']), 'previous-window'),
		rebind('l', write(['after-last-window']), 'last-window'),
		rebind("';'", write(['after-last-pane']), 'last-pane'),
		rebind("'{'", write(['after-swap-pane']), 'swap-pane -U'),
		rebind("'}'", write(['after-swap-pane']), 'swap-pane -D'),
		rebind('C-o', write(['after-rotate-window']), 'rotate-window'),
		rebind("'!'", write(['after-break-pane']), 'break-pane'),
		rebind("':'", write(['after-command-prompt']), 'command-prompt'),
		rebind('t', write(['after-clock-mode']), 'clock-mode'),
		rebind('w', write(['after-choose-tree']), 'choose-tree -Zw'),
		rebind('s', write(['after-choose-tree']), 'choose-tree -Zs'),
		rebind("'('", write(['after-switch-client']), 'switch-client -p'),
		rebind("')'", write(['after-switch-client']), 'switch-client -n')
	];

	const aliasSpecs: [names: string[], events: string, command: string][] = [
		[['show-buffer', 'showb'], write(['after-show-buffer']), 'show-buffer'],
		[['source-file', 'source'], write(['after-source-file']), 'source-file'],
		[['kill-session'], write(['after-kill-session']), 'kill-session'],
		[['select-window', 'selectw'], write(['after-select-window']), 'select-window'],
		[['next-window', 'next'], write(['after-next-window']), 'next-window'],
		[['previous-window', 'prev'], write(['after-previous-window']), 'previous-window'],
		[['last-window', 'last'], write(['after-last-window']), 'last-window']
	];
	const aliasConfigLines = aliasSpecs
		.flatMap(([names, events, command]) =>
			names.map((name) => `${name}=run-shell "${events}" ; ${command}`)
		)
		.map((alias, i) => `set -s command-alias[${100 + i}] '${alias}'`);

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
		...rebindLines,
		...aliasConfigLines,
		''
	].join('\n');

	return { text };
}
