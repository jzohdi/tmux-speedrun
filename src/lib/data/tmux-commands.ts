/**
 * SINGLE SOURCE OF TRUTH for all tmux commands used in the application.
 * The `man tmux` command in the terminal emulator reads from this file.
 * Challenges reference commands from this list.
 */

export type TmuxCommand = {
	name: string;
	shortcut: string;
	description: string;
	difficulty: 'beginner' | 'intermediate' | 'advanced';
	category: 'session' | 'window' | 'pane' | 'navigation' | 'misc';
	/**
	 * If true, this command requires text input (e.g., rename-window needs a name).
	 * These commands generate compound answers like "rename-window:swift-tiger-42"
	 * to expand the answer space and prevent brute-force attacks.
	 */
	requiresInput?: boolean;
};

export const TMUX_COMMANDS: TmuxCommand[] = [
	// Session Management - Beginner
	{
		name: 'new-session',
		shortcut: 'tmux new -s <name>',
		description: 'Create a new named tmux session',
		difficulty: 'beginner',
		category: 'session'
	},
	{
		name: 'attach-session',
		shortcut: 'tmux attach -t <name>',
		description: 'Attach to an existing session by name',
		difficulty: 'beginner',
		category: 'session'
	},
	{
		name: 'detach',
		shortcut: 'prefix + d',
		description: 'Detach from the current session',
		difficulty: 'beginner',
		category: 'session'
	},
	{
		name: 'list-sessions',
		shortcut: 'tmux ls, tmux list-sessions',
		description: 'List all active tmux sessions',
		difficulty: 'beginner',
		category: 'session'
	},
	{
		name: 'kill-session',
		shortcut: 'tmux kill-session -t <name>',
		description: 'Kill a specific session',
		difficulty: 'beginner',
		category: 'session'
	},
	{
		name: 'rename-session',
		shortcut: 'prefix + $',
		description: 'Rename the current session',
		difficulty: 'beginner',
		category: 'session',
		requiresInput: true
	},

	// Window Management - Beginner/Intermediate
	{
		name: 'new-window',
		shortcut: 'prefix + c',
		description: 'Create a new window in the current session',
		difficulty: 'beginner',
		category: 'window'
	},
	{
		name: 'next-window',
		shortcut: 'prefix + n',
		description: 'Move to the next window',
		difficulty: 'beginner',
		category: 'window'
	},
	{
		name: 'previous-window',
		shortcut: 'prefix + p',
		description: 'Move to the previous window',
		difficulty: 'beginner',
		category: 'window'
	},
	{
		name: 'select-window',
		shortcut: 'prefix + <0-9>',
		description: 'Select window by number',
		difficulty: 'beginner',
		category: 'window'
	},
	{
		name: 'rename-window',
		shortcut: 'prefix + ,',
		description: 'Rename the current window',
		difficulty: 'beginner',
		category: 'window',
		requiresInput: true
	},
	{
		name: 'kill-window',
		shortcut: 'prefix + &',
		description: 'Kill the current window',
		difficulty: 'intermediate',
		category: 'window'
	},
	{
		name: 'list-windows',
		shortcut: 'prefix + w, tmux lsw, tmux list-windows',
		description:
			'List all windows (interactive selection with prefix + w, or text output with tmux command)',
		difficulty: 'beginner',
		category: 'window'
	},

	// Pane Management - Intermediate
	{
		name: 'split-horizontal',
		shortcut: 'prefix + "',
		description: 'Split pane horizontally (top/bottom)',
		difficulty: 'beginner',
		category: 'pane'
	},
	{
		name: 'split-vertical',
		shortcut: 'prefix + %',
		description: 'Split pane vertically (left/right)',
		difficulty: 'beginner',
		category: 'pane'
	},
	{
		name: 'kill-pane',
		shortcut: 'prefix + x',
		description: 'Kill the current pane',
		difficulty: 'intermediate',
		category: 'pane'
	},
	{
		name: 'toggle-zoom',
		shortcut: 'prefix + z',
		description: 'Toggle pane zoom (fullscreen)',
		difficulty: 'intermediate',
		category: 'pane'
	},
	{
		name: 'resize-pane',
		shortcut: 'prefix + Ctrl+Arrow',
		description: 'Resize pane in arrow direction',
		difficulty: 'intermediate',
		category: 'pane'
	},
	{
		name: 'swap-pane',
		shortcut: 'prefix + { or }',
		description: 'Swap pane with previous/next pane',
		difficulty: 'advanced',
		category: 'pane'
	},
	{
		name: 'rotate-panes',
		shortcut: 'prefix + Ctrl+o',
		description: 'Rotate panes in current window',
		difficulty: 'advanced',
		category: 'pane'
	},

	// Navigation - Beginner/Intermediate
	{
		name: 'select-pane',
		shortcut: 'prefix + Arrow',
		description: 'Move to pane in arrow direction',
		difficulty: 'beginner',
		category: 'navigation'
	},
	{
		name: 'last-pane',
		shortcut: 'prefix + ;',
		description: 'Move to the last active pane',
		difficulty: 'intermediate',
		category: 'navigation'
	},
	{
		name: 'last-window',
		shortcut: 'prefix + l',
		description: 'Move to the last active window',
		difficulty: 'intermediate',
		category: 'navigation'
	},
	{
		name: 'display-panes',
		shortcut: 'prefix + q',
		description: 'Display pane numbers for quick selection',
		difficulty: 'intermediate',
		category: 'navigation'
	},

	// Miscellaneous - Various
	{
		name: 'copy-mode',
		shortcut: 'prefix + [',
		description: 'Enter copy mode for scrolling/selecting',
		difficulty: 'intermediate',
		category: 'misc'
	},
	{
		name: 'paste-buffer',
		shortcut: 'prefix + ]',
		description: 'Paste from the tmux buffer',
		difficulty: 'intermediate',
		category: 'misc'
	},
	{
		name: 'command-prompt',
		shortcut: 'prefix + :',
		description: 'Open tmux command prompt',
		difficulty: 'advanced',
		category: 'misc'
	},
	{
		name: 'show-time',
		shortcut: 'prefix + t',
		description: 'Display a clock in the current pane',
		difficulty: 'beginner',
		category: 'misc'
	},
	{
		name: 'reload-config',
		shortcut: 'tmux source-file ~/.tmux.conf',
		description: 'Reload tmux configuration file',
		difficulty: 'intermediate',
		category: 'misc'
	}
];

// Helper functions
export function getCommandsByCategory(category: TmuxCommand['category']): TmuxCommand[] {
	return TMUX_COMMANDS.filter((cmd) => cmd.category === category);
}

export function getCommandsByDifficulty(difficulty: TmuxCommand['difficulty']): TmuxCommand[] {
	return TMUX_COMMANDS.filter((cmd) => cmd.difficulty === difficulty);
}

export function getCommandByName(name: string): TmuxCommand | undefined {
	return TMUX_COMMANDS.find((cmd) => cmd.name === name);
}

export function getCommandNames(): string[] {
	return TMUX_COMMANDS.map((cmd) => cmd.name);
}

/**
 * Get all commands that require text input.
 * These are used to expand the answer space in challenges.
 */
export function getInputCommands(): TmuxCommand[] {
	return TMUX_COMMANDS.filter((cmd) => cmd.requiresInput === true);
}

/**
 * Get commands that do NOT require text input.
 */
export function getSimpleCommands(): TmuxCommand[] {
	return TMUX_COMMANDS.filter((cmd) => cmd.requiresInput !== true);
}

// Categories for display
export const COMMAND_CATEGORIES: { key: TmuxCommand['category']; label: string }[] = [
	{ key: 'session', label: 'Session Management' },
	{ key: 'window', label: 'Window Management' },
	{ key: 'pane', label: 'Pane Management' },
	{ key: 'navigation', label: 'Navigation' },
	{ key: 'misc', label: 'Miscellaneous' }
];

/**
 * Get all commands that can appear in any challenge.
 *
 * This returns all defined tmux commands since challenge level 5
 * includes all commands. Used by the manpage in challenge mode.
 *
 * @returns All TmuxCommand objects
 */
export function getAllChallengeCommands(): TmuxCommand[] {
	return TMUX_COMMANDS;
}

/**
 * Get commands by category, optionally filtered to a specific set of command names.
 *
 * @param category - The category to filter by
 * @param allowedCommandNames - Optional set of command names to include
 * @returns Filtered commands
 */
export function getCommandsByCategoryFiltered(
	category: TmuxCommand['category'],
	allowedCommandNames?: Set<string>
): TmuxCommand[] {
	return TMUX_COMMANDS.filter((cmd) => {
		if (cmd.category !== category) {
			return false;
		}
		if (allowedCommandNames && !allowedCommandNames.has(cmd.name)) {
			return false;
		}

		return true;
	});
}
