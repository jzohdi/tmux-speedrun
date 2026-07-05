/**
 * `tmux-speedrun practice [category]` — offline practice against isolated native
 * tmux (issue #35, interface §9.2 / §5.4). No server, no crypto, no leaderboard.
 */

import type { Command } from './types';
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from './types';
import { TMUX_COMMANDS, type TmuxCommand } from '$lib/data/tmux-commands';
import { createPracticeItems } from '$lib/data/practice-flow';
import { createIsolatedTmuxServer } from '../tmux/server';
import { TmuxObserver } from '../tmux/observer';
import { PracticeController } from '../tmux/controller';
import { StatusLine } from '../ui/status-line';
import { requireInteractiveTmux } from './preflight';
import { info, success, error, bold } from '../ui/output';

const CATEGORIES: TmuxCommand['category'][] = ['session', 'window', 'pane', 'navigation', 'misc'];

export const practiceCommand: Command = {
	async run(ctx, positionals): Promise<number> {
		const category = positionals[0] as TmuxCommand['category'] | undefined;
		if (category !== undefined && !CATEGORIES.includes(category)) {
			error(`Unknown category "${category}". Choose from: ${CATEGORIES.join(', ')}.`);
			return EXIT_USAGE;
		}

		const preflight = await requireInteractiveTmux();
		if (preflight !== null) {
			error(preflight);
			return EXIT_USAGE;
		}

		const commands = category
			? TMUX_COMMANDS.filter((c) => c.category === category)
			: TMUX_COMMANDS;
		const items = createPracticeItems(commands);
		if (items.length === 0) {
			info('No practice items for that category.');
			return EXIT_OK;
		}

		info(
			bold('Practice mode') +
				` — ${items.length} drills. Press the tmux keys to complete each.` +
				' Detaching re-attaches automatically; press Ctrl-C here to quit.'
		);

		// The WHOLE drill list runs in ONE isolated server / ONE PracticeController /
		// ONE attach loop, so drills advance in place with no detach/re-attach
		// between commands (challenge parity — interface §12.1).
		const server = await createIsolatedTmuxServer({ initialSession: 'practice' });
		try {
			const observer = new TmuxObserver(server);
			const ui = new StatusLine(server);
			const controller = new PracticeController({ server, observer, items, ui, notify: info });
			const result = await controller.run();
			if (result.completed) {
				success(`\nCompleted all ${items.length} drills.`);
			} else {
				info(`\nPractice stopped before all ${items.length} drills were completed.`);
			}
			return EXIT_OK;
		} catch (err) {
			error(`Practice failed: ${(err as Error).message}`);
			return EXIT_RUNTIME;
		} finally {
			await server.teardown();
		}
	}
};
