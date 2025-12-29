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
	TMUX_LIST_WINDOWS: 'tmux list-windows',

	// Text command aliases
	LSP: 'tmux lsp',
	LSW: 'tmux lsw',

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
	RESIZE_PANE: 'resize-pane',
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
		return (
			normalizedCommand === normalizedPattern ||
			normalizedCommand.startsWith(normalizedPattern + ' ')
		);
	}

	// prefix mode
	return normalizedCommand.startsWith(normalizedPattern);
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
 * List windows command (tmux-style).
 */
registerCommand({
	name: CommandId.TMUX_LIST_WINDOWS,
	aliases: [CommandId.LSW],
	description: 'List all windows',
	handler: () => ({
		handled: true,
		generateOutput: 'window-list'
	})
});

/**
 * List panes command (tmux-style).
 */
registerCommand({
	name: CommandId.TMUX_LIST_PANES,
	aliases: [CommandId.LSP],
	description: 'List all panes in current window',
	handler: () => ({
		handled: true,
		generateOutput: 'pane-list'
	})
});

/**
 * List sessions command (tmux-style).
 * Supports: tmux list-sessions, tmux ls
 * Uses LIST_SESSIONS as canonical name to match challenge expectations.
 */
registerCommand({
	name: CommandId.LIST_SESSIONS,
	matchPatterns: ['tmux list-sessions', 'tmux ls'],
	description: 'List all tmux sessions',
	handler: () => ({
		handled: true,
		generateOutput: 'session-list'
	})
});

// ============================================================================
// EXPORTS
// ============================================================================

export { commandRegistry };
