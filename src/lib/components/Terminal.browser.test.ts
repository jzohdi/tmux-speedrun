import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
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

// Issue #51: long CLI command input must wrap onto subsequent lines within the
// terminal width instead of scrolling horizontally / getting cut off. The fix
// converts the single-line `<input type="text">` into an auto-growing, wrapping
// `<textarea>`. These tests pin the wrapping/auto-grow behavior that does not
// exist yet — they fail against the current single-line `<input>`.
describe('Terminal input wrapping (issue #51)', () => {
	// A long single-token string (no spaces) that cannot fit on one line at any
	// realistic terminal width, so it must wrap when the control supports it.
	const LONG_COMMAND = 'a'.repeat(600);

	// Reads the live rendered height of the interactive control. The control is
	// selected by `.terminal-input`; offsetHeight reflects its wrapped content.
	function inputHeight(): number {
		const el = document.querySelector<HTMLElement>('.terminal-input');
		if (!el) throw new Error('.terminal-input not found');
		return el.offsetHeight;
	}

	it('renders the interactive control as a wrapping <textarea>', async () => {
		await render(Terminal);

		const el = document.querySelector('.terminal-input');
		expect(el).not.toBeNull();
		// A single-line <input> cannot wrap; the wrapping control must be a
		// <textarea> (which still reports role="textbox" for existing tests).
		expect(el?.tagName).toBe('TEXTAREA');
	});

	it('grows in height as a long command wraps onto multiple lines', async () => {
		const screen = await render(Terminal);
		const input = screen.getByRole('textbox');

		// Baseline: the empty, single-line height.
		const baseline = inputHeight();

		// Type a long command that must wrap within the terminal width.
		await input.fill(LONG_COMMAND);
		await expect.element(input).toHaveValue(LONG_COMMAND);

		// The control must grow taller than the one-line baseline to show the
		// full wrapped command instead of clipping / scrolling horizontally.
		await vi.waitFor(() => {
			expect(inputHeight()).toBeGreaterThan(baseline);
		});
	});

	it('collapses back to the one-line baseline after the command is submitted', async () => {
		const screen = await render(Terminal);
		const api = screen.component as unknown as TerminalApi;
		const input = screen.getByRole('textbox');

		const baseline = inputHeight();

		// Fill with a wrapping command and confirm it grew.
		await input.fill(LONG_COMMAND);
		await vi.waitFor(() => {
			expect(inputHeight()).toBeGreaterThan(baseline);
		});

		// Submit via the same path as pressing Enter; stays in default mode.
		api.runCommand('tsr start <id>');

		// Value clears AND the box collapses back to the one-line baseline
		// (programmatic clears must re-run the auto-grow logic).
		await expect.element(screen.getByRole('textbox')).toHaveValue('');
		await vi.waitFor(() => {
			expect(inputHeight()).toBeLessThanOrEqual(baseline + 1);
		});
	});

	it('submits on Enter and clears the input without inserting a newline', async () => {
		const screen = await render(Terminal);
		const input = screen.getByRole('textbox');

		await input.fill('tsr start <id>');
		// Enter must submit (bubbling to the container handler) and must NOT
		// insert a literal newline into the textarea value.
		await userEvent.keyboard('{Enter}');

		// The command was processed (echoed to history) ...
		await expect.element(screen.getByText(/^\$ tsr start <id>$/)).toBeVisible();
		// ... and the input is cleared with no residual newline.
		const el = document.querySelector<HTMLTextAreaElement>('.terminal-input');
		expect(el).not.toBeNull();
		expect(el?.value).toBe('');
		expect(el?.value ?? '').not.toContain('\n');
	});
});
