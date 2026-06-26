import { userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ChallengeTerminal from './ChallengeTerminal.svelte';

describe('ChallengeTerminal browser', () => {
	it('enters prefix mode from the keyboard', async () => {
		const screen = await render(ChallengeTerminal);
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		await expect.element(screen.getByText('tmux: main')).toBeVisible();
		await userEvent.click(terminal);
		await userEvent.keyboard('{Control>}b{/Control}');

		await expect.element(screen.getByText('-- PREFIX --')).toBeVisible();
	});

	it('breaks a pane into a new window with prefix + !', async () => {
		const screen = await render(ChallengeTerminal);
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		await userEvent.click(terminal);
		// Split to get two panes in the window.
		await userEvent.keyboard('{Control>}b{/Control}"');
		expect(document.querySelectorAll('.pane-container')).toHaveLength(2);

		// Break the focused pane out; the new active window shows a single pane.
		await userEvent.keyboard('{Control>}b{/Control}!');
		expect(document.querySelectorAll('.pane-container')).toHaveLength(1);
	});

	it('joins a pane from another window with join-pane -s', async () => {
		const screen = await render(ChallengeTerminal);
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		// Create a second window (now active) so there are two windows.
		await userEvent.click(terminal);
		await userEvent.keyboard('{Control>}b{/Control}c');
		expect(document.querySelectorAll('.pane-container')).toHaveLength(1);

		// Join window 0's pane into the current window; window 0 closes, this window
		// now shows two panes.
		const input = screen.getByRole('textbox');
		await userEvent.click(input);
		await userEvent.keyboard('join-pane -s 0{Enter}');

		expect(document.querySelectorAll('.pane-container')).toHaveLength(2);
	});

	it('keeps focus on the command prompt when focus() is called while it is open', async () => {
		// Regression: entering command-prompt (prefix + :) emits a command-executed
		// signal; parent pages react by calling the terminal's focus(). Before the fix
		// focus() always targeted the pane input, racing StatusBar's auto-focus and
		// intermittently leaving the cursor in the pane while the orange bar showed.
		const screen = await render(ChallengeTerminal);
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		await userEvent.click(terminal);
		await userEvent.keyboard('{Control>}b{/Control}:');

		// Orange command prompt is open.
		const statusInput = document.querySelector('.status-input') as HTMLInputElement;
		expect(statusInput).not.toBeNull();

		// Simulate the parent page focusing the terminal in response to the signal.
		// `component` is typed as the constructor by vitest-browser-svelte, but at
		// runtime it is the instance exposing the exported focus().
		const terminalApi = screen.component as unknown as { focus: () => Promise<void> };
		await terminalApi.focus();
		await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

		expect(document.activeElement).toBe(statusInput);
	});

	it('keeps focus on the kill-pane confirmation when focus() is called while it is open', async () => {
		// The y/n confirmation bar is a modal status-bar overlay just like the command
		// prompt: focus() must keep focus on it, not steal it back to the pane (where
		// the y/n keystrokes would be typed instead of confirming).
		const screen = await render(ChallengeTerminal);
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		await userEvent.click(terminal);
		await userEvent.keyboard('{Control>}b{/Control}x');

		// Orange confirmation bar is open.
		const confirmBar = document.querySelector('.status-bar.confirm-mode') as HTMLElement;
		expect(confirmBar).not.toBeNull();

		// Simulate a parent focusing the terminal while the confirmation is up.
		const terminalApi = screen.component as unknown as { focus: () => Promise<void> };
		await terminalApi.focus();
		await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

		expect(document.activeElement).toBe(confirmBar);
	});

	it('lists key bindings with prefix + ?', async () => {
		const screen = await render(ChallengeTerminal);
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		await userEvent.click(terminal);
		await userEvent.keyboard('{Control>}b{/Control}?');

		await expect.element(screen.getByText(/bind-key -T prefix c new-window/)).toBeVisible();
	});

	it('enters and exits copy mode from the keyboard', async () => {
		const screen = await render(ChallengeTerminal);
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		await userEvent.click(terminal);
		await userEvent.keyboard('{Control>}b{/Control}{[}');

		await expect.element(screen.getByText('tmux: copy mode')).toBeVisible();
		await expect.element(screen.getByText('-- COPY MODE --')).toBeVisible();

		await userEvent.keyboard('{Escape}');

		await expect.element(screen.getByText('tmux: main')).toBeVisible();
	});

	it('exits copy mode with q', async () => {
		const screen = await render(ChallengeTerminal);
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		await userEvent.click(terminal);
		await userEvent.keyboard('{Control>}b{/Control}{[}');

		await expect.element(screen.getByText('tmux: copy mode')).toBeVisible();

		await userEvent.keyboard('q');

		await expect.element(screen.getByText('tmux: main')).toBeVisible();
	});

	it('moves the copy cursor with arrow keys', async () => {
		const screen = await render(ChallengeTerminal);
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		await userEvent.click(terminal);
		await userEvent.keyboard('{Control>}b{/Control}{[}');

		expect(document.querySelector('.copy-cursor')?.textContent).toBe(' ');

		await userEvent.keyboard('{ArrowLeft}');

		expect(document.querySelector('.copy-cursor')?.textContent).toBe('%');
	});

	it('starts a selection with ctrl-space and copies it with alt-w', async () => {
		const screen = await render(ChallengeTerminal);
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		await userEvent.click(terminal);
		await userEvent.keyboard('{Control>}b{/Control}{[}');
		await userEvent.keyboard('{Control>}{Space}{/Control}');
		await userEvent.keyboard('{ArrowLeft}');

		expect(document.querySelectorAll('.copy-selected')).toHaveLength(2);

		await userEvent.keyboard('{Alt>}w{/Alt}');

		await expect.element(screen.getByText('tmux: main')).toBeVisible();
		await expect.element(screen.getByText('Copied to buffer0001')).toBeVisible();
	});

	it('lists paste buffers created in copy mode', async () => {
		const screen = await render(ChallengeTerminal);
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		// Copy something into a buffer via copy mode (creates buffer0001).
		await userEvent.click(terminal);
		await userEvent.keyboard('{Control>}b{/Control}{[}');
		await userEvent.keyboard('{Control>}{Space}{/Control}');
		await userEvent.keyboard('{ArrowLeft}');
		await userEvent.keyboard('{Alt>}w{/Alt}');
		await expect.element(screen.getByText('Copied to buffer0001')).toBeVisible();

		// List buffers from the command line; the colon distinguishes the list
		// entry ("buffer0001: ...") from the "Copied to buffer0001" message.
		const input = screen.getByRole('textbox');
		await userEvent.click(input);
		await userEvent.keyboard('list-buffers{Enter}');

		await expect.element(screen.getByText(/buffer0001:/)).toBeVisible();
	});

	it('show-buffer reports no buffers when none exist', async () => {
		const screen = await render(ChallengeTerminal);
		const input = screen.getByRole('textbox');

		await userEvent.click(input);
		await userEvent.keyboard('show-buffer{Enter}');

		await expect.element(screen.getByText('no buffers')).toBeVisible();
	});

	it('deletes a paste buffer created in copy mode', async () => {
		const screen = await render(ChallengeTerminal);
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		// Copy something into a buffer via copy mode (creates buffer0001).
		await userEvent.click(terminal);
		await userEvent.keyboard('{Control>}b{/Control}{[}');
		await userEvent.keyboard('{Control>}{Space}{/Control}');
		await userEvent.keyboard('{ArrowLeft}');
		await userEvent.keyboard('{Alt>}w{/Alt}');
		await expect.element(screen.getByText('Copied to buffer0001')).toBeVisible();

		const input = screen.getByRole('textbox');
		await userEvent.click(input);
		await userEvent.keyboard('delete-buffer{Enter}');

		await expect.element(screen.getByText('[deleted buffer buffer0001]')).toBeVisible();
	});

	it('captures the focused pane into a paste buffer', async () => {
		const screen = await render(ChallengeTerminal);
		const input = screen.getByRole('textbox');

		await userEvent.click(input);
		// Produce some pane history first, then capture it (creates buffer0001).
		await userEvent.keyboard('list-buffers{Enter}');
		await userEvent.keyboard('capture-pane{Enter}');

		await expect.element(screen.getByText('[captured pane to buffer buffer0001]')).toBeVisible();
	});

	it('copies selection when mac Option changes the key value', async () => {
		const screen = await render(ChallengeTerminal);
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		await userEvent.click(terminal);
		await userEvent.keyboard('{Control>}b{/Control}{[}');
		await userEvent.keyboard('{Control>}{Space}{/Control}');
		await userEvent.keyboard('{ArrowLeft}');

		const terminalElement = document.querySelector('[role="application"]');
		if (!(terminalElement instanceof HTMLElement)) {
			throw new Error('Expected challenge terminal application element');
		}

		terminalElement.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: '∑',
				code: 'KeyW',
				altKey: true,
				bubbles: true,
				cancelable: true
			})
		);

		await expect.element(screen.getByText('tmux: main')).toBeVisible();
		await expect.element(screen.getByText('Copied to buffer0001')).toBeVisible();
	});

	it('pastes the latest buffer at the input caret', async () => {
		const screen = await render(ChallengeTerminal);
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		await userEvent.click(terminal);
		await userEvent.keyboard('{Control>}b{/Control}{[}');
		await userEvent.keyboard('{Control>}{Space}{/Control}');
		await userEvent.keyboard('{ArrowLeft}');
		await userEvent.keyboard('{Alt>}w{/Alt}');

		await userEvent.keyboard('abc');
		await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
		await userEvent.keyboard('{Control>}b{/Control}{]}');

		await expect.element(screen.getByRole('textbox')).toHaveValue('a% bc');
	});

	it('submits the current command line from copy mode with Enter', async () => {
		const screen = await render(ChallengeTerminal);
		const input = screen.getByRole('textbox');

		await userEvent.click(input);
		await userEvent.keyboard('man tmux');
		await expect.element(input).toHaveValue('man tmux');
		await userEvent.keyboard('{Control>}b{/Control}{[}');

		await expect.element(screen.getByText('tmux: copy mode')).toBeVisible();

		await userEvent.keyboard('{Enter}');

		await expect.element(screen.getByText('man tmux')).toBeVisible();
	});

	it('switches between sessions with prefix ) and prefix (', async () => {
		const screen = await render(ChallengeTerminal);
		const input = screen.getByRole('textbox');
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		// Create two extra named sessions; each attaches on creation.
		await userEvent.click(input);
		await userEvent.keyboard('new-session -s alpha{Enter}');
		await expect.element(screen.getByText('[alpha]')).toBeVisible();

		await userEvent.keyboard('new-session -s beta{Enter}');
		await expect.element(screen.getByText('[beta]')).toBeVisible();

		// prefix + ( moves to the previous session (beta -> alpha).
		await userEvent.click(terminal);
		await userEvent.keyboard('{Control>}b{/Control}(');
		await expect.element(screen.getByText('[alpha]')).toBeVisible();

		// prefix + ) moves to the next session (alpha -> beta).
		await userEvent.keyboard('{Control>}b{/Control})');
		await expect.element(screen.getByText('[beta]')).toBeVisible();
	});

	it('kill-server destroys all sessions and drops back to the shell', async () => {
		const screen = await render(ChallengeTerminal);
		const input = screen.getByRole('textbox');

		await userEvent.click(input);
		await userEvent.keyboard('kill-server{Enter}');

		// The shell pane (post-detach) shows the kill-server confirmation.
		await expect.element(screen.getByText('[killed server]')).toBeVisible();
	});

	it('supports mouse drag selection in copy mode', async () => {
		const screen = await render(ChallengeTerminal);
		const terminal = screen.getByRole('application', {
			name: /challenge terminal/i
		});

		await userEvent.click(terminal);
		await userEvent.keyboard('{Control>}b{/Control}{[}');

		const firstCell = document.querySelector('[data-copy-row="0"] [data-copy-column="0"]');
		const secondCell = document.querySelector('[data-copy-row="0"] [data-copy-column="1"]');

		if (!(firstCell instanceof HTMLElement) || !(secondCell instanceof HTMLElement)) {
			throw new Error('Expected copy cells to be rendered');
		}

		firstCell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));
		await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
		secondCell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, button: 0, buttons: 1 }));
		await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
		secondCell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, buttons: 0 }));
		await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

		expect(document.querySelectorAll('.copy-selected')).toHaveLength(2);

		await userEvent.keyboard('{Alt>}w{/Alt}');

		await expect.element(screen.getByText('tmux: main')).toBeVisible();
	});
});
