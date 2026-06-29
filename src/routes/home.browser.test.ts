import { userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

vi.mock('$lib/queries/leaderboard', () => ({
	createLeaderboardQuery: () => ({ isPending: false, isError: false, data: null }),
	getEntriesForChallenge: () => []
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

vi.mock('$lib/data/challenges', () => ({
	getAllChallengeMetadata: () => [
		{ index: 0, difficultyLabel: 'Easy', instructionCount: 3 }
	],
	getChallengePoolCount: () => 1,
	isValidChallengeId: (id: number) => id === 0
}));

describe('Home page — clickable hint labels', () => {
	it('renders each hint as a <button> element, not a <div>', async () => {
		await render(Page);

		// Before implementation these are <div class="hint">, so querySelectorAll returns 0.
		// After implementation they must all be <button class="hint">.
		const hintButtons = document.querySelectorAll('button.hint');
		expect(hintButtons).toHaveLength(5);
	});

	it('hint buttons are keyboard-reachable via role="button"', async () => {
		const screen = await render(Page);

		// getByRole('button') finds <button> elements; <div> elements fail this query.
		await expect.element(screen.getByRole('button', { name: /tsr ls/i })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: /tsr start/i })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: /tsr practice/i })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: /tsr config/i })).toBeVisible();
		await expect.element(screen.getByRole('button', { name: /man tmux/i })).toBeVisible();
	});

	it('clicking the "tsr ls" hint triggers the command and shows the challenge list in the terminal', async () => {
		const screen = await render(Page);

		await userEvent.click(screen.getByRole('button', { name: /tsr ls/i }));

		await expect.element(screen.getByText(/Enter to start, q to quit/)).toBeVisible();
	});

	it('clicking the "tsr start <id>" hint populates the terminal input with the command prefix', async () => {
		const screen = await render(Page);

		await userEvent.click(screen.getByRole('button', { name: /tsr start/i }));

		await expect.element(screen.getByRole('textbox')).toHaveValue('tsr start ');
	});
});
