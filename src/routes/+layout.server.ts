import type { LayoutServerLoad } from './$types';

/**
 * Expose the verified signed-in user to every page/component (Terminal) without
 * an extra fetch. `data.user` is `SessionUser | null`.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	return { user: locals.user };
};
