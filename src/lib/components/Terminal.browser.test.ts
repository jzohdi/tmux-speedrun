import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Terminal from './Terminal.svelte';

// The home-page terminal creates a TanStack Query at init, which needs a
// QueryClient in Svelte context (provided by the layout in the real app).
// `tsr ls` / `man tmux` / `tsr start <id>` never touch the leaderboard query,
// so a lightweight stub keeps these tests focused on the new runCommand API.
vi.mock('$lib/queries/leaderboard', () => ({
	createLeaderboardQuery: () => ({ isPending: false, isError: false, data: undefined }),
	getEntriesForChallenge: () => []
}));

// The exported component method the implementation must add. Typing the
// vitest-browser-svelte `component` handle (the live instance) to it.
type TerminalApi = { runCommand: (cmd: string) => void };

describe('Terminal.runCommand (clickable command-hint support)', () => {
	it('exposes a runCommand method on the component instance', async () => {
		const screen = await render(Terminal);
		const api = screen.component as unknown as TerminalApi;

		expect(typeof api.runCommand).toBe('function');
	});

	it('runs a command through the same path as typing it and pressing Enter (tsr ls)', async () => {
		const screen = await render(Terminal);
		const api = screen.component as unknown as TerminalApi;

		api.runCommand('tsr ls');

		// The executed command is echoed into history exactly like a typed line.
		await expect.element(screen.getByText(/^\$ tsr ls$/)).toBeVisible();
		// And it enters interactive list mode (the `tsr ls` behavior).
		await expect.element(screen.getByText(/Enter to start, q to quit/)).toBeVisible();
	});

	it('moves focus into the terminal after running tsr ls (list mode → container)', async () => {
		const screen = await render(Terminal);
		const api = screen.component as unknown as TerminalApi;

		api.runCommand('tsr ls');

		// `tsr ls` leaves default mode, so focus must land on the terminal
		// container (the element focusInput() targets for non-default modes).
		const container = document.querySelector('.terminal-container');
		expect(container).not.toBeNull();
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(container);
		});
	});

	it('moves focus to the manpage viewer after running man tmux (man mode)', async () => {
		const screen = await render(Terminal);
		const api = screen.component as unknown as TerminalApi;

		api.runCommand('man tmux');

		await expect
			.element(screen.getByRole('application', { name: /manual page viewer/i }))
			.toBeVisible();
		const manpage = document.querySelector('.manpage-container');
		expect(manpage).not.toBeNull();
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(manpage);
		});
	});

	it('clears the input box after running a command', async () => {
		const screen = await render(Terminal);
		const api = screen.component as unknown as TerminalApi;
		const input = screen.getByRole('textbox');

		// Pre-fill the input the way a user mid-typing would.
		await input.fill('hello');
		await expect.element(input).toHaveValue('hello');

		// Run a non-navigating, default-mode-preserving command.
		api.runCommand('tsr start <id>');

		await expect.element(screen.getByRole('textbox')).toHaveValue('');
	});

	it('runs the literal label text for tsr start <id>, yielding the invalid-id error (no new mapping)', async () => {
		const screen = await render(Terminal);
		const api = screen.component as unknown as TerminalApi;

		// The displayed label is `tsr start <id>`; running it verbatim hits the
		// existing "invalid challenge ID" path (parseInt('<id>') is NaN). Focus
		// stays on the default-mode input.
		api.runCommand('tsr start <id>');

		await expect.element(screen.getByText(/Invalid challenge ID '<id>'/)).toBeVisible();
		const input = document.querySelector('.terminal-input');
		expect(input).not.toBeNull();
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(input);
		});
	});
});
