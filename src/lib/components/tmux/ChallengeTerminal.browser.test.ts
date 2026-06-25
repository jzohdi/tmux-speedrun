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
