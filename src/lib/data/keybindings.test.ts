import { beforeEach, describe, expect, it } from 'vitest';
import { tmuxConfigStore } from '$lib/stores/tmux-config.svelte';
import {
	isPrefixKey,
	lookupKeybinding,
	getKeybindingsForCommand,
	hasPrefixKeybinding,
	eventToBindingKey,
	getPrefixKeybindings,
	getPrefixKeyDisplay
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
	beforeEach(() => {
		tmuxConfigStore.resetForTesting();
	});

	describe('default keybindings', () => {
		it('contains prefix-based commands', () => {
			expect(getPrefixKeybindings().length).toBeGreaterThan(0);
		});

		it('maps split-vertical to % by default', () => {
			const binding = lookupKeybinding(createKeyEvent('%'));
			expect(binding?.commandName).toBe('split-vertical');
		});

		it('maps rotate-panes to Ctrl+o by default', () => {
			const binding = lookupKeybinding(createKeyEvent('o', { ctrlKey: true }));
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

		it('uses an overridden prefix after applying tmux.conf', () => {
			tmuxConfigStore.setFileText('set -g prefix C-a');
			tmuxConfigStore.applySavedConfig();

			expect(getPrefixKeyDisplay()).toBe('Ctrl+a');
			expect(isPrefixKey(createKeyEvent('a', { ctrlKey: true }))).toBe(true);
			expect(isPrefixKey(createKeyEvent('b', { ctrlKey: true }))).toBe(false);
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

		it('maps p to previous-window and l to last-window', () => {
			expect(lookupKeybinding(createKeyEvent('p'))?.commandName).toBe('previous-window');
			expect(lookupKeybinding(createKeyEvent('l'))?.commandName).toBe('last-window');
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

		it('resolves overridden config bindings after apply', () => {
			tmuxConfigStore.setFileText('unbind-key d\nbind-key y kill-session');
			tmuxConfigStore.applySavedConfig();

			expect(lookupKeybinding(createKeyEvent('d'))).toBeUndefined();
			expect(lookupKeybinding(createKeyEvent('y'))?.commandName).toBe('kill-session');
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

		it('updates command bindings from tmux.conf', () => {
			tmuxConfigStore.setFileText('bind-key y kill-session');
			tmuxConfigStore.applySavedConfig();

			const bindings = getKeybindingsForCommand('kill-session');
			expect(bindings.some((binding) => binding.key === 'y')).toBe(true);
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
