import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

// The home page mounts <Terminal />, which creates a TanStack Query at init and
// would otherwise need a QueryClient in context (provided by the layout in the
// real app). Nothing exercised here touches the leaderboard query, so a
// lightweight stub keeps the tests focused on the page itself.
vi.mock('$lib/queries/leaderboard', () => ({
	createLeaderboardQuery: () => ({ isPending: false, isError: false, data: undefined }),
	getEntriesForChallenge: () => []
}));

describe('home page layout', () => {
	it('renders the terminal directly after the hero (no command-hint buttons between)', async () => {
		await render(Page);

		// The clickable command-hint row was removed to declutter the hero and
		// bring the terminal above the fold.
		expect(document.querySelector('.command-hints')).toBeNull();
		expect(document.querySelectorAll('button.hint')).toHaveLength(0);

		const hero = document.querySelector('.hero');
		const terminalSection = document.querySelector('.terminal-section');
		expect(hero).not.toBeNull();
		expect(terminalSection).not.toBeNull();

		// The terminal section immediately follows the hero in document order.
		expect(hero!.nextElementSibling).toBe(terminalSection);
		expect(terminalSection!.querySelector('.terminal-container')).not.toBeNull();
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
