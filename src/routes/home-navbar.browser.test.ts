import { describe, expect, it, vi, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Page from './+page.svelte';

// The home page mounts <Terminal />, which creates a TanStack Query at init and
// would otherwise need a QueryClient in context (provided by the layout in the
// real app). The navbar/auth controls exercised here never touch the leaderboard
// query, so a lightweight stub keeps these tests focused on the header.
vi.mock('$lib/queries/leaderboard', () => ({
	createLeaderboardQuery: () => ({ isPending: false, isError: false, data: undefined }),
	getEntriesForChallenge: () => []
}));

// The Open Source badge must keep pointing at the repo and open in a new tab.
const OPEN_SOURCE_HREF = 'https://github.com/jzohdi/tmux-speedrun';

// The npm badge links to the published CLI package.
const NPM_HREF = 'https://www.npmjs.com/package/tmux-speedrun';

// A representative signed-in user (mirrors the server `SessionUser` shape).
const SIGNED_IN_USER = { githubId: 4242, username: 'octocat' };

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('landing page navbar — structure', () => {
	it('renders a single top navbar above the hero', async () => {
		await render(Page);

		const navbars = document.querySelectorAll('nav.navbar');
		expect(navbars).toHaveLength(1);

		const navbar = navbars[0] as HTMLElement;
		const hero = document.querySelector('.hero');
		expect(hero).not.toBeNull();

		// The navbar precedes the hero in document order (it's the header).
		expect(navbar.compareDocumentPosition(hero as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		// And the navbar is not nested inside the hero.
		expect((hero as HTMLElement).contains(navbar)).toBe(false);
	});

	it('places the Open Source badge inside the navbar (left/brand cell)', async () => {
		await render(Page);

		const navbar = document.querySelector('nav.navbar');
		expect(navbar).not.toBeNull();

		const badge = navbar!.querySelector('a.badge');
		expect(badge).not.toBeNull();
		expect(badge!.getAttribute('href')).toBe(OPEN_SOURCE_HREF);
		expect(badge!.getAttribute('target')).toBe('_blank');
		expect(badge!.getAttribute('rel')).toBe('noopener noreferrer');
		expect(badge!.textContent).toContain('Open Source');
	});

	it('adds an npm badge in the brand cell without displacing Open Source as the first badge', async () => {
		await render(Page);

		const brand = document.querySelector('nav.navbar .nav-brand');
		expect(brand).not.toBeNull();

		// Open Source stays the primary (first) brand link; npm sits beside it.
		const badges = brand!.querySelectorAll('a.badge');
		expect(badges).toHaveLength(2);
		expect(badges[0].textContent).toContain('Open Source');

		const npm = brand!.querySelector('a.badge-npm');
		expect(npm).not.toBeNull();
		expect(npm!.getAttribute('href')).toBe(NPM_HREF);
		expect(npm!.getAttribute('target')).toBe('_blank');
		expect(npm!.getAttribute('rel')).toBe('noopener noreferrer');
		expect(npm!.textContent).toContain('npm');
	});

	it('places the auth control inside the navbar via a .nav-auth cell', async () => {
		await render(Page);

		const navbar = document.querySelector('nav.navbar');
		expect(navbar).not.toBeNull();

		const authCell = navbar!.querySelector('.nav-auth');
		expect(authCell).not.toBeNull();
		// The auth button lives inside the navbar's auth cell.
		expect(authCell!.querySelector('.auth-btn')).not.toBeNull();
	});

	it('no longer stacks the badge or auth controls inside the hero content', async () => {
		await render(Page);

		const heroContent = document.querySelector('.hero-content');
		expect(heroContent).not.toBeNull();

		// The badge and the auth controls were lifted out of the hero body.
		expect(heroContent!.querySelector('.badge')).toBeNull();
		expect(heroContent!.querySelector('.auth-btn')).toBeNull();
		expect(heroContent!.querySelector('.signed-in')).toBeNull();
		// The old `.auth-bar` wrapper is gone entirely (renamed to `.nav-auth`).
		expect(document.querySelector('.auth-bar')).toBeNull();
	});
});

describe('landing page navbar — signed-out state', () => {
	it('shows the Sign in with GitHub button in the navbar and no signed-in indicator', async () => {
		const screen = await render(Page, { data: { user: null } });

		const navbar = document.querySelector('nav.navbar');
		expect(navbar).not.toBeNull();

		const signIn = navbar!.querySelector('.auth-btn.signin');
		expect(signIn).not.toBeNull();
		await expect.element(screen.getByRole('button', { name: /sign in with github/i })).toBeVisible();

		// No signed-in indicator or Sign out button while logged out.
		expect(navbar!.querySelector('.signed-in')).toBeNull();
		expect(document.querySelector('.signed-in')).toBeNull();
	});
});

describe('landing page navbar — signed-in state', () => {
	it('shows the username indicator and Sign out button in the navbar', async () => {
		const screen = await render(Page, { data: { user: SIGNED_IN_USER } });

		const navbar = document.querySelector('nav.navbar');
		expect(navbar).not.toBeNull();

		const signedIn = navbar!.querySelector('.signed-in');
		expect(signedIn).not.toBeNull();
		expect(signedIn!.textContent).toContain(`signed in as ${SIGNED_IN_USER.username}`);

		// The Sign out control is present; the Sign in control is not.
		const signOut = navbar!.querySelector('.auth-btn:not(.signin)');
		expect(signOut).not.toBeNull();
		expect(navbar!.querySelector('.auth-btn.signin')).toBeNull();
		await expect.element(screen.getByRole('button', { name: /sign out/i })).toBeVisible();
	});

	it('signs out via the logout endpoint when the navbar Sign out button is clicked', async () => {
		// Never-resolving fetch: the click handler calls fetch() synchronously
		// before awaiting, so we can assert the request without letting the
		// subsequent window.location.reload() fire.
		const fetchSpy = vi.fn(() => new Promise<Response>(() => {}));
		vi.stubGlobal('fetch', fetchSpy);

		await render(Page, { data: { user: SIGNED_IN_USER } });

		const navbar = document.querySelector('nav.navbar');
		expect(navbar).not.toBeNull();

		const signOut = navbar!.querySelector('.auth-btn:not(.signin)') as HTMLButtonElement | null;
		expect(signOut).not.toBeNull();
		signOut!.click();

		expect(fetchSpy).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
	});
});
