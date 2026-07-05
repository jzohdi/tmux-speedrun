/**
 * `tmux-speedrun challenge <id>` — run challenge 0–5 against isolated native
 * tmux (issue #35, interface §9.2 / §6).
 */

import type { Command } from './types';
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from './types';
import { CliChallengeSession } from '../api/challenge-session';
import { createIsolatedTmuxServer } from '../tmux/server';
import { TmuxObserver } from '../tmux/observer';
import { ChallengeController } from '../tmux/controller';
import { StatusLine } from '../ui/status-line';
import { requireInteractiveTmux } from './preflight';
import { confirm } from '../ui/prompts';
import { info, success, error, bold } from '../ui/output';
import { formatDuration } from '$lib/client/challenge-core';

function isValidChallengeId(id: number): boolean {
	return Number.isInteger(id) && id >= 0 && id <= 5;
}

export const challengeCommand: Command = {
	async run(ctx, positionals): Promise<number> {
		const raw = positionals[0];
		const id = Number(raw);
		if (raw === undefined || !/^\d+$/.test(raw) || !isValidChallengeId(id)) {
			error('Usage: tmux-speedrun challenge <id>  (id is 0–5)');
			return EXIT_USAGE;
		}

		const preflight = await requireInteractiveTmux();
		if (preflight !== null) {
			error(preflight);
			return EXIT_USAGE;
		}

		// Seed the session token so finish/record resolve the verified identity.
		if (ctx.session) ctx.api.setSessionToken(ctx.session.token);

		let session: CliChallengeSession;
		try {
			session = await CliChallengeSession.start(ctx.api, id);
		} catch (err) {
			error(`Failed to start challenge: ${(err as Error).message}`);
			return EXIT_RUNTIME;
		}

		info(
			bold(`Challenge ${id}`) +
				` — ${session.totalSteps()} steps. Drive your tmux to solve each one.` +
				' Steps that detach or kill tmux re-attach automatically; press Ctrl-C here to quit.'
		);

		const server = await createIsolatedTmuxServer({ initialSession: 'challenge' });
		try {
			const observer = new TmuxObserver(server);
			const ui = new StatusLine(server);
			const controller = new ChallengeController({ server, observer, session, ui, notify: info });
			const result = await controller.run();

			if (!result.completed || !result.finish) {
				info('Challenge aborted before completion.');
				return EXIT_OK;
			}

			const finish = result.finish;
			info(`Completed in ${bold(formatDuration(finish.durationMs))}.`);

			if (finish.recorded) {
				success(
					`Recorded to the leaderboard as ${finish.username ?? 'Anonymous'}` +
						(finish.leaderboardPosition ? ` (rank #${finish.leaderboardPosition}).` : '.')
				);
				return EXIT_OK;
			}

			// Anonymous finish (deferred) — offer to save.
			info(
				finish.leaderboardPosition
					? `That would place you around rank #${finish.leaderboardPosition}.`
					: 'Your time is not saved yet.'
			);
			if (ctx.session) {
				const rec = await session.record();
				success(`Saved as ${rec.username ?? 'Anonymous'}.`);
			} else if (await confirm('Save your time as Anonymous?')) {
				const rec = await session.record();
				success(
					`Saved as ${rec.username ?? 'Anonymous'}. Run "tmux-speedrun login" to claim it next time.`
				);
			} else {
				info('Not saved. Sign in with "tmux-speedrun login" to record verified times.');
			}
			return EXIT_OK;
		} catch (err) {
			error(`Challenge failed: ${(err as Error).message}`);
			return EXIT_RUNTIME;
		} finally {
			await server.teardown();
		}
	}
};
