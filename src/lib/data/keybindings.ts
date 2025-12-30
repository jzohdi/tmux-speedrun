/**
 * Tmux keybinding definitions.
 *
 * Maps keyboard keys to tmux command names.
 * The prefix (Ctrl+b) must be pressed first, then the command key.
 *
 * Uses CommandIdType from tmux-commands.ts for type safety.
 */

import { TMUX_COMMANDS, type TmuxCommand } from './tmux-commands';
import { type CommandIdType, isValidCommandId } from '$lib/utils/tmux-commands';

/**
 * Keybinding type for prefix-based commands.
 */
export type Keybinding = {
	/** The key to press after prefix (e.g., '%', 'c', 'ArrowUp') */
	key: string;
	/** Whether Ctrl must be held with the key */
	withCtrl?: boolean;
	/** Whether Shift must be held with the key */
	withShift?: boolean;
	/** The command name this binding triggers (type-safe) */
	commandName: CommandIdType;
	/** Human-readable description of the key */
	keyDisplay: string;
};

/**
 * Parse a shortcut string like "prefix + %" into a key binding.
 * Handles shortcuts with multiple parts separated by commas (e.g., "prefix + w, tmux lsw").
 *
 * @param shortcut - The shortcut string from TmuxCommand
 * @param commandName - The command name (must be a valid CommandIdType)
 * @returns Keybinding or null if not a prefix-based shortcut
 */
function parseShortcut(shortcut: string, commandName: string): Keybinding | Keybinding[] | null {
	// Handle shortcuts with multiple parts (e.g., "prefix + w, tmux lsw, tmux list-windows")
	// Extract only the prefix-based part
	const parts = shortcut.split(',').map((p) => p.trim());
	const prefixPart = parts.find((p) => p.startsWith('prefix + '));

	// Skip non-prefix shortcuts (CLI commands like "tmux new -s <name>")
	if (!prefixPart) {
		return null;
	}

	// Validate that the command name is a valid CommandIdType
	if (!isValidCommandId(commandName)) {
		console.warn(`Unknown command name in keybindings: ${commandName}`);
		return null;
	}

	const typedCommandName: CommandIdType = commandName;
	const keyPart = prefixPart.replace('prefix + ', '').trim();

	// Handle special cases
	if (keyPart === '<0-9>') {
		// select-window: any digit key
		return Array.from({ length: 10 }, (_, i) => ({
			key: String(i),
			commandName: typedCommandName,
			keyDisplay: String(i)
		}));
	}

	if (keyPart === 'Arrow') {
		// select-pane: any arrow key
		return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map((arrow) => ({
			key: arrow,
			commandName: typedCommandName,
			keyDisplay: arrow.replace(
				'Arrow',
				'↑↓←→'.charAt(['Up', 'Down', 'Left', 'Right'].indexOf(arrow.replace('Arrow', '')))
			)
		}));
	}

	if (keyPart === 'Ctrl+Arrow') {
		// resize-pane: Ctrl + any arrow key
		return ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map((arrow) => ({
			key: arrow,
			withCtrl: true,
			commandName: typedCommandName,
			keyDisplay: `Ctrl+${arrow.replace('Arrow', '')}`
		}));
	}

	if (keyPart === 'Ctrl+o') {
		return {
			key: 'o',
			withCtrl: true,
			commandName: typedCommandName,
			keyDisplay: 'Ctrl+o'
		};
	}

	if (keyPart === '{ or }') {
		// swap-pane: either { or }
		return [
			{ key: '{', commandName: typedCommandName, keyDisplay: '{' },
			{ key: '}', commandName: typedCommandName, keyDisplay: '}' }
		];
	}

	// Single character shortcuts
	// Note: For special characters, we use the actual character as the key
	return {
		key: keyPart,
		commandName: typedCommandName,
		keyDisplay: keyPart
	};
}

/**
 * Build the keybinding map from TMUX_COMMANDS.
 */
function buildKeybindingMap(): Map<string, Keybinding> {
	const map = new Map<string, Keybinding>();

	for (const cmd of TMUX_COMMANDS) {
		const parsed = parseShortcut(cmd.shortcut, cmd.name);

		if (!parsed) {
			continue;
		}

		const bindings = Array.isArray(parsed) ? parsed : [parsed];

		for (const binding of bindings) {
			// Create a unique key for the binding
			const mapKey = createBindingKey(binding);
			map.set(mapKey, binding);
		}
	}

	return map;
}

/**
 * Create a unique key for a keybinding (for map lookup).
 */
function createBindingKey(binding: Keybinding): string {
	const parts: string[] = [];

	if (binding.withCtrl) {
		parts.push('Ctrl');
	}
	if (binding.withShift) {
		parts.push('Shift');
	}
	parts.push(binding.key);

	return parts.join('+');
}

/**
 * Create a binding key from a keyboard event.
 */
export function eventToBindingKey(event: KeyboardEvent): string {
	const parts: string[] = [];

	if (event.ctrlKey) {
		parts.push('Ctrl');
	}
	if (event.shiftKey && event.key.length === 1 && event.key !== event.key.toUpperCase()) {
		// Only include Shift for non-character keys
		parts.push('Shift');
	}

	// Use the actual key value (handles shifted characters like %, ", etc.)
	parts.push(event.key);

	return parts.join('+');
}

/**
 * The keybinding map: binding key → Keybinding.
 */
export const KEYBINDING_MAP = buildKeybindingMap();

/**
 * Look up a command from a keyboard event (after prefix).
 *
 * @param event - The keyboard event
 * @returns The matching keybinding or undefined
 */
export function lookupKeybinding(event: KeyboardEvent): Keybinding | undefined {
	const bindingKey = eventToBindingKey(event);

	return KEYBINDING_MAP.get(bindingKey);
}

/**
 * Get the command for a keybinding.
 *
 * @param binding - The keybinding
 * @returns The TmuxCommand or undefined
 */
export function getCommandForBinding(binding: Keybinding): TmuxCommand | undefined {
	return TMUX_COMMANDS.find((cmd) => cmd.name === binding.commandName);
}

/**
 * Check if the event is the prefix key (Ctrl+b).
 *
 * @param event - The keyboard event
 * @returns true if this is the prefix key
 */
export function isPrefixKey(event: KeyboardEvent): boolean {
	return event.ctrlKey && event.key.toLowerCase() === 'b';
}

/**
 * Get all prefix-based keybindings.
 */
export function getPrefixKeybindings(): Keybinding[] {
	return Array.from(KEYBINDING_MAP.values());
}

/**
 * Check if a command uses prefix-based keybinding.
 *
 * @param commandName - The command name
 * @returns true if the command has a prefix-based shortcut
 */
export function hasPrefixKeybinding(commandName: CommandIdType): boolean {
	for (const binding of KEYBINDING_MAP.values()) {
		if (binding.commandName === commandName) {
			return true;
		}
	}

	return false;
}

/**
 * Get the keybinding(s) for a command.
 *
 * @param commandName - The command name
 * @returns Array of keybindings for this command
 */
export function getKeybindingsForCommand(commandName: CommandIdType): Keybinding[] {
	const bindings: Keybinding[] = [];

	for (const binding of KEYBINDING_MAP.values()) {
		if (binding.commandName === commandName) {
			bindings.push(binding);
		}
	}

	return bindings;
}
