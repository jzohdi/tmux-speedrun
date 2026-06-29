import { userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Terminal from './Terminal.svelte';

vi.mock('$lib/queries/leaderboard', () => ({
	createLeaderboardQuery: () => ({ isPending: false, isError: false, data: null }),
	getEntriesForChallenge: () => []
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

vi.mock('$lib/data/challenges', () => ({
	getAllChallengeMetadata: () => [
		{ index: 0, difficultyLabel: 'Easy', instructionCount: 3 },
		{ index: 1, difficultyLabel: 'Medium', instructionCount: 5 }
	],
	getChallengePoolCount: () => 2,
	isValidChallengeId: (id: number) => id === 0 || id === 1
}));

type TerminalApi = {
	triggerCommand: (cmd: string) => void;
};

describe('Terminal — triggerCommand', () => {
	it('exports a triggerCommand function on the component instance', async () => {
		const screen = await render(Terminal);
		const api = screen.component as unknown as TerminalApi;

		expect(typeof api.triggerCommand).toBe('function');
	});

	it('triggerCommand("tsr ls") runs the command and shows the challenge list', async () => {
		const screen = await render(Terminal);
		const api = screen.component as unknown as TerminalApi;

		api.triggerCommand('tsr ls');

		await expect.element(screen.getByText(/Enter to start, q to quit/)).toBeVisible();
	});

	it('triggerCommand with a placeholder command populates input with the prefix and does not call processCommand', async () => {
		const screen = await render(Terminal);
		const api = screen.component as unknown as TerminalApi;

		api.triggerCommand('tsr start <id>');

		const input = screen.getByRole('textbox');
		await expect.element(input).toHaveValue('tsr start ');
		// processCommand was not called — no input-type history entry should exist
		expect(document.querySelectorAll('.terminal-line.input')).toHaveLength(0);
	});

	it('triggerCommand("man tmux") switches the terminal to man page mode, removing the input line', async () => {
		const screen = await render(Terminal);
		const api = screen.component as unknown as TerminalApi;

		api.triggerCommand('man tmux');

		await new Promise<void>((r) => requestAnimationFrame(() => r()));
		expect(document.querySelector('.terminal-input')).toBeNull();
	});

	it('triggerCommand resets non-default mode before running the new command', async () => {
		const screen = await render(Terminal);
		const terminal = screen.getByRole('button', { name: /terminal emulator/i });
		const api = screen.component as unknown as TerminalApi;

		// Manually enter list mode
		await userEvent.click(terminal);
		await userEvent.keyboard('tsr ls{Enter}');
		await expect.element(screen.getByText(/Enter to start, q to quit/)).toBeVisible();
		// In list mode the text input is hidden
		expect(document.querySelector('.terminal-input')).toBeNull();

		// triggerCommand must reset list mode then re-run tsr ls
		api.triggerCommand('tsr ls');

		// Challenge list is visible again after mode reset and re-run
		await expect.element(screen.getByText(/Enter to start, q to quit/)).toBeVisible();
	});
});
