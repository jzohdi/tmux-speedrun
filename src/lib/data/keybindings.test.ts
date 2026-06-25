import { beforeEach, describe, expect, it } from 'vitest';
import { tmuxConfigStore } from '$lib/stores/tmux-config.svelte';
import {
	isPrefixKey,
	isModifierOnlyKey,
	lookupKeybinding,
	getKeybindingsForCommand,
	getKeybindingsForCopyModeAction,
	hasPrefixKeybinding,
	eventToBindingKey,
	getPrefixKeybindings,
	getPrefixKeyDisplay,
	type Keybinding
} from './keybindings';

/**
 * Read the command name from a binding, narrowing the discriminated union.
 * Returns undefined for non-command bindings (e.g. copy-mode actions).
 */
function commandNameOf(binding: Keybinding | undefined): string | undefined {
	return binding?.kind === 'command' ? binding.commandName : undefined;
}

/**
 * Create a mock KeyboardEvent for testing.
 */
function createKeyEvent(
	key: string,
	options: {
		code?: string;
		ctrlKey?: boolean;
		shiftKey?: boolean;
		altKey?: boolean;
		metaKey?: boolean;
	} = {}
): KeyboardEvent {
	return {
		key,
		code: options.code ?? key,
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
			expect(commandNameOf(binding)).toBe('split-vertical');
		});

		it('maps rotate-panes to Ctrl+o by default', () => {
			const binding = lookupKeybinding(createKeyEvent('o', { ctrlKey: true }));
			expect(commandNameOf(binding)).toBe('rotate-panes');
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

		it('normalizes Alt and Meta bindings to Meta', () => {
			expect(eventToBindingKey(createKeyEvent('w', { altKey: true }))).toBe('Meta+w');
			expect(eventToBindingKey(createKeyEvent('w', { metaKey: true }))).toBe('Meta+w');
		});

		it('uses the physical key for mac Option-modified letters', () => {
			const event = createKeyEvent('∑', { code: 'KeyW', altKey: true });
			expect(eventToBindingKey(event)).toBe('Meta+w');
		});

		it('normalizes Space using the event code', () => {
			const event = createKeyEvent(' ', { code: 'Space', ctrlKey: true });
			expect(eventToBindingKey(event)).toBe('Ctrl+Space');
		});
	});

	describe('isModifierOnlyKey', () => {
		it('should return true for modifier-only keys', () => {
			expect(isModifierOnlyKey(createKeyEvent('Shift'))).toBe(true);
			expect(isModifierOnlyKey(createKeyEvent('Control'))).toBe(true);
			expect(isModifierOnlyKey(createKeyEvent('Alt'))).toBe(true);
			expect(isModifierOnlyKey(createKeyEvent('Meta'))).toBe(true);
		});

		it('should return false for command keys', () => {
			expect(isModifierOnlyKey(createKeyEvent('%'))).toBe(false);
			expect(isModifierOnlyKey(createKeyEvent('o', { ctrlKey: true }))).toBe(false);
			expect(isModifierOnlyKey(createKeyEvent('ArrowUp'))).toBe(false);
		});
	});

	describe('lookupKeybinding', () => {
		it('should find binding for % key', () => {
			const event = createKeyEvent('%');
			const binding = lookupKeybinding(event);

			expect(binding).toBeDefined();
			expect(commandNameOf(binding)).toBe('split-vertical');
		});

		it('should find binding for c key', () => {
			const event = createKeyEvent('c');
			const binding = lookupKeybinding(event);

			expect(binding).toBeDefined();
			expect(commandNameOf(binding)).toBe('new-window');
		});

		it('maps p to previous-window and l to last-window', () => {
			expect(commandNameOf(lookupKeybinding(createKeyEvent('p')))).toBe('previous-window');
			expect(commandNameOf(lookupKeybinding(createKeyEvent('l')))).toBe('last-window');
		});

		it('should find binding for Ctrl+o', () => {
			const event = createKeyEvent('o', { ctrlKey: true });
			const binding = lookupKeybinding(event);

			expect(binding).toBeDefined();
			expect(commandNameOf(binding)).toBe('rotate-panes');
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
			expect(commandNameOf(lookupKeybinding(createKeyEvent('y')))).toBe('kill-session');
		});

		it('looks up default emacs copy-mode bindings', () => {
			expect(
				lookupKeybinding(createKeyEvent(' ', { code: 'Space', ctrlKey: true }), 'copy-mode')?.kind
			).toBe('copy-mode-action');
			expect(lookupKeybinding(createKeyEvent('w', { altKey: true }), 'copy-mode')).toMatchObject({
				kind: 'copy-mode-action',
				action: 'copy-selection-and-cancel'
			});
		});

		it('looks up copy-mode Alt bindings when mac Option changes the key value', () => {
			expect(
				lookupKeybinding(createKeyEvent('∑', { code: 'KeyW', altKey: true }), 'copy-mode')
			).toMatchObject({
				kind: 'copy-mode-action',
				action: 'copy-selection-and-cancel'
			});
		});

		it('looks up vi copy-mode bindings after applying mode-keys vi', () => {
			tmuxConfigStore.setFileText('set -g mode-keys vi');
			tmuxConfigStore.applySavedConfig();

			expect(
				lookupKeybinding(createKeyEvent(' ', { code: 'Space' }), 'copy-mode-vi')
			).toMatchObject({
				kind: 'copy-mode-action',
				action: 'begin-selection'
			});
			expect(lookupKeybinding(createKeyEvent('Enter'), 'copy-mode-vi')).toMatchObject({
				kind: 'copy-mode-action',
				action: 'copy-selection-and-cancel'
			});
		});

		it('applies config overrides inside copy-mode tables', () => {
			tmuxConfigStore.setFileText(
				`
set -g mode-keys vi
unbind-key -T copy-mode-vi Space
bind-key -T copy-mode-vi y send -X copy-pipe-and-cancel
			`.trim()
			);
			tmuxConfigStore.applySavedConfig();

			expect(
				lookupKeybinding(createKeyEvent(' ', { code: 'Space' }), 'copy-mode-vi')
			).toBeUndefined();
			expect(lookupKeybinding(createKeyEvent('y'), 'copy-mode-vi')).toMatchObject({
				kind: 'copy-mode-action',
				action: 'copy-selection-and-cancel'
			});
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

	describe('getKeybindingsForCopyModeAction', () => {
		it('returns active copy-mode bindings for default mode-keys', () => {
			expect(getKeybindingsForCopyModeAction('begin-selection')).toContainEqual(
				expect.objectContaining({
					kind: 'copy-mode-action',
					action: 'begin-selection'
				})
			);
		});

		it('returns vi-table bindings when mode-keys is vi', () => {
			tmuxConfigStore.setFileText('set -g mode-keys vi');
			tmuxConfigStore.applySavedConfig();

			expect(getKeybindingsForCopyModeAction('copy-selection-and-cancel')).toContainEqual(
				expect.objectContaining({
					table: 'copy-mode-vi',
					kind: 'copy-mode-action',
					action: 'copy-selection-and-cancel'
				})
			);
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
