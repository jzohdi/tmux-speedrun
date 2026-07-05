import { userEvent } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Terminal from './Terminal.svelte';
import { getAllChallengeMetadata, getChallengePoolCount } from '$lib/data/challenges';
import type { LeaderboardEntry, LeaderboardResponse } from '$lib/queries/leaderboard';

// The terminal (and the new all-challenges pager) read leaderboard data through
// a TanStack Query, which needs a QueryClient in Svelte context in the real app.
// These tests stub the query module with a mutable state holder so each test can
// choose the query state (data / pending / error) before rendering, while
// `getEntriesForChallenge` keeps the real pass-through semantics (missing
// challenge keys resolve to an empty list).
const leaderboardMock = vi.hoisted(() => ({
	state: {
		isPending: false,
		isError: false,
		data: undefined as Record<string, unknown> | undefined
	}
}));

vi.mock('$lib/queries/leaderboard', () => ({
	createLeaderboardQuery: () => leaderboardMock.state,
	getEntriesForChallenge: (data: Record<string, unknown[]> | undefined, id: number | string) =>
		data?.[String(id)] ?? []
}));

type TerminalApi = { runCommand: (cmd: string) => void };

async function renderTerminal() {
	return render(Terminal);
}
type TerminalScreen = Awaited<ReturnType<typeof renderTerminal>>;

function entry(rank: number, username: string, time: string): LeaderboardEntry {
	return { rank, username, time, durationMs: rank * 61_000, verified: rank % 2 === 1 };
}

/**
 * Deliberately sparse: only challenges 0 and 2 have entries, so the pager must
 * still render a section for every challenge (missing keys => empty state).
 */
function seededData(): LeaderboardResponse {
	return {
		'0': [
			entry(1, 'alice', '0:42.1'),
			entry(2, 'bob', '0:55.0'),
			...Array.from({ length: 8 }, (_, i) => entry(i + 3, `runner${i + 3}`, `1:0${i}.0`))
		],
		'2': [entry(1, 'carol', '1:07.3')]
	};
}

/** Ten entries for every challenge — guarantees the pager content overflows and scrolls. */
function fullData(): LeaderboardResponse {
	const data: LeaderboardResponse = {};
	for (const meta of getAllChallengeMetadata()) {
		data[String(meta.index)] = Array.from({ length: 10 }, (_, i) =>
			entry(i + 1, `player${meta.index}x${i + 1}`, `1:1${i}.0`)
		);
	}
	return data;
}

function setQueryState(state: {
	isPending: boolean;
	isError: boolean;
	data: LeaderboardResponse | undefined;
}) {
	leaderboardMock.state = state;
}

beforeEach(() => {
	setQueryState({ isPending: false, isError: false, data: seededData() });
});

/** Type a command at the prompt and press Enter — the real user input path. */
async function typeCommand(screen: TerminalScreen, cmd: string) {
	const input = screen.getByRole('textbox');
	await input.fill(cmd);
	await userEvent.keyboard('{Enter}');
}

function pagerLocator(screen: TerminalScreen) {
	return screen.getByRole('application', { name: /leaderboard viewer/i });
}

/** Whitespace-normalized text of the pager container (markup-agnostic assertions). */
function pagerText(): string {
	const el = document.querySelector('.manpage-container');
	return (el?.textContent ?? '').replace(/\s+/g, ' ');
}

/** Wait for the pager's focus-on-mount, so keystrokes reach its key handler. */
async function waitForPagerFocus(): Promise<HTMLElement> {
	const pagerEl = document.querySelector('.manpage-container');
	expect(pagerEl).not.toBeNull();
	await vi.waitFor(() => {
		expect(document.activeElement).toBe(pagerEl);
	});
	return pagerEl as HTMLElement;
}

async function expectBackAtPrompt(screen: TerminalScreen) {
	await expect.element(screen.getByRole('textbox')).toBeVisible();
	expect(pagerLocator(screen).query()).toBeNull();
	const input = document.querySelector('.terminal-input');
	expect(input).not.toBeNull();
	await vi.waitFor(() => {
		expect(document.activeElement).toBe(input);
	});
}

describe('tsr lb (all-challenges leaderboard pager)', () => {
	it('opens a pager-style leaderboard viewer instead of the old usage error', async () => {
		const screen = await renderTerminal();

		await typeCommand(screen, 'tsr lb');

		await expect.element(pagerLocator(screen)).toBeVisible();
		// The old bare-command behavior must be gone.
		expect(screen.getByText(/Usage: tsr lb/).query()).toBeNull();
	});

	it('shows the tip line pointing at the single-challenge form', async () => {
		const screen = await renderTerminal();
		const api = screen.component as unknown as TerminalApi;

		api.runCommand('tsr lb');

		await expect.element(pagerLocator(screen)).toBeVisible();
		expect(pagerText()).toContain(
			"Tip: run 'tsr lb <challenge-number>' to view a single challenge's leaderboard."
		);
	});

	it('renders a man-style header and a section for every challenge, even ones missing from the response', async () => {
		const screen = await renderTerminal();
		const api = screen.component as unknown as TerminalApi;

		api.runCommand('tsr lb');

		await expect.element(pagerLocator(screen)).toBeVisible();
		const text = pagerText();
		expect(text).toContain('LEADERBOARD(1)');
		expect(text).toContain('tmux-speedrun Leaderboards');
		for (const meta of getAllChallengeMetadata()) {
			expect(text).toContain(`CHALLENGE ${meta.index} — ${meta.difficultyLabel}`);
		}
		// Challenges 1, 3, 4, 5 have no key in the seeded response.
		const emptyLines =
			text.split('No entries yet. Be the first to complete this challenge!').length - 1;
		expect(emptyLines).toBe(getChallengePoolCount() - 2);
	});

	it('renders entries with rank, username, and time under RANK/USERNAME/TIME columns', async () => {
		const screen = await renderTerminal();
		const api = screen.component as unknown as TerminalApi;

		api.runCommand('tsr lb');

		await expect.element(pagerLocator(screen)).toBeVisible();
		const text = pagerText();
		expect(text).toContain('RANK');
		expect(text).toContain('USERNAME');
		expect(text).toContain('TIME');
		// Challenge 0 entries
		expect(text).toContain('#1');
		expect(text).toContain('alice');
		expect(text).toContain('0:42.1');
		expect(text).toContain('bob');
		// Challenge 2 entry
		expect(text).toContain('carol');
		expect(text).toContain('1:07.3');
	});

	it('shows the per-challenge empty state for every challenge when there is no data at all', async () => {
		setQueryState({ isPending: false, isError: false, data: {} });
		const screen = await renderTerminal();
		const api = screen.component as unknown as TerminalApi;

		api.runCommand('tsr lb');

		await expect.element(pagerLocator(screen)).toBeVisible();
		const emptyLines =
			pagerText().split('No entries yet. Be the first to complete this challenge!').length - 1;
		expect(emptyLines).toBe(getChallengePoolCount());
	});

	it('shows a loading line while the query is pending, and q still exits', async () => {
		setQueryState({ isPending: true, isError: false, data: undefined });
		const screen = await renderTerminal();
		const api = screen.component as unknown as TerminalApi;

		api.runCommand('tsr lb');

		await expect.element(pagerLocator(screen)).toBeVisible();
		expect(pagerText()).toContain('Loading leaderboards...');

		await waitForPagerFocus();
		await userEvent.keyboard('q');
		await expectBackAtPrompt(screen);
	});

	it('shows an error line when the query fails, and Escape still exits', async () => {
		setQueryState({ isPending: false, isError: true, data: undefined });
		const screen = await renderTerminal();
		const api = screen.component as unknown as TerminalApi;

		api.runCommand('tsr lb');

		await expect.element(pagerLocator(screen)).toBeVisible();
		expect(pagerText()).toContain('Unable to load leaderboards. Try again later.');

		await waitForPagerFocus();
		await userEvent.keyboard('{Escape}');
		await expectBackAtPrompt(screen);
	});

	it('exits with q back to the prompt, restoring history and focusing the input', async () => {
		const screen = await renderTerminal();

		await typeCommand(screen, 'tsr lb');
		await expect.element(pagerLocator(screen)).toBeVisible();

		await waitForPagerFocus();
		await userEvent.keyboard('q');

		await expectBackAtPrompt(screen);
		// The echoed command stays; nothing else leaks into history.
		await expect.element(screen.getByText(/^\$ tsr lb$/)).toBeVisible();
		// 3 boot lines + the echoed `$ tsr lb` line.
		expect(document.querySelectorAll('.terminal-line').length).toBe(4);
	});

	it('exits with Escape as well', async () => {
		const screen = await renderTerminal();

		await typeCommand(screen, 'tsr lb');
		await expect.element(pagerLocator(screen)).toBeVisible();

		await waitForPagerFocus();
		await userEvent.keyboard('{Escape}');

		await expectBackAtPrompt(screen);
	});

	it('scrolls the pager content with arrow keys', async () => {
		setQueryState({ isPending: false, isError: false, data: fullData() });
		const screen = await renderTerminal();
		const api = screen.component as unknown as TerminalApi;

		api.runCommand('tsr lb');

		await expect.element(pagerLocator(screen)).toBeVisible();
		await waitForPagerFocus();

		const content = document.querySelector('.manpage-content') as HTMLDivElement | null;
		expect(content).not.toBeNull();
		expect(content!.scrollTop).toBe(0);

		await userEvent.keyboard('{ArrowDown}');
		await vi.waitFor(() => {
			expect(content!.scrollTop).toBeGreaterThan(0);
		});

		await userEvent.keyboard('{ArrowUp}');
		await vi.waitFor(() => {
			expect(content!.scrollTop).toBe(0);
		});
	});

	it('toggles terminal maximize with Ctrl+Enter while the pager is open', async () => {
		const screen = await renderTerminal();
		const api = screen.component as unknown as TerminalApi;

		api.runCommand('tsr lb');

		await expect.element(pagerLocator(screen)).toBeVisible();
		await waitForPagerFocus();

		const container = document.querySelector('.terminal-container');
		expect(container).not.toBeNull();
		expect(container!.classList.contains('maximized')).toBe(false);

		await userEvent.keyboard('{Control>}{Enter}{/Control}');
		await vi.waitFor(() => {
			expect(container!.classList.contains('maximized')).toBe(true);
		});
		// Still in the pager, not back at the prompt.
		await expect.element(pagerLocator(screen)).toBeVisible();
	});

	it('moves focus into the pager after runCommand (clickable-hint path)', async () => {
		const screen = await renderTerminal();
		const api = screen.component as unknown as TerminalApi;

		api.runCommand('tsr lb');

		await expect.element(pagerLocator(screen)).toBeVisible();
		await waitForPagerFocus();
	});
});

describe('tsr lb <challenge-number> (single-challenge view, regression)', () => {
	it('still renders the inline single-challenge leaderboard, not the pager', async () => {
		const screen = await renderTerminal();

		await typeCommand(screen, 'tsr lb 2');

		await expect.element(screen.getByText(/LEADERBOARD: CHALLENGE 2/)).toBeVisible();
		await expect.element(screen.getByText(/Press q to return/)).toBeVisible();
		await expect.element(screen.getByText(/carol/)).toBeVisible();
		expect(pagerLocator(screen).query()).toBeNull();
	});

	it('still shows the helpful error for an out-of-range id', async () => {
		const screen = await renderTerminal();
		const api = screen.component as unknown as TerminalApi;
		const maxIndex = getChallengePoolCount() - 1;

		api.runCommand('tsr lb 99');

		await expect.element(screen.getByText(/Invalid challenge ID '99'/)).toBeVisible();
		await expect
			.element(screen.getByText(new RegExp(`available challenges \\(0-${maxIndex}\\)`)))
			.toBeVisible();
		expect(pagerLocator(screen).query()).toBeNull();
	});

	it('still shows the helpful error for a non-numeric id', async () => {
		const screen = await renderTerminal();
		const api = screen.component as unknown as TerminalApi;

		api.runCommand('tsr lb abc');

		await expect.element(screen.getByText(/Invalid challenge ID 'abc'/)).toBeVisible();
		expect(pagerLocator(screen).query()).toBeNull();
	});
});

describe('help output', () => {
	it('documents both the bare tsr lb pager and the single-challenge form', async () => {
		const screen = await renderTerminal();
		const api = screen.component as unknown as TerminalApi;

		api.runCommand('help');

		await vi.waitFor(() => {
			const text = (document.querySelector('.terminal-body')?.textContent ?? '').replace(
				/\s+/g,
				' '
			);
			expect(text).toContain('tsr lb View all leaderboards (pager)');
			expect(text).toContain('tsr lb <num> View leaderboard for a challenge');
		});
	});
});

describe('man tmux pager (shared pager-shell regression guard)', () => {
	it('still opens the manual and exits with q back to the prompt', async () => {
		const screen = await renderTerminal();
		const api = screen.component as unknown as TerminalApi;

		api.runCommand('man tmux');

		await expect
			.element(screen.getByRole('application', { name: /manual page viewer/i }))
			.toBeVisible();
		await waitForPagerFocus();
		await userEvent.keyboard('q');

		await expect.element(screen.getByRole('textbox')).toBeVisible();
		expect(screen.getByRole('application', { name: /manual page viewer/i }).query()).toBeNull();
		await expect.element(screen.getByText(/^\$ man tmux$/)).toBeVisible();
		const input = document.querySelector('.terminal-input');
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(input);
		});
	});
});
