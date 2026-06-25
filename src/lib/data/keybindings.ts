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
	type CopyModeAction,
	type TmuxBindingKey,
	type TmuxConfigBinding,
	type TmuxKeyTable
} from '$lib/utils/tmux-conf';
import { type CommandIdType } from '$lib/utils/tmux-commands';

export type Keybinding = TmuxConfigBinding;

const MODIFIER_ONLY_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'OS', 'Shift']);

const DEFAULT_PREFIX_KEY: TmuxBindingKey = {
	key: 'b',
	withCtrl: true,
	keyDisplay: 'Ctrl+b',
	tmuxNotation: 'C-b'
};

function createCommandBinding(
	table: TmuxKeyTable,
	key: string,
	commandName: CommandIdType,
	options: {
		eventCode?: string;
		withCtrl?: boolean;
		withShift?: boolean;
		withAltOrMeta?: boolean;
		keyDisplay?: string;
		tmuxNotation?: string;
		commandText?: string;
	} = {}
): Keybinding {
	return {
		table,
		key,
		eventCode: options.eventCode,
		withCtrl: options.withCtrl,
		withShift: options.withShift,
		withAltOrMeta: options.withAltOrMeta,
		keyDisplay: options.keyDisplay ?? key,
		tmuxNotation: options.tmuxNotation ?? key,
		kind: 'command',
		commandName,
		commandText: options.commandText,
		source: 'default'
	};
}

function createCopyModeBinding(
	table: Extract<TmuxKeyTable, 'copy-mode' | 'copy-mode-vi'>,
	key: string,
	action: CopyModeAction,
	options: {
		eventCode?: string;
		withCtrl?: boolean;
		withShift?: boolean;
		withAltOrMeta?: boolean;
		keyDisplay?: string;
		tmuxNotation?: string;
	} = {}
): Keybinding {
	return {
		table,
		key,
		eventCode: options.eventCode,
		withCtrl: options.withCtrl,
		withShift: options.withShift,
		withAltOrMeta: options.withAltOrMeta,
		keyDisplay: options.keyDisplay ?? key,
		tmuxNotation: options.tmuxNotation ?? key,
		kind: 'copy-mode-action',
		action,
		source: 'default'
	};
}

const DEFAULT_KEYBINDINGS: Keybinding[] = [
	createCommandBinding('prefix', 'd', 'detach', { commandText: 'detach' }),
	createCommandBinding('prefix', '$', 'rename-session'),
	createCommandBinding('prefix', ')', 'next-session', { commandText: 'next-session' }),
	createCommandBinding('prefix', '(', 'previous-session', { commandText: 'previous-session' }),
	createCommandBinding('prefix', 'c', 'new-window', { commandText: 'new-window' }),
	createCommandBinding('prefix', 'n', 'next-window', { commandText: 'next-window' }),
	createCommandBinding('prefix', 'p', 'previous-window', { commandText: 'previous-window' }),
	createCommandBinding('prefix', ',', 'rename-window'),
	createCommandBinding('prefix', '&', 'kill-window', { commandText: 'kill-window' }),
	createCommandBinding('prefix', 'w', 'list-windows', { commandText: 'list-windows' }),
	createCommandBinding('prefix', '"', 'split-horizontal', { commandText: 'split-window -v' }),
	createCommandBinding('prefix', '%', 'split-vertical', { commandText: 'split-window -h' }),
	createCommandBinding('prefix', 'x', 'kill-pane', { commandText: 'kill-pane' }),
	createCommandBinding('prefix', 'z', 'toggle-zoom', { commandText: 'resize-pane -Z' }),
	createCommandBinding('prefix', '{', 'swap-pane', { commandText: 'swap-pane -U' }),
	createCommandBinding('prefix', '}', 'swap-pane', { commandText: 'swap-pane -D' }),
	createCommandBinding('prefix', 'o', 'rotate-panes', {
		withCtrl: true,
		commandText: 'rotate-window',
		keyDisplay: 'o',
		tmuxNotation: 'C-o'
	}),
	createCommandBinding('prefix', 'ArrowUp', 'select-pane', {
		commandText: 'select-pane -U',
		keyDisplay: '↑',
		tmuxNotation: 'Up'
	}),
	createCommandBinding('prefix', 'ArrowDown', 'select-pane', {
		commandText: 'select-pane -D',
		keyDisplay: '↓',
		tmuxNotation: 'Down'
	}),
	createCommandBinding('prefix', 'ArrowLeft', 'select-pane', {
		commandText: 'select-pane -L',
		keyDisplay: '←',
		tmuxNotation: 'Left'
	}),
	createCommandBinding('prefix', 'ArrowRight', 'select-pane', {
		commandText: 'select-pane -R',
		keyDisplay: '→',
		tmuxNotation: 'Right'
	}),
	createCommandBinding('prefix', ';', 'last-pane', { commandText: 'last-pane' }),
	createCommandBinding('prefix', 'l', 'last-window', { commandText: 'last-window' }),
	createCommandBinding('prefix', 'q', 'display-panes'),
	createCommandBinding('prefix', '[', 'copy-mode'),
	createCommandBinding('prefix', ']', 'paste-buffer'),
	createCommandBinding('prefix', ':', 'command-prompt'),
	createCommandBinding('prefix', 't', 'show-time'),
	...Array.from({ length: 10 }, (_, index) =>
		createCommandBinding('prefix', String(index), 'select-window', {
			commandText: `select-window -t ${index}`
		})
	),

	createCopyModeBinding('copy-mode', ' ', 'begin-selection', {
		eventCode: 'Space',
		withCtrl: true,
		keyDisplay: 'Ctrl+Space',
		tmuxNotation: 'C-Space'
	}),
	createCopyModeBinding('copy-mode', 'w', 'copy-selection-and-cancel', {
		withAltOrMeta: true,
		keyDisplay: 'Alt+w',
		tmuxNotation: 'M-w'
	}),
	createCopyModeBinding('copy-mode', 'Escape', 'cancel', {
		keyDisplay: 'Escape',
		tmuxNotation: 'Escape'
	}),
	createCopyModeBinding('copy-mode', 'q', 'cancel'),
	createCopyModeBinding('copy-mode', 'Home', 'start-of-line', {
		keyDisplay: 'Home',
		tmuxNotation: 'Home'
	}),
	createCopyModeBinding('copy-mode', 'End', 'end-of-line', {
		keyDisplay: 'End',
		tmuxNotation: 'End'
	}),
	createCopyModeBinding('copy-mode', 'ArrowUp', 'cursor-up', {
		keyDisplay: '↑',
		tmuxNotation: 'Up'
	}),
	createCopyModeBinding('copy-mode', 'ArrowDown', 'cursor-down', {
		keyDisplay: '↓',
		tmuxNotation: 'Down'
	}),
	createCopyModeBinding('copy-mode', 'ArrowLeft', 'cursor-left', {
		keyDisplay: '←',
		tmuxNotation: 'Left'
	}),
	createCopyModeBinding('copy-mode', 'ArrowRight', 'cursor-right', {
		keyDisplay: '→',
		tmuxNotation: 'Right'
	}),

	createCopyModeBinding('copy-mode-vi', ' ', 'begin-selection', {
		eventCode: 'Space',
		keyDisplay: 'Space',
		tmuxNotation: 'Space'
	}),
	createCopyModeBinding('copy-mode-vi', 'Enter', 'copy-selection-and-cancel', {
		keyDisplay: 'Enter',
		tmuxNotation: 'Enter'
	}),
	createCopyModeBinding('copy-mode-vi', 'q', 'cancel'),
	createCopyModeBinding('copy-mode-vi', 'Escape', 'clear-selection', {
		keyDisplay: 'Escape',
		tmuxNotation: 'Escape'
	}),
	createCopyModeBinding('copy-mode-vi', '0', 'start-of-line'),
	createCopyModeBinding('copy-mode-vi', '$', 'end-of-line'),
	createCopyModeBinding('copy-mode-vi', 'Home', 'start-of-line', {
		keyDisplay: 'Home',
		tmuxNotation: 'Home'
	}),
	createCopyModeBinding('copy-mode-vi', 'End', 'end-of-line', {
		keyDisplay: 'End',
		tmuxNotation: 'End'
	}),
	createCopyModeBinding('copy-mode-vi', 'h', 'cursor-left'),
	createCopyModeBinding('copy-mode-vi', 'j', 'cursor-down'),
	createCopyModeBinding('copy-mode-vi', 'k', 'cursor-up'),
	createCopyModeBinding('copy-mode-vi', 'l', 'cursor-right'),
	createCopyModeBinding('copy-mode-vi', 'ArrowUp', 'cursor-up', {
		keyDisplay: '↑',
		tmuxNotation: 'Up'
	}),
	createCopyModeBinding('copy-mode-vi', 'ArrowDown', 'cursor-down', {
		keyDisplay: '↓',
		tmuxNotation: 'Down'
	}),
	createCopyModeBinding('copy-mode-vi', 'ArrowLeft', 'cursor-left', {
		keyDisplay: '←',
		tmuxNotation: 'Left'
	}),
	createCopyModeBinding('copy-mode-vi', 'ArrowRight', 'cursor-right', {
		keyDisplay: '→',
		tmuxNotation: 'Right'
	})
];

const ALT_META_CODE_KEY_MAP = new Map<string, string>([
	['Backquote', '`'],
	['Minus', '-'],
	['Equal', '='],
	['BracketLeft', '['],
	['BracketRight', ']'],
	['Backslash', '\\'],
	['Semicolon', ';'],
	['Quote', "'"],
	['Comma', ','],
	['Period', '.'],
	['Slash', '/']
]);

function normalizeEventKey(event: KeyboardEvent): string {
	if (event.code === 'Space' || event.key === ' ') {
		return 'Space';
	}

	if (event.altKey || event.metaKey) {
		const keyCodeMatch = /^Key([A-Z])$/u.exec(event.code);
		if (keyCodeMatch) {
			return keyCodeMatch[1].toLowerCase();
		}

		const digitCodeMatch = /^Digit([0-9])$/u.exec(event.code);
		if (digitCodeMatch) {
			return digitCodeMatch[1];
		}

		const mappedKey = ALT_META_CODE_KEY_MAP.get(event.code);
		if (mappedKey) {
			return mappedKey;
		}
	}

	return event.key;
}

function createEventLookupKey(table: TmuxKeyTable, event: KeyboardEvent): string {
	return [table, eventToBindingKey(event)].join('+');
}

export function eventToBindingKey(event: KeyboardEvent): string {
	const parts: string[] = [];

	if (event.ctrlKey) {
		parts.push('Ctrl');
	}
	if (event.altKey || event.metaKey) {
		parts.push('Meta');
	}
	if (event.shiftKey && event.key.length === 1 && event.key !== event.key.toUpperCase()) {
		parts.push('Shift');
	}

	parts.push(normalizeEventKey(event));

	return parts.join('+');
}

export function isModifierOnlyKey(event: KeyboardEvent): boolean {
	return MODIFIER_ONLY_KEYS.has(event.key);
}

function buildEffectiveKeybindingMap(table: TmuxKeyTable): Map<string, Keybinding> {
	const activeConfig = tmuxConfigStore.activeConfig;
	const keybindingMap = new Map<string, Keybinding>();

	for (const binding of DEFAULT_KEYBINDINGS) {
		if (binding.table === table) {
			keybindingMap.set(createBindingLookupKey(binding), binding);
		}
	}

	for (const unboundKey of activeConfig.unboundKeys) {
		if (unboundKey.table === table) {
			keybindingMap.delete(createBindingLookupKey(unboundKey));
		}
	}

	for (const binding of activeConfig.bindings) {
		if (binding.table === table) {
			keybindingMap.set(createBindingLookupKey(binding), binding);
		}
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

export function getActiveCopyModeTable(): Extract<TmuxKeyTable, 'copy-mode' | 'copy-mode-vi'> {
	return tmuxConfigStore.activeConfig.modeKeys === 'vi' ? 'copy-mode-vi' : 'copy-mode';
}

export function isPrefixKey(event: KeyboardEvent): boolean {
	const prefixKey = getCurrentPrefixKey();
	if (prefixKey.withCtrl && !event.ctrlKey) {
		return false;
	}

	return event.key.toLowerCase() === prefixKey.key.toLowerCase();
}

export function lookupKeybinding(
	event: KeyboardEvent,
	table: TmuxKeyTable = 'prefix'
): Keybinding | undefined {
	return buildEffectiveKeybindingMap(table).get(createEventLookupKey(table, event));
}

export function getPrefixKeybindings(): Keybinding[] {
	return Array.from(buildEffectiveKeybindingMap('prefix').values());
}

export function getCommandForBinding(binding: Keybinding): TmuxCommand | undefined {
	if (binding.kind !== 'command') {
		return undefined;
	}

	return TMUX_COMMANDS.find((command) => command.name === binding.commandName);
}

export function hasPrefixKeybinding(commandName: CommandIdType): boolean {
	return getPrefixKeybindings().some(
		(binding) => binding.kind === 'command' && binding.commandName === commandName
	);
}

export function getKeybindingsForCommand(commandName: CommandIdType): Keybinding[] {
	return getPrefixKeybindings().filter(
		(binding) => binding.kind === 'command' && binding.commandName === commandName
	);
}

export function getKeybindingsForCopyModeAction(
	action: CopyModeAction,
	table: Extract<TmuxKeyTable, 'copy-mode' | 'copy-mode-vi'> = getActiveCopyModeTable()
): Keybinding[] {
	return Array.from(buildEffectiveKeybindingMap(table).values()).filter(
		(binding) => binding.kind === 'copy-mode-action' && binding.action === action
	);
}

export function getCommandsWithPrefixKeybindings(): TmuxCommand[] {
	const commandNames = new Set(
		getPrefixKeybindings()
			.filter((binding) => binding.kind === 'command')
			.map((binding) => binding.commandName)
	);

	return TMUX_COMMANDS.filter((command) => commandNames.has(command.name as CommandIdType));
}

export function getFirstKeybindingForCommand(commandName: CommandIdType): Keybinding | undefined {
	return getPrefixKeybindings().find(
		(binding) => binding.kind === 'command' && binding.commandName === commandName
	);
}
