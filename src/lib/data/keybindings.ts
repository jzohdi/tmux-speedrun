/**
 * Tmux keybinding definitions.
 *
 * Maps keyboard keys to canonical tmux command names.
 * The actual prefix key and effective bindings are user-configurable at runtime
 * through the tmux config store.
 */

import { TMUX_COMMANDS, type TmuxCommand } from './tmux-commands';
import { tmuxConfigStore } from '$lib/stores/tmux-config.svelte';
import {
	createBindingLookupKey,
	type TmuxBindingKey,
	type TmuxConfigBinding
} from '$lib/utils/tmux-conf';
import { type CommandIdType } from '$lib/utils/tmux-commands';

export type Keybinding = TmuxConfigBinding;

const DEFAULT_PREFIX_KEY: TmuxBindingKey = {
	key: 'b',
	withCtrl: true,
	keyDisplay: 'Ctrl+b',
	tmuxNotation: 'C-b'
};

function createBinding(
	key: string,
	commandName: CommandIdType,
	options: {
		withCtrl?: boolean;
		withShift?: boolean;
		keyDisplay?: string;
		tmuxNotation?: string;
		commandText?: string;
		source?: 'default' | 'config';
	} = {}
): Keybinding {
	return {
		key,
		withCtrl: options.withCtrl,
		withShift: options.withShift,
		keyDisplay: options.keyDisplay ?? key,
		tmuxNotation: options.tmuxNotation ?? key,
		commandName,
		commandText: options.commandText,
		source: options.source ?? 'default'
	};
}

function createDefaultKeybindings(): Keybinding[] {
	return [
		createBinding('d', 'detach', { commandText: 'detach' }),
		createBinding('$', 'rename-session'),
		createBinding('c', 'new-window', { commandText: 'new-window' }),
		createBinding('n', 'next-window', { commandText: 'next-window' }),
		createBinding('p', 'previous-window', { commandText: 'previous-window' }),
		createBinding(',', 'rename-window'),
		createBinding('&', 'kill-window', { commandText: 'kill-window' }),
		createBinding('w', 'list-windows', { commandText: 'list-windows' }),
		createBinding('"', 'split-horizontal', { commandText: 'split-window -v' }),
		createBinding('%', 'split-vertical', { commandText: 'split-window -h' }),
		createBinding('x', 'kill-pane', { commandText: 'kill-pane' }),
		createBinding('z', 'toggle-zoom', { commandText: 'resize-pane -Z' }),
		createBinding('{', 'swap-pane', { commandText: 'swap-pane -U' }),
		createBinding('}', 'swap-pane', { commandText: 'swap-pane -D' }),
		createBinding('o', 'rotate-panes', {
			withCtrl: true,
			commandText: 'rotate-window',
			keyDisplay: 'o',
			tmuxNotation: 'C-o'
		}),
		createBinding('ArrowUp', 'select-pane', {
			commandText: 'select-pane -U',
			keyDisplay: '↑',
			tmuxNotation: 'Up'
		}),
		createBinding('ArrowDown', 'select-pane', {
			commandText: 'select-pane -D',
			keyDisplay: '↓',
			tmuxNotation: 'Down'
		}),
		createBinding('ArrowLeft', 'select-pane', {
			commandText: 'select-pane -L',
			keyDisplay: '←',
			tmuxNotation: 'Left'
		}),
		createBinding('ArrowRight', 'select-pane', {
			commandText: 'select-pane -R',
			keyDisplay: '→',
			tmuxNotation: 'Right'
		}),
		createBinding(';', 'last-pane', { commandText: 'last-pane' }),
		createBinding('l', 'last-window', { commandText: 'last-window' }),
		createBinding('q', 'display-panes'),
		createBinding('[', 'copy-mode'),
		createBinding(']', 'paste-buffer'),
		createBinding(':', 'command-prompt'),
		createBinding('t', 'show-time'),
		...Array.from({ length: 10 }, (_, index) =>
			createBinding(String(index), 'select-window', {
				commandText: `select-window -t ${index}`
			})
		)
	];
}

const DEFAULT_KEYBINDINGS = createDefaultKeybindings();

export function eventToBindingKey(event: KeyboardEvent): string {
	const parts: string[] = [];

	if (event.ctrlKey) {
		parts.push('Ctrl');
	}
	if (event.shiftKey && event.key.length === 1 && event.key !== event.key.toUpperCase()) {
		parts.push('Shift');
	}

	parts.push(event.key);

	return parts.join('+');
}

function buildEffectiveKeybindingMap(): Map<string, Keybinding> {
	const activeConfig = tmuxConfigStore.activeConfig;
	const keybindingMap = new Map<string, Keybinding>();

	for (const binding of DEFAULT_KEYBINDINGS) {
		keybindingMap.set(createBindingLookupKey(binding), binding);
	}

	for (const unboundKey of activeConfig.unboundKeys) {
		keybindingMap.delete(createBindingLookupKey(unboundKey));
	}

	for (const binding of activeConfig.bindings) {
		keybindingMap.set(createBindingLookupKey(binding), binding);
	}

	return keybindingMap;
}

export function getDefaultPrefixKey(): TmuxBindingKey {
	return DEFAULT_PREFIX_KEY;
}

export function getCurrentPrefixKey(): TmuxBindingKey {
	return tmuxConfigStore.activeConfig.prefixKey ?? DEFAULT_PREFIX_KEY;
}

export function getPrefixKeyDisplay(): string {
	return getCurrentPrefixKey().keyDisplay;
}

export function isPrefixKey(event: KeyboardEvent): boolean {
	const prefixKey = getCurrentPrefixKey();
	if (prefixKey.withCtrl && !event.ctrlKey) {
		return false;
	}

	return event.key.toLowerCase() === prefixKey.key.toLowerCase();
}

export function lookupKeybinding(event: KeyboardEvent): Keybinding | undefined {
	const bindingKey = eventToBindingKey(event);

	return buildEffectiveKeybindingMap().get(bindingKey);
}

export function getPrefixKeybindings(): Keybinding[] {
	return Array.from(buildEffectiveKeybindingMap().values());
}

export function getCommandForBinding(binding: Keybinding): TmuxCommand | undefined {
	return TMUX_COMMANDS.find((command) => command.name === binding.commandName);
}

export function hasPrefixKeybinding(commandName: CommandIdType): boolean {
	return getPrefixKeybindings().some((binding) => binding.commandName === commandName);
}

export function getKeybindingsForCommand(commandName: CommandIdType): Keybinding[] {
	return getPrefixKeybindings().filter((binding) => binding.commandName === commandName);
}

export function getCommandsWithPrefixKeybindings(): TmuxCommand[] {
	const commandNames = new Set(getPrefixKeybindings().map((binding) => binding.commandName));

	return TMUX_COMMANDS.filter((command) => commandNames.has(command.name as CommandIdType));
}

export function getFirstKeybindingForCommand(commandName: CommandIdType): Keybinding | undefined {
	return getPrefixKeybindings().find((binding) => binding.commandName === commandName);
}
