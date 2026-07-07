import { describe, expect, it } from 'vitest';

import {
	CommandId,
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
