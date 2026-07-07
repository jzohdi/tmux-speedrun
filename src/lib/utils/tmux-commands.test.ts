import { describe, expect, it } from 'vitest';

import {
	CommandId,
	commandOpensInputOverlay,
	commandPopulatesTerminalInput,
	executeCommand
} from './tmux-commands';

/**
 * Issue #42: non-required commands must still affect the terminal.
 *
 * `commandPopulatesTerminalInput` is the challenge route's clear/preserve gate: it must
 * return `true` only for commands whose whole effect is to populate the focused pane's text
 * input (currently just `paste-buffer`). The challenge consumer uses it to avoid wiping the
 * pasted input via `clearInput()` after a paste.
 */
describe('commandPopulatesTerminalInput', () => {
	it('returns true for paste-buffer (its effect is to populate the pane input)', () => {
		expect(commandPopulatesTerminalInput(CommandId.PASTE_BUFFER)).toBe(true);
	});

	it('returns false for a representative sample of other commands', () => {
		expect(commandPopulatesTerminalInput(CommandId.LIST_WINDOWS)).toBe(false);
		expect(commandPopulatesTerminalInput(CommandId.LIST_BUFFERS)).toBe(false);
		expect(commandPopulatesTerminalInput(CommandId.SHOW_BUFFER)).toBe(false);
		expect(commandPopulatesTerminalInput(CommandId.COPY_MODE)).toBe(false);
		expect(commandPopulatesTerminalInput(CommandId.SPLIT_VERTICAL)).toBe(false);
	});

	it('returns false for undefined (the raw command signal carries no commandName)', () => {
		expect(commandPopulatesTerminalInput(undefined)).toBe(false);
	});
});

/**
 * Issue #50: `prefix + :` (command-prompt) must open its orange input overlay in challenge
 * mode, at parity with practice mode.
 *
 * `commandOpensInputOverlay` is the challenge route's overlay gate: it must return `true` only
 * for commands whose effect is to open a component-owned input overlay (currently just
 * `command-prompt`). The challenge consumer uses it to skip BOTH `clearInput()` and `focus()`
 * so it does not dismiss the just-opened overlay or steal the cursor out of it.
 *
 * It is a deliberate sibling of `commandPopulatesTerminalInput` (paste-buffer): the two sets
 * stay disjoint — paste-buffer skips clearing but keeps focus; command-prompt skips both.
 */
describe('commandOpensInputOverlay', () => {
	it('returns true for command-prompt (its effect is to open an input overlay)', () => {
		expect(commandOpensInputOverlay(CommandId.COMMAND_PROMPT)).toBe(true);
	});

	it('returns false for a representative sample of non-overlay commands', () => {
		expect(commandOpensInputOverlay(CommandId.LIST_WINDOWS)).toBe(false);
		expect(commandOpensInputOverlay(CommandId.SPLIT_VERTICAL)).toBe(false);
		expect(commandOpensInputOverlay(CommandId.KILL_PANE)).toBe(false);
		expect(commandOpensInputOverlay(CommandId.RENAME_WINDOW)).toBe(false);
	});

	it('returns false for undefined (the raw command signal carries no commandName)', () => {
		expect(commandOpensInputOverlay(undefined)).toBe(false);
	});

	it('stays disjoint from the input-populating (paste-buffer) gate', () => {
		// paste-buffer populates the pane input but does NOT open an overlay.
		expect(commandOpensInputOverlay(CommandId.PASTE_BUFFER)).toBe(false);
		// command-prompt opens an overlay but does NOT populate the pane input.
		expect(commandPopulatesTerminalInput(CommandId.COMMAND_PROMPT)).toBe(false);
	});
});

/**
 * The command prompt resolves typed text to a canonical command id via `executeCommand`.
 * These registrations are what make `paste-buffer` / `copy-mode` reachable from the command
 * prompt regardless of the current challenge step.
 */
describe('command registry resolves the newly supported command-prompt commands', () => {
	const paneId = 'pane-1';

	it('resolves paste-buffer typed into the command prompt', () => {
		const resolved = executeCommand('paste-buffer', paneId, 'tmux');
		expect(resolved?.commandName).toBe(CommandId.PASTE_BUFFER);
	});

	it('resolves the pasteb alias', () => {
		const resolved = executeCommand('pasteb', paneId, 'tmux');
		expect(resolved?.commandName).toBe(CommandId.PASTE_BUFFER);
	});

	it('resolves paste-buffer with a named -b buffer to a paste operation', () => {
		const resolved = executeCommand('paste-buffer -b buffer0001', paneId, 'tmux');
		expect(resolved?.commandName).toBe(CommandId.PASTE_BUFFER);
		expect(resolved?.result.bufferOperation).toEqual({ type: 'paste', name: 'buffer0001' });
	});

	it('resolves copy-mode typed into the command prompt', () => {
		const resolved = executeCommand('copy-mode', paneId, 'tmux');
		expect(resolved?.commandName).toBe(CommandId.COPY_MODE);
	});

	it('resolves display-panes typed into the command prompt', () => {
		const resolved = executeCommand('display-panes', paneId, 'tmux');
		expect(resolved?.commandName).toBe(CommandId.DISPLAY_PANES);
	});

	it('resolves show-time / clock-mode typed into the command prompt', () => {
		const resolved = executeCommand('clock-mode', paneId, 'tmux');
		expect(resolved?.commandName).toBe(CommandId.SHOW_TIME);
	});
});
