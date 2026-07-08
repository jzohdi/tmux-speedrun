import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

// The home page mounts <Terminal />, which creates a TanStack Query at init and
// would otherwise need a QueryClient in context (provided by the layout in the
// real app). The hint commands exercised here never touch the leaderboard
// query, so a lightweight stub keeps the test focused on the clickable hints.
vi.mock('$lib/queries/leaderboard', () => ({
	createLeaderboardQuery: () => ({ isPending: false, isError: false, data: undefined }),
	getEntriesForChallenge: () => []
}));

// The full set of hint labels shown above the terminal. Each label's command
// is the text it displays (no separate mapping), per the issue.
const HINT_COMMANDS = [
	'tsr ls',
	'tsr lb',
	'tsr start <id>',
	'tsr practice',
	'tsr config',
	'man tmux'
];

describe('home page command hints', () => {
	it('renders every hint as a keyboard-focusable button with an accessible name', async () => {
		const screen = await render(Page);

		for (const command of HINT_COMMANDS) {
			const button = screen.getByRole('button', { name: `Run command: ${command}` });
			await expect.element(button).toBeVisible();
			// Native <button> elements are focusable/activatable without manual
			// role or tabindex wiring.
			const el = (await button.element()) as HTMLElement;
			expect(el.tagName).toBe('BUTTON');
		}
	});

	it('displays all six command labels', async () => {
		const screen = await render(Page);

		for (const command of HINT_COMMANDS) {
			await expect.element(screen.getByText(command, { exact: true })).toBeVisible();
		}
	});

	it('runs the command in the terminal when a hint is clicked (tsr ls)', async () => {
		const screen = await render(Page);

		const lsHint = screen.getByRole('button', { name: 'Run command: tsr ls' });
		await userEvent.click(lsHint);

		// The command is echoed into the terminal history and executed, entering
		// interactive list mode — exactly as if the user typed `tsr ls` + Enter.
		await expect.element(screen.getByText(/^\$ tsr ls$/)).toBeVisible();
		await expect.element(screen.getByText(/Enter to start, q to quit/)).toBeVisible();
	});

	it('moves focus into the terminal after a hint is clicked', async () => {
		const screen = await render(Page);

		const lsHint = screen.getByRole('button', { name: 'Run command: tsr ls' });
		await userEvent.click(lsHint);

		// After `tsr ls` the terminal is in list mode, so focus lands on the
		// terminal container rather than staying on the clicked hint.
		const container = document.querySelector('.terminal-container');
		expect(container).not.toBeNull();
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(container);
			expect(document.activeElement).not.toBe(lsHint.element());
		});
	});

	it('opens the all-challenges leaderboard pager when the tsr lb hint is clicked', async () => {
		const screen = await render(Page);

		const lbHint = screen.getByRole('button', { name: 'Run command: tsr lb' });
		await userEvent.click(lbHint);

		// The command echoes and opens the pager-style leaderboard viewer.
		await expect
			.element(screen.getByRole('application', { name: /leaderboard viewer/i }))
			.toBeVisible();

		// Focus moves into the pager so arrow keys / q work immediately.
		const pagerEl = document.querySelector('.manpage-container');
		expect(pagerEl).not.toBeNull();
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(pagerEl);
		});
	});

	it('activates a hint from the keyboard (Enter on a focused hint runs the command)', async () => {
		const screen = await render(Page);

		const lsHint = screen.getByRole('button', { name: 'Run command: tsr ls' });
		const el = (await lsHint.element()) as HTMLButtonElement;
		el.focus();
		expect(document.activeElement).toBe(el);

		await userEvent.keyboard('{Enter}');

		await expect.element(screen.getByText(/^\$ tsr ls$/)).toBeVisible();
		await expect.element(screen.getByText(/Enter to start, q to quit/)).toBeVisible();
	});
});

describe('home page npm install callout', () => {
	const INSTALL_CMD = 'npm install -g tmux-speedrun';
	const NPM_HREF = 'https://www.npmjs.com/package/tmux-speedrun';

	afterEach(() => {
		vi.restoreAllMocks();
		// Drop the shadowing own property so the native clipboard is restored.
		delete (navigator as { clipboard?: unknown }).clipboard;
	});

	it('shows the install command and a link to the npm package', async () => {
		const screen = await render(Page);

		await expect.element(screen.getByText(INSTALL_CMD, { exact: false })).toBeVisible();

		const link = document.querySelector('.npm-cta__link');
		expect(link).not.toBeNull();
		expect(link!.getAttribute('href')).toBe(NPM_HREF);
		expect(link!.getAttribute('target')).toBe('_blank');
		expect(link!.getAttribute('rel')).toBe('noopener noreferrer');
	});

	it('copies the bare command (no "$" prompt) and confirms with a "copied" label', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText }
		});

		const screen = await render(Page);
		const copyBtn = screen.getByRole('button', { name: /copy install command/i });
		await userEvent.click(copyBtn);

		// The visible `$` is a decorative prompt — only the runnable command is copied.
		expect(writeText).toHaveBeenCalledWith(INSTALL_CMD);
		await expect.element(screen.getByText('copied', { exact: true })).toBeVisible();
	});
});
