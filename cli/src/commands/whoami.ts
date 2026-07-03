/**
 * `tmux-speedrun whoami` — show the stored username or "anonymous"
 * (issue #35, interface §9.2).
 */

import type { Command } from './types';
import { EXIT_OK } from './types';
import { info } from '../ui/output';

export const whoamiCommand: Command = {
	async run(ctx): Promise<number> {
		if (ctx.options.json) {
			info(
				JSON.stringify(
					ctx.session
						? { username: ctx.session.username, githubId: ctx.session.githubId }
						: { username: null }
				)
			);
			return EXIT_OK;
		}
		info(ctx.session ? ctx.session.username : 'anonymous');
		return EXIT_OK;
	}
};
