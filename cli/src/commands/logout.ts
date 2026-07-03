/**
 * `tmux-speedrun logout` — clear the stored session + best-effort server logout
 * (issue #35, interface §9.2).
 */

import type { Command } from './types';
import { EXIT_OK } from './types';
import { clearSession } from '../auth/token-store';
import { info } from '../ui/output';

export const logoutCommand: Command = {
	async run(ctx): Promise<number> {
		if (ctx.session) {
			// Best-effort server-side logout; ignore failures (token stays client-side only).
			try {
				await ctx.api.postJson('/api/auth/logout', {});
			} catch {
				// ignore — clearing the local session is what matters
			}
		}
		clearSession();
		info('Signed out.');
		return EXIT_OK;
	}
};
