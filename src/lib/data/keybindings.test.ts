/**
 * Tests for the keybindings module.
 */

import { describe, it, expect } from 'vitest';
import {
	KEYBINDING_MAP,
	isPrefixKey,
	lookupKeybinding,
	getKeybindingsForCommand,
	hasPrefixKeybinding,
	eventToBindingKey
} from './keybindings';

/**
 * Create a mock KeyboardEvent for testing.
 */
function createKeyEvent(
	key: string,
	options: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}
): KeyboardEvent {
	return {
		key,
		ctrlKey: options.ctrlKey ?? false,
		shiftKey: options.shiftKey ?? false,
		altKey: options.altKey ?? false,
		metaKey: options.metaKey ?? false,
		preventDefault: () => {},
		stopPropagation: () => {}
	} as unknown as KeyboardEvent;
}

describe('Keybindings', () => {
	describe('KEYBINDING_MAP', () => {
		it('should contain prefix-based commands', () => {
			expect(KEYBINDING_MAP.size).toBeGreaterThan(0);
		});

		it('should have split-vertical mapped to %', () => {
			const binding = KEYBINDING_MAP.get('%');
			expect(binding).toBeDefined();
			expect(binding?.commandName).toBe('split-vertical');
		});

		it('should have split-horizontal mapped to "', () => {
			const binding = KEYBINDING_MAP.get('"');
			expect(binding).toBeDefined();
			expect(binding?.commandName).toBe('split-horizontal');
		});

		it('should have detach mapped to d', () => {
			const binding = KEYBINDING_MAP.get('d');
			expect(binding).toBeDefined();
			expect(binding?.commandName).toBe('detach');
		});

		it('should have new-window mapped to c', () => {
			const binding = KEYBINDING_MAP.get('c');
			expect(binding).toBeDefined();
			expect(binding?.commandName).toBe('new-window');
		});

		it('should have rename-window mapped to ,', () => {
			const binding = KEYBINDING_MAP.get(',');
			expect(binding).toBeDefined();
			expect(binding?.commandName).toBe('rename-window');
		});

		it('should have rename-session mapped to $', () => {
			const binding = KEYBINDING_MAP.get('$');
			expect(binding).toBeDefined();
			expect(binding?.commandName).toBe('rename-session');
		});

		it('should have select-window for digits 0-9', () => {
			for (let i = 0; i <= 9; i++) {
				const binding = KEYBINDING_MAP.get(String(i));
				expect(binding).toBeDefined();
				expect(binding?.commandName).toBe('select-window');
			}
		});

		it('should have select-pane for arrow keys', () => {
			for (const arrow of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
				const binding = KEYBINDING_MAP.get(arrow);
				expect(binding).toBeDefined();
				expect(binding?.commandName).toBe('select-pane');
			}
		});

		// NOTE: resize-pane test removed - Ctrl+Arrow conflicts with macOS Mission Control

		it('should have swap-pane for { and }', () => {
			const bindingLeft = KEYBINDING_MAP.get('{');
			const bindingRight = KEYBINDING_MAP.get('}');

			expect(bindingLeft).toBeDefined();
			expect(bindingLeft?.commandName).toBe('swap-pane');
			expect(bindingRight).toBeDefined();
			expect(bindingRight?.commandName).toBe('swap-pane');
		});

		it('should have rotate-panes for Ctrl+o', () => {
			const binding = KEYBINDING_MAP.get('Ctrl+o');
			expect(binding).toBeDefined();
			expect(binding?.commandName).toBe('rotate-panes');
			expect(binding?.withCtrl).toBe(true);
		});
	});

	describe('isPrefixKey', () => {
		it('should return true for Ctrl+b', () => {
			const event = createKeyEvent('b', { ctrlKey: true });
			expect(isPrefixKey(event)).toBe(true);
		});

		it('should return true for Ctrl+B (uppercase)', () => {
			const event = createKeyEvent('B', { ctrlKey: true });
			expect(isPrefixKey(event)).toBe(true);
		});

		it('should return false for just b', () => {
			const event = createKeyEvent('b');
			expect(isPrefixKey(event)).toBe(false);
		});

		it('should return false for Ctrl+c', () => {
			const event = createKeyEvent('c', { ctrlKey: true });
			expect(isPrefixKey(event)).toBe(false);
		});

		it('should return false for Alt+b', () => {
			const event = createKeyEvent('b', { altKey: true });
			expect(isPrefixKey(event)).toBe(false);
		});
	});

	describe('eventToBindingKey', () => {
		it('should return simple key for letter', () => {
			const event = createKeyEvent('c');
			expect(eventToBindingKey(event)).toBe('c');
		});

		it('should return key for special character', () => {
			const event = createKeyEvent('%');
			expect(eventToBindingKey(event)).toBe('%');
		});

		it('should include Ctrl prefix', () => {
			const event = createKeyEvent('o', { ctrlKey: true });
			expect(eventToBindingKey(event)).toBe('Ctrl+o');
		});

		it('should return arrow key', () => {
			const event = createKeyEvent('ArrowUp');
			expect(eventToBindingKey(event)).toBe('ArrowUp');
		});

		it('should return Ctrl+Arrow', () => {
			const event = createKeyEvent('ArrowLeft', { ctrlKey: true });
			expect(eventToBindingKey(event)).toBe('Ctrl+ArrowLeft');
		});
	});

	describe('lookupKeybinding', () => {
		it('should find binding for % key', () => {
			const event = createKeyEvent('%');
			const binding = lookupKeybinding(event);

			expect(binding).toBeDefined();
			expect(binding?.commandName).toBe('split-vertical');
		});

		it('should find binding for c key', () => {
			const event = createKeyEvent('c');
			const binding = lookupKeybinding(event);

			expect(binding).toBeDefined();
			expect(binding?.commandName).toBe('new-window');
		});

		it('should find binding for Ctrl+o', () => {
			const event = createKeyEvent('o', { ctrlKey: true });
			const binding = lookupKeybinding(event);

			expect(binding).toBeDefined();
			expect(binding?.commandName).toBe('rotate-panes');
		});

		it('should return undefined for unknown key', () => {
			const event = createKeyEvent('`');
			const binding = lookupKeybinding(event);

			expect(binding).toBeUndefined();
		});
	});

	describe('getKeybindingsForCommand', () => {
		it('should return single binding for simple commands', () => {
			const bindings = getKeybindingsForCommand('split-vertical');

			expect(bindings.length).toBe(1);
			expect(bindings[0].key).toBe('%');
		});

		it('should return multiple bindings for select-window', () => {
			const bindings = getKeybindingsForCommand('select-window');

			expect(bindings.length).toBe(10);
		});

		it('should return multiple bindings for select-pane', () => {
			const bindings = getKeybindingsForCommand('select-pane');

			expect(bindings.length).toBe(4);
		});

		it('should return empty array for CLI commands', () => {
			const bindings = getKeybindingsForCommand('new-session');

			expect(bindings.length).toBe(0);
		});
	});

	describe('hasPrefixKeybinding', () => {
		it('should return true for prefix-based commands', () => {
			expect(hasPrefixKeybinding('split-vertical')).toBe(true);
			expect(hasPrefixKeybinding('new-window')).toBe(true);
			expect(hasPrefixKeybinding('rename-window')).toBe(true);
		});

		it('should return false for CLI commands', () => {
			expect(hasPrefixKeybinding('new-session')).toBe(false);
			expect(hasPrefixKeybinding('list-sessions')).toBe(false);
			expect(hasPrefixKeybinding('kill-session')).toBe(false);
		});
	});
});

