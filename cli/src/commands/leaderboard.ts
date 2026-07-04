/**
 * `tmux-speedrun leaderboard [id]` — GET /api/leaderboard and render
 * (issue #35, interface §9.2). `--json` prints the raw response.
 */

import type { Command } from './types';
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from './types';
import {
	renderLeaderboardTable,
	renderLeaderboardJson,
	type LeaderboardResponse
} from '../ui/leaderboard-table';
import { info, error } from '../ui/output';

export const leaderboardCommand: Command = {
	async run(ctx, positionals): Promise<number> {
		let data: LeaderboardResponse;
		try {
			data = await ctx.api.getJson<LeaderboardResponse>('/api/leaderboard');
		} catch (err) {
			error(`Failed to load leaderboard: ${(err as Error).message}`);
			return EXIT_RUNTIME;
		}

		const id = positionals[0];
		if (id !== undefined) {
			if (!/^\d+$/.test(id) || !(id in data)) {
				error(`No leaderboard for challenge "${id}".`);
				return EXIT_USAGE;
			}
			data = { [id]: data[id] };
		}

		info(ctx.options.json ? renderLeaderboardJson(data) : renderLeaderboardTable(data));
		return EXIT_OK;
	}
};
