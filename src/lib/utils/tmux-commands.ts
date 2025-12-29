/**
 * Tmux Text Command System
 *
 * A registry-based architecture for handling text commands in tmux mode.
 * This allows for clean, extensible command handling with varying side effects.
 */

import type { PaneMode } from './pane-tree';

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
	generateOutput?: 'pane-list';
};

/**
 * A command handler function.
 */
export type CommandHandler = (context: CommandContext) => CommandResult;

/**
 * Command definition for registration.
 */
export type CommandDefinition = {
	/** Command name or pattern */
	name: string;
	/** Optional aliases */
	aliases?: string[];
	/** Description for help text */
	description: string;
	/** The handler function */
	handler: CommandHandler;
	/** Whether to match exactly or as a prefix (default: exact) */
	matchMode?: 'exact' | 'prefix';
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
 * Find a matching command definition.
 */
function findCommand(fullCommand: string): CommandDefinition | null {
	for (const def of commandRegistry) {
		const matchMode = def.matchMode ?? 'exact';
		if (matchMode === 'exact') {
			if (def.name === fullCommand) {
				return def;
			}
			if (
				def.aliases?.some((alias) => alias === fullCommand) ||
				def.aliases?.some((alias) => fullCommand.startsWith(alias + ' '))
			) {
				return def;
			}
		} else if (matchMode === 'prefix') {
			if (fullCommand.startsWith(def.name)) {
				return def;
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
 * @returns The command result, or null if no command matched
 */
export function executeCommand(
	command: string,
	paneId: string,
	mode: PaneMode
): CommandResult | null {
	const args = parseCommand(command);

	if (args.length === 0) {
		return null;
	}

	const commandName = args;
	const definition = findCommand(commandName.join(' '));

	if (!definition) {
		return null;
	}

	const context: CommandContext = {
		command: command.trim(),
		args,
		paneId,
		mode
	};

	return definition.handler(context);
}

// ============================================================================
// BUILT-IN COMMANDS
// ============================================================================

/**
 * Exit command - exits tmux mode back to default shell.
 */
registerCommand({
	name: 'exit',
	description: 'Exit tmux session and return to default shell',
	handler: () => ({
		handled: true,
		system: '[detached (from session 0)]',
		newMode: 'default',
		signal: {
			type: 'tmux-exited'
		}
	})
});

/**
 * Clear command - clears the pane history.
 */
registerCommand({
	name: 'clear',
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
	name: 'help',
	description: 'Display available commands',
	handler: () => {
		const commands = getRegisteredCommands();
		const helpText = commands
			.map((cmd) => {
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
	name: 'list-windows',
	aliases: ['lsw'],
	description: 'List all windows',
	handler: () => ({
		handled: true,
		signal: {
			type: 'list-windows'
		}
	})
});

/**
 * List panes command (tmux-style).
 */
registerCommand({
	name: 'list-panes',
	aliases: ['tmux lsp'],
	description: 'List all panes in current window',
	handler: () => ({
		handled: true,
		signal: {
			type: 'list-panes'
		},
		generateOutput: 'pane-list'
	})
});

// ============================================================================
// EXPORTS
// ============================================================================

export { commandRegistry };
