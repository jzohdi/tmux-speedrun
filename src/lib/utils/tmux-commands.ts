/**
 * Tmux Command System
 *
 * SINGLE SOURCE OF TRUTH for all command identifiers used in the application.
 * Both text commands (typed in input) and prefix commands (keybindings) use these IDs.
 *
 * This ensures type safety across:
 * - Command registration
 * - Keybinding definitions
 * - Signal emission
 * - Challenge verification
 */

import type { PaneMode } from './pane-tree';

// ============================================================================
// COMMAND IDENTIFIERS - SINGLE SOURCE OF TRUTH
// ============================================================================

/**
 * Command identifiers - SINGLE SOURCE OF TRUTH for ALL command names.
 *
 * Includes:
 * - Text commands (typed in terminal input)
 * - Prefix commands (triggered via Ctrl+B + key)
 *
 * Use these constants when:
 * - Registering text commands
 * - Defining keybindings
 * - Emitting signals
 * - Defining challenge expectations
 * - Checking executed commands
 */
export const CommandId = {
	// ========================================================================
	// TEXT COMMANDS (typed in terminal input)
	// ========================================================================
	EXIT: 'exit',
	CLEAR: 'clear',
	HELP: 'help',
	TMUX_LIST_PANES: 'tmux list-panes',

	// Text command aliases
	LSP: 'tmux lsp',

	// ========================================================================
	// PREFIX COMMANDS (triggered via Ctrl+B + key)
	// ========================================================================

	// Session Management
	NEW_SESSION: 'new-session',
	ATTACH_SESSION: 'attach-session',
	DETACH: 'detach',
	LIST_SESSIONS: 'list-sessions',
	KILL_SESSION: 'kill-session',
	RENAME_SESSION: 'rename-session',

	// Window Management
	NEW_WINDOW: 'new-window',
	NEXT_WINDOW: 'next-window',
	PREVIOUS_WINDOW: 'previous-window',
	SELECT_WINDOW: 'select-window',
	RENAME_WINDOW: 'rename-window',
	KILL_WINDOW: 'kill-window',
	LIST_WINDOWS: 'list-windows',

	// Pane Management
	SPLIT_HORIZONTAL: 'split-horizontal',
	SPLIT_VERTICAL: 'split-vertical',
	KILL_PANE: 'kill-pane',
	TOGGLE_ZOOM: 'toggle-zoom',
	// NOTE: RESIZE_PANE removed - Ctrl+Arrow conflicts with macOS Mission Control
	SWAP_PANE: 'swap-pane',
	ROTATE_PANES: 'rotate-panes',

	// Navigation
	SELECT_PANE: 'select-pane',
	LAST_PANE: 'last-pane',
	LAST_WINDOW: 'last-window',
	DISPLAY_PANES: 'display-panes',

	// Miscellaneous
	COPY_MODE: 'copy-mode',
	PASTE_BUFFER: 'paste-buffer',
	COMMAND_PROMPT: 'command-prompt',
	SHOW_TIME: 'show-time',
	RELOAD_CONFIG: 'reload-config'
} as const;

/**
 * Union type of all valid command identifiers.
 * Derived automatically from CommandId.
 */
export type CommandIdType = (typeof CommandId)[keyof typeof CommandId];

/**
 * Type guard to check if a string is a valid CommandIdType.
 */
export function isValidCommandId(value: string): value is CommandIdType {
	return Object.values(CommandId).includes(value as CommandIdType);
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Context provided to command handlers.
 */
export type CommandContext = {
	/** The full command string entered */
	command: string;
	/** Parsed arguments (command split by whitespace) */
	args: string[];
	/** Current pane ID */
	paneId: string;
	/** Current pane mode */
	mode: PaneMode;
};

/**
 * Session operation types for command results.
 */
export type SessionOperation =
	| { type: 'create'; name?: string; attach?: boolean }
	| { type: 'attach'; target: string | number }
	| { type: 'detach' }
	| { type: 'kill'; target?: string | number }
	| { type: 'rename'; name: string; target?: string | number };

/**
 * Pane operation types for command results.
 * Used by pane management commands executed via text input or command-prompt.
 */
export type PaneOperation =
	| { type: 'split'; direction: 'horizontal' | 'vertical' }
	| { type: 'kill' }
	| { type: 'toggle-zoom' }
	| { type: 'rotate' }
	| { type: 'swap'; direction: 'next' | 'previous' }
	| { type: 'focus'; direction: 'up' | 'down' | 'left' | 'right' }
	| { type: 'focus-next' }
	| { type: 'focus-previous' }
	| { type: 'focus-last' };

/**
 * Window operation types for command results.
 * Used by window management commands executed via text input or command-prompt.
 */
export type WindowOperation =
	| { type: 'create'; name?: string }
	| { type: 'close'; index?: number }
	| { type: 'switch'; index: number }
	| { type: 'next' }
	| { type: 'previous' }
	| { type: 'rename'; name: string; index?: number }
	| { type: 'last' }
	| { type: 'list' };

export type ConfigOperation = {
	type: 'reload';
	path: string;
};

/**
 * Result returned from a command handler.
 */
export type CommandResult = {
	/** Whether the command was handled */
	handled: boolean;
	/** Output to add to history (optional) */
	output?: string;
	/** Error message to add to history (optional) */
	error?: string;
	/** System message to add to history (optional) */
	system?: string;
	/** New mode to switch to (optional) */
	newMode?: PaneMode;
	/** Whether to clear history (optional) */
	clearHistory?: boolean;
	/** Custom side effects to emit as signals (optional) */
	signal?: {
		type: string;
		data?: Record<string, unknown>;
	};
	/** Type of output to generate (handled by store) */
	generateOutput?: 'pane-list' | 'window-list' | 'session-list';
	/**
	 * Special exit behavior:
	 * - 'close-pane-or-detach': If multiple panes, close current pane; otherwise detach from tmux
	 */
	exitBehavior?: 'close-pane-or-detach';
	/**
	 * Session operation to perform (handled by store).
	 */
	sessionOperation?: SessionOperation;
	/**
	 * Pane operation to perform (handled by store).
	 */
	paneOperation?: PaneOperation;
	/**
	 * Window operation to perform (handled by store).
	 */
	windowOperation?: WindowOperation;
	/**
	 * Config operation to perform (handled by store).
	 */
	configOperation?: ConfigOperation;
};

/**
 * A command handler function.
 */
export type CommandHandler = (context: CommandContext) => CommandResult;

/**
 * Command definition for registration.
 */
export type CommandDefinition = {
	/** Command name - must be a value from CommandId */
	name: CommandIdType;
	/** Optional aliases - must also be CommandIdType values */
	aliases?: CommandIdType[];
	/**
	 * Optional match patterns for text input.
	 * If provided, these patterns are used to match user input instead of the name.
	 * Useful for commands where the typed text differs from the canonical name.
	 * Example: name='list-sessions', matchPatterns=['tmux list-sessions', 'tmux ls']
	 */
	matchPatterns?: string[];
	/** Description for help text */
	description: string;
	/** The handler function */
	handler: CommandHandler;
	/** Whether to match exactly or as a prefix (default: exact) */
	matchMode?: 'exact' | 'prefix';
};

/**
 * Result of command execution including the matched command name.
 */
export type ExecuteResult = {
	/** The command result from the handler */
	result: CommandResult;
	/** The canonical command name that was matched */
	commandName: CommandIdType;
};

// ============================================================================
// COMMAND REGISTRY
// ============================================================================

/**
 * Registry of all available tmux text commands.
 */
const commandRegistry: CommandDefinition[] = [];

/**
 * Register a command in the registry.
 */
export function registerCommand(definition: CommandDefinition): void {
	commandRegistry.push(definition);
}

/**
 * Get all registered commands.
 */
export function getRegisteredCommands(): readonly CommandDefinition[] {
	return commandRegistry;
}

// ============================================================================
// COMMAND EXECUTION
// ============================================================================

/**
 * Parse a command string into args.
 */
function parseCommand(command: string): string[] {
	return command.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Check if a pattern matches the input command.
 */
function matchesPattern(
	normalizedCommand: string,
	pattern: string,
	matchMode: 'exact' | 'prefix'
): boolean {
	const normalizedPattern = pattern.toLowerCase();

	if (matchMode === 'exact') {
		return normalizedCommand === normalizedPattern;
	}

	// prefix mode still needs a token boundary so aliases like "new"
	// don't accidentally match different commands like "new-window".
	return (
		normalizedCommand === normalizedPattern ||
		normalizedCommand.startsWith(normalizedPattern + ' ')
	);
}

/**
 * Find a matching command definition.
 * Returns the definition and the canonical command name.
 */
function findCommand(fullCommand: string): { definition: CommandDefinition } | null {
	const normalizedCommand = fullCommand.trim().toLowerCase();

	// Sort by pattern length (descending) to match longer patterns first
	// This ensures "tmux list-sessions" matches before "tmux ls"
	const sortedRegistry = [...commandRegistry].sort((a, b) => {
		const aMaxLen = Math.max(a.name.length, ...(a.matchPatterns?.map((p) => p.length) ?? []));
		const bMaxLen = Math.max(b.name.length, ...(b.matchPatterns?.map((p) => p.length) ?? []));

		return bMaxLen - aMaxLen;
	});

	for (const def of sortedRegistry) {
		const matchMode = def.matchMode ?? 'exact';

		// If matchPatterns is provided, use those instead of name/aliases
		if (def.matchPatterns && def.matchPatterns.length > 0) {
			for (const pattern of def.matchPatterns) {
				if (matchesPattern(normalizedCommand, pattern, matchMode)) {
					return { definition: def };
				}
			}
			// If matchPatterns is defined, don't fall back to name matching
			continue;
		}

		// Check main name
		if (matchesPattern(normalizedCommand, def.name, matchMode)) {
			return { definition: def };
		}

		// Check aliases
		if (def.aliases) {
			for (const alias of def.aliases) {
				if (matchesPattern(normalizedCommand, alias, matchMode)) {
					return { definition: def };
				}
			}
		}
	}

	return null;
}

/**
 * Execute a command string.
 *
 * @param command - The full command string
 * @param paneId - The ID of the pane executing the command
 * @param mode - The current pane mode
 * @returns The execute result with command name, or null if no command matched
 */
export function executeCommand(
	command: string,
	paneId: string,
	mode: PaneMode
): ExecuteResult | null {
	const args = parseCommand(command);

	if (args.length === 0) {
		return null;
	}

	const match = findCommand(command);

	if (!match) {
		return null;
	}

	const { definition } = match;

	const context: CommandContext = {
		command: command.trim(),
		args,
		paneId,
		mode
	};

	const result = definition.handler(context);

	return {
		result,
		commandName: definition.name
	};
}

function getTrailingArgument(args: string[]): string | null {
	const nonFlagArgs = args.filter((arg) => !arg.startsWith('-'));
	if (nonFlagArgs.length < 2) {
		return null;
	}

	return nonFlagArgs[nonFlagArgs.length - 1];
}

// ============================================================================
// BUILT-IN TEXT COMMANDS
// ============================================================================

/**
 * Exit command - closes current pane if multiple panes exist,
 * otherwise exits tmux mode back to default shell.
 */
registerCommand({
	name: CommandId.EXIT,
	description: 'Exit current pane or detach from tmux session',
	handler: () => ({
		handled: true,
		exitBehavior: 'close-pane-or-detach'
	})
});

/**
 * Clear command - clears the pane history.
 */
registerCommand({
	name: CommandId.CLEAR,
	description: 'Clear the terminal history',
	handler: () => ({
		handled: true,
		clearHistory: true
	})
});

/**
 * Help command - displays available commands.
 */
registerCommand({
	name: CommandId.HELP,
	description: 'Display available commands',
	handler: () => {
		const commands = getRegisteredCommands();
		const helpText = commands
			.map((cmd) => {
				// Show match patterns if available, otherwise show name with aliases
				if (cmd.matchPatterns && cmd.matchPatterns.length > 0) {
					const patterns = cmd.matchPatterns.join(', ');

					return `  ${patterns} - ${cmd.description}`;
				}
				const aliases = cmd.aliases ? ` (aliases: ${cmd.aliases.join(', ')})` : '';

				return `  ${cmd.name}${aliases} - ${cmd.description}`;
			})
			.join('\n');

		return {
			handled: true,
			output: `Available commands:\n${helpText}`
		};
	}
});

/**
 * Reload the tmux configuration file.
 * Supports: tmux source-file <file>, tmux source <file>, source-file <file>, source <file>
 * The non-"tmux" prefixed versions are for command-prompt usage.
 */
registerCommand({
	name: CommandId.RELOAD_CONFIG,
	matchPatterns: ['tmux source-file', 'tmux source', 'source-file', 'source'],
	matchMode: 'prefix',
	description: 'Reload the tmux configuration file',
	handler: (ctx) => {
		const configPath = getTrailingArgument(ctx.args);
		if (!configPath) {
			return {
				handled: true,
				error: 'usage: source-file <path-to-config>'
			};
		}

		return {
			handled: true,
			configOperation: {
				type: 'reload',
				path: configPath
			}
		};
	}
});

/**
 * List windows command (tmux-style).
 * Supports: tmux list-windows, tmux lsw, list-windows, lsw
 * Uses LIST_WINDOWS as canonical name to match challenge expectations.
 * The non-"tmux" prefixed versions are for command-prompt usage.
 */
registerCommand({
	name: CommandId.LIST_WINDOWS,
	matchPatterns: ['tmux list-windows', 'tmux lsw', 'list-windows', 'lsw'],
	description: 'List all windows',
	handler: () => ({
		handled: true,
		generateOutput: 'window-list'
	})
});

/**
 * List panes command (tmux-style).
 * Supports: tmux list-panes, tmux lsp, list-panes, lsp
 * The non-"tmux" prefixed versions are for command-prompt usage.
 */
registerCommand({
	name: CommandId.TMUX_LIST_PANES,
	matchPatterns: ['tmux list-panes', 'tmux lsp', 'list-panes', 'lsp'],
	description: 'List all panes in current window',
	handler: () => ({
		handled: true,
		generateOutput: 'pane-list'
	})
});

/**
 * List sessions command (tmux-style).
 * Supports: tmux list-sessions, tmux ls, list-sessions, ls
 * Uses LIST_SESSIONS as canonical name to match challenge expectations.
 * The non-"tmux" prefixed versions are for command-prompt usage.
 */
registerCommand({
	name: CommandId.LIST_SESSIONS,
	matchPatterns: ['tmux list-sessions', 'tmux ls', 'list-sessions', 'ls'],
	description: 'List all tmux sessions',
	handler: () => ({
		handled: true,
		generateOutput: 'session-list'
	})
});

/**
 * New session command (tmux-style).
 * Supports: tmux new-session, tmux new, new-session, new, tmux new-session -s <name>
 * The non-"tmux" prefixed versions are for command-prompt usage.
 */
registerCommand({
	name: CommandId.NEW_SESSION,
	matchPatterns: ['tmux new-session', 'tmux new', 'new-session', 'new'],
	matchMode: 'prefix',
	description: 'Create a new tmux session',
	handler: (ctx) => {
		// Parse optional -s <name> argument
		// Example: "tmux new-session -s mysession" or "tmux new -s mysession"
		let sessionName: string | undefined;
		const sIndex = ctx.args.indexOf('-s');
		if (sIndex !== -1 && ctx.args[sIndex + 1]) {
			sessionName = ctx.args[sIndex + 1];
		}

		return {
			handled: true,
			sessionOperation: { type: 'create', name: sessionName, attach: true }
		};
	}
});

/**
 * Attach session command (tmux-style).
 * Supports: tmux attach, tmux attach-session, attach, attach-session, a, tmux attach -t <target>
 * The non-"tmux" prefixed versions are for command-prompt usage.
 */
registerCommand({
	name: CommandId.ATTACH_SESSION,
	matchPatterns: ['tmux attach-session', 'tmux attach', 'tmux a', 'attach-session', 'attach', 'a'],
	matchMode: 'prefix',
	description: 'Attach to an existing tmux session',
	handler: (ctx) => {
		// Parse -t <target> argument
		// Example: "tmux attach -t 0" or "tmux attach -t mysession"
		const tIndex = ctx.args.indexOf('-t');
		if (tIndex === -1 || !ctx.args[tIndex + 1]) {
			// No target specified - attach to most recent session (index 0)
			return {
				handled: true,
				sessionOperation: { type: 'attach', target: 0 }
			};
		}

		const target = ctx.args[tIndex + 1];
		// Try to parse as number, otherwise use as string name
		const numTarget = parseInt(target, 10);
		const parsedTarget = isNaN(numTarget) ? target : numTarget;

		return {
			handled: true,
			sessionOperation: { type: 'attach', target: parsedTarget }
		};
	}
});

/**
 * Detach command (tmux-style).
 * Supports: tmux detach, tmux detach-client, detach, detach-client
 * Also triggered by prefix + d keybinding.
 * The non-"tmux" prefixed versions are for command-prompt usage.
 */
registerCommand({
	name: CommandId.DETACH,
	matchPatterns: ['tmux detach', 'tmux detach-client', 'detach', 'detach-client'],
	description: 'Detach from the current tmux session',
	handler: () => ({
		handled: true,
		sessionOperation: { type: 'detach' }
	})
});

/**
 * Kill session command (tmux-style).
 * Supports: tmux kill-session, kill-session, tmux kill-session -t <target>
 * The non-"tmux" prefixed versions are for command-prompt usage.
 */
registerCommand({
	name: CommandId.KILL_SESSION,
	matchPatterns: ['tmux kill-session', 'kill-session'],
	matchMode: 'prefix',
	description: 'Kill a tmux session',
	handler: (ctx) => {
		// Parse optional -t <target> argument
		const tIndex = ctx.args.indexOf('-t');

		if (tIndex === -1 || !ctx.args[tIndex + 1]) {
			// No target - kill current session
			return {
				handled: true,
				sessionOperation: { type: 'kill' }
			};
		}

		const target = ctx.args[tIndex + 1];
		const numTarget = parseInt(target, 10);
		const parsedTarget = isNaN(numTarget) ? target : numTarget;

		return {
			handled: true,
			sessionOperation: { type: 'kill', target: parsedTarget }
		};
	}
});

/**
 * Rename session command (tmux-style).
 * Supports: tmux rename-session, rename-session, tmux rename-session -t <target> <name>
 * The non-"tmux" prefixed versions are for command-prompt usage.
 */
registerCommand({
	name: CommandId.RENAME_SESSION,
	matchPatterns: ['tmux rename-session', 'rename-session'],
	matchMode: 'prefix',
	description: 'Rename a tmux session',
	handler: (ctx) => {
		// Parse: tmux rename-session <name>
		// Or: tmux rename-session -t <target> <name>
		const tIndex = ctx.args.indexOf('-t');

		if (tIndex !== -1 && ctx.args[tIndex + 1] && ctx.args[tIndex + 2]) {
			// Has -t <target> <name>
			const target = ctx.args[tIndex + 1];
			const name = ctx.args[tIndex + 2];
			const numTarget = parseInt(target, 10);
			const parsedTarget = isNaN(numTarget) ? target : numTarget;

			return {
				handled: true,
				sessionOperation: { type: 'rename', name, target: parsedTarget }
			};
		}

		// Just <name> - rename current session
		// Args: ['tmux', 'rename-session', '<name>']
		const name = ctx.args[2];
		if (!name) {
			return {
				handled: true,
				error: 'usage: rename-session [-t target-session] new-name'
			};
		}

		return {
			handled: true,
			sessionOperation: { type: 'rename', name }
		};
	}
});

// ============================================================================
// PANE COMMANDS (for command-prompt and text input)
// ============================================================================

/**
 * Split pane horizontally (top/bottom).
 * In real tmux: split-window or split-window -v creates horizontal split.
 * Note: tmux's -v means "vertical split line" which creates top/bottom panes.
 */
registerCommand({
	name: CommandId.SPLIT_HORIZONTAL,
	matchPatterns: ['split-window', 'split-window -v', 'splitw', 'splitw -v'],
	description: 'Split pane horizontally (top/bottom)',
	handler: () => ({
		handled: true,
		paneOperation: { type: 'split', direction: 'horizontal' }
	})
});

/**
 * Split pane vertically (left/right).
 * In real tmux: split-window -h creates vertical split.
 * Note: tmux's -h means "horizontal split line" which creates left/right panes.
 */
registerCommand({
	name: CommandId.SPLIT_VERTICAL,
	matchPatterns: ['split-window -h', 'splitw -h'],
	description: 'Split pane vertically (left/right)',
	handler: () => ({
		handled: true,
		paneOperation: { type: 'split', direction: 'vertical' }
	})
});

/**
 * Kill the current pane.
 * Supports: kill-pane, killp
 */
registerCommand({
	name: CommandId.KILL_PANE,
	matchPatterns: ['kill-pane', 'killp'],
	description: 'Kill the current pane',
	handler: () => ({
		handled: true,
		paneOperation: { type: 'kill' }
	})
});

/**
 * Toggle pane zoom (fullscreen).
 * In real tmux: resize-pane -Z
 */
registerCommand({
	name: CommandId.TOGGLE_ZOOM,
	matchPatterns: ['resize-pane -Z', 'resizep -Z'],
	description: 'Toggle pane zoom (fullscreen)',
	handler: () => ({
		handled: true,
		paneOperation: { type: 'toggle-zoom' }
	})
});

/**
 * Swap pane with previous or next pane.
 * Supports: swap-pane -U (previous), swap-pane -D (next), swap-pane (defaults to next)
 */
registerCommand({
	name: CommandId.SWAP_PANE,
	matchPatterns: ['swap-pane', 'swapp'],
	matchMode: 'prefix',
	description: 'Swap pane with previous/next pane',
	handler: (ctx) => {
		// -U swaps with previous (up in index), -D swaps with next (down in index)
		const hasUp = ctx.args.includes('-U') || ctx.args.includes('-u');
		const direction = hasUp ? 'previous' : 'next';

		return {
			handled: true,
			paneOperation: { type: 'swap', direction }
		};
	}
});

/**
 * Rotate panes in the current window.
 * In real tmux: rotate-window
 */
registerCommand({
	name: CommandId.ROTATE_PANES,
	matchPatterns: ['rotate-window', 'rotatew'],
	description: 'Rotate panes in current window',
	handler: () => ({
		handled: true,
		paneOperation: { type: 'rotate' }
	})
});

/**
 * Select pane by direction or target.
 * Supports: select-pane -U/-D/-L/-R for direction, select-pane -t <target>
 */
registerCommand({
	name: CommandId.SELECT_PANE,
	matchPatterns: ['select-pane', 'selectp'],
	matchMode: 'prefix',
	description: 'Select pane by direction or target',
	handler: (ctx) => {
		// Check for direction flags
		if (ctx.args.includes('-U') || ctx.args.includes('-u')) {
			return { handled: true, paneOperation: { type: 'focus', direction: 'up' } };
		}
		if (ctx.args.includes('-D') || ctx.args.includes('-d')) {
			return { handled: true, paneOperation: { type: 'focus', direction: 'down' } };
		}
		if (ctx.args.includes('-L') || ctx.args.includes('-l')) {
			return { handled: true, paneOperation: { type: 'focus', direction: 'left' } };
		}
		if (ctx.args.includes('-R') || ctx.args.includes('-r')) {
			return { handled: true, paneOperation: { type: 'focus', direction: 'right' } };
		}

		// Default: cycle to next pane
		return { handled: true, paneOperation: { type: 'focus-next' } };
	}
});

/**
 * Switch to the last active pane.
 */
registerCommand({
	name: CommandId.LAST_PANE,
	matchPatterns: ['last-pane', 'lastp'],
	description: 'Switch to last active pane',
	handler: () => ({
		handled: true,
		paneOperation: { type: 'focus-last' }
	})
});

// ============================================================================
// WINDOW COMMANDS (for command-prompt and text input)
// ============================================================================

/**
 * Create a new window.
 * Supports: new-window, neww, new-window -n <name>
 */
registerCommand({
	name: CommandId.NEW_WINDOW,
	matchPatterns: ['new-window', 'neww'],
	matchMode: 'prefix',
	description: 'Create a new window',
	handler: (ctx) => {
		// Parse optional -n <name> argument
		const nIndex = ctx.args.indexOf('-n');
		const name = nIndex !== -1 && ctx.args[nIndex + 1] ? ctx.args[nIndex + 1] : undefined;

		return {
			handled: true,
			windowOperation: { type: 'create', name }
		};
	}
});

/**
 * Kill the current window.
 * Supports: kill-window, killw
 */
registerCommand({
	name: CommandId.KILL_WINDOW,
	matchPatterns: ['kill-window', 'killw'],
	matchMode: 'prefix',
	description: 'Kill the current window',
	handler: (ctx) => {
		// Parse optional -t <index> argument
		const tIndex = ctx.args.indexOf('-t');
		const index =
			tIndex !== -1 && ctx.args[tIndex + 1] ? parseInt(ctx.args[tIndex + 1], 10) : undefined;

		return {
			handled: true,
			windowOperation: { type: 'close', index: isNaN(index ?? NaN) ? undefined : index }
		};
	}
});

/**
 * Switch to the next window.
 */
registerCommand({
	name: CommandId.NEXT_WINDOW,
	matchPatterns: ['next-window', 'next'],
	description: 'Switch to next window',
	handler: () => ({
		handled: true,
		windowOperation: { type: 'next' }
	})
});

/**
 * Switch to the previous window.
 */
registerCommand({
	name: CommandId.PREVIOUS_WINDOW,
	matchPatterns: ['previous-window', 'prev'],
	description: 'Switch to previous window',
	handler: () => ({
		handled: true,
		windowOperation: { type: 'previous' }
	})
});

/**
 * Select window by index.
 * Supports: select-window -t <index>, selectw -t <index>
 */
registerCommand({
	name: CommandId.SELECT_WINDOW,
	matchPatterns: ['select-window', 'selectw'],
	matchMode: 'prefix',
	description: 'Select window by index',
	handler: (ctx) => {
		// Parse -t <index> argument
		const tIndex = ctx.args.indexOf('-t');
		if (tIndex !== -1 && ctx.args[tIndex + 1]) {
			const index = parseInt(ctx.args[tIndex + 1], 10);
			if (!isNaN(index)) {
				return {
					handled: true,
					windowOperation: { type: 'switch', index }
				};
			}
		}

		return { handled: true, error: 'usage: select-window -t <index>' };
	}
});

/**
 * Rename the current window.
 * Supports: rename-window <name>, renamew <name>
 */
registerCommand({
	name: CommandId.RENAME_WINDOW,
	matchPatterns: ['rename-window', 'renamew'],
	matchMode: 'prefix',
	description: 'Rename the current window',
	handler: (ctx) => {
		// Parse: rename-window <name> or rename-window -t <index> <name>
		const tIndex = ctx.args.indexOf('-t');

		if (tIndex !== -1 && ctx.args[tIndex + 1] && ctx.args[tIndex + 2]) {
			// Has -t <index> <name>
			const index = parseInt(ctx.args[tIndex + 1], 10);
			const name = ctx.args[tIndex + 2];

			return {
				handled: true,
				windowOperation: { type: 'rename', name, index: isNaN(index) ? undefined : index }
			};
		}

		// Find the name argument (last non-flag argument)
		// Command format: rename-window <name> or renamew <name>
		const nonFlagArgs = ctx.args.filter((arg) => !arg.startsWith('-'));
		// First non-flag arg is the command name itself, second is the new name
		const name = nonFlagArgs.length > 1 ? nonFlagArgs[nonFlagArgs.length - 1] : undefined;

		if (!name) {
			return { handled: true, error: 'usage: rename-window [-t target-window] <new-name>' };
		}

		return {
			handled: true,
			windowOperation: { type: 'rename', name }
		};
	}
});

/**
 * Switch to the last active window.
 */
registerCommand({
	name: CommandId.LAST_WINDOW,
	matchPatterns: ['last-window', 'last'],
	description: 'Switch to last active window',
	handler: () => ({
		handled: true,
		windowOperation: { type: 'last' }
	})
});

// ============================================================================
// EXPORTS
// ============================================================================

export { commandRegistry };
