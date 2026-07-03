/**
 * Generated isolated tmux config (issue #35, interface §5.3).
 *
 * Independent of the user's ~/.tmux.conf (passed via `-f`). Configures the
 * status line for the prompt/progress/timer, a short status interval, and
 * installs observer hooks that fire a notifier writing "event" lines to the
 * event sink so the controller re-queries on change (triggers only; the
 * observer always re-queries + diffs — exhaustive hook coverage is not required).
 */

export type GeneratedConfig = { text: string };

/** tmux hooks worth installing as change triggers for the pool commands. */
const HOOK_EVENTS = [
	'after-split-window',
	'after-new-window',
	'after-new-session',
	'after-kill-pane',
	'after-select-pane',
	'after-select-window',
	'after-rename-window',
	'after-rename-session',
	'session-closed',
	'window-renamed',
	'pane-focus-in',
	'pane-mode-changed'
];

/**
 * Build the isolated tmux.conf text. `eventSink` is the FIFO/socket path the
 * hook notifier writes event lines to (the observer reads it as a change
 * trigger). Writing is best-effort (`|| true`) so a missing sink never breaks
 * tmux.
 */
export function buildIsolatedConfig(opts: { eventSink: string }): GeneratedConfig {
	const sink = opts.eventSink;
	const hookLines = HOOK_EVENTS.map(
		(evt) => `set-hook -g ${evt} 'run-shell "printf %s\\\\n ${evt} >> ${sink} || true"'`
	);

	const text = [
		'# tmux-speedrun isolated challenge config (generated; do not edit)',
		'set -g mouse off',
		'set -g status on',
		'set -g status-interval 1',
		"set -g status-left '[tmux-speedrun] '",
		'set -g status-left-length 120',
		"set -g status-right ''",
		'set -g status-right-length 120',
		"set -g status-style 'bg=colour24,fg=white'",
		...hookLines,
		''
	].join('\n');

	return { text };
}
