/**
 * `tmux-speedrun debug [--verbose]` — dump game/tmux diagnostics (issue #45 R3,
 * plan §9.4, interface §11.4).
 *
 * A diagnostic that reuses the isolated server/observer/detector stack so it
 * exercises exactly the code paths a stuck command flows through. Its highest
 * value is the **live-vs-dead hook partition** (`server.liveHooks` ∩ / ∖
 * `SINK_HOOKS`) — the single most useful "why isn't my command detected" signal
 * — plus a live event→candidate trace as the user presses keys.
 *
 * Scope guard: obeys ISO1 (private socket only), never contacts the API /
 * leaderboard / crypto, and always tears the server down (LIFE1).
 *
 * The pure assembly (`partitionHooks` + `formatDebugReport`) is unit-tested; the
 * attach/trace path is integration/manual.
 */

import type { Command } from './types';
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from './types';
import { createIsolatedTmuxServer } from '../tmux/server';
import { SINK_HOOKS, KEY_REBINDS, COMMAND_ALIASES, buildIsolatedConfig } from '../tmux/config';
import { TmuxObserver } from '../tmux/observer';
import { deriveCandidates } from '../tmux/detector';
import { tmuxVersion } from '../tmux/client';
import { requireInteractiveTmux } from './preflight';
import { info, error, bold, dim } from '../ui/output';

/** A hook is "live" when the running tmux accepted it; "dead" otherwise. */
export type HookPartition = { live: string[]; dead: string[] };

/**
 * Split `sinkHooks` into the ones the running tmux actually accepted (`live`,
 * ordered as in `sinkHooks`) and the ones it rejected (`dead`). Every entry
 * lands in exactly one bucket.
 */
export function partitionHooks(
	liveHooks: ReadonlySet<string>,
	sinkHooks: readonly string[]
): HookPartition {
	const live: string[] = [];
	const dead: string[] = [];
	for (const hook of sinkHooks) {
		(liveHooks.has(hook) ? live : dead).push(hook);
	}
	return { live, dead };
}

export type DebugFacts = {
	tmuxVersion: string;
	platform: string;
	socketName: string;
	confPath: string;
	eventSink: string;
	liveHooks: readonly string[];
	sinkHooks: readonly string[];
};

/**
 * Assemble the diagnostic dump (env + isolated-server locators + live/dead hook
 * partition) into a human-readable report. Pure — no tmux, no I/O.
 */
export function formatDebugReport(facts: DebugFacts): string {
	const { live, dead } = partitionHooks(new Set(facts.liveHooks), facts.sinkHooks);
	const lines = [
		bold('tmux-speedrun debug'),
		'',
		bold('Environment'),
		`  tmux version: ${facts.tmuxVersion}`,
		`  platform:     ${facts.platform}`,
		'',
		bold('Isolated server'),
		`  socket:    ${facts.socketName}`,
		`  config:    ${facts.confPath}`,
		`  eventSink: ${facts.eventSink}`,
		'',
		bold('Detection hooks (why a command may not be detected)'),
		`  live (${live.length}): ${live.join(', ') || '(none)'}`,
		`  dead (${dead.length}): ${dead.join(', ') || '(none)'}`
	];
	return lines.join('\n');
}

export const debugCommand: Command = {
	async run(_ctx, positionals): Promise<number> {
		const verbose = positionals.includes('--verbose') || positionals.includes('-v');

		let version: string;
		try {
			version = (await tmuxVersion()).raw;
		} catch {
			error('tmux was not found. Install tmux ≥ 3.0 (on Windows, use WSL) and try again.');
			return EXIT_USAGE;
		}

		const server = await createIsolatedTmuxServer({ initialSession: 'debug' });
		try {
			info(
				formatDebugReport({
					tmuxVersion: version,
					platform: process.platform,
					socketName: server.socketName,
					confPath: server.confPath,
					eventSink: server.eventSink,
					liveHooks: [...server.liveHooks],
					sinkHooks: SINK_HOOKS
				})
			);

			if (verbose) {
				info('');
				info(bold('Generated config'));
				info(dim(buildIsolatedConfig({ eventSink: server.eventSink }).text));
				info(bold('Key rebinds'));
				for (const r of KEY_REBINDS) {
					info(dim(`  ${r.key} → ${r.command}  (writes ${r.events.join(', ')})`));
				}
				info(bold('Command aliases'));
				for (const a of COMMAND_ALIASES) {
					info(dim(`  ${a.names.join(', ')} → ${a.command}  (writes ${a.events.join(', ')})`));
				}
			}

			// The live event→candidate trace needs an interactive TTY. Degrade
			// gracefully to the static dump above when there isn't one.
			const preflight = await requireInteractiveTmux();
			if (preflight !== null) {
				info('');
				info(dim(`Skipping the live event trace: ${preflight}`));
				return EXIT_OK;
			}

			info('');
			info(
				'Live trace — press keys / run tmux commands to see what the detector observes.' +
					' Detach or press Ctrl-C here to quit.'
			);

			const observer = new TmuxObserver(server);
			// A trivial always-incomplete step so deriveCandidates runs generically.
			const traceStep = { prompt: 'debug' };
			await observer.resetBaseline();
			const watcher = observer.watch((delta) => {
				const candidates = deriveCandidates(delta, traceStep);
				const events = delta.commandEvents ?? [];
				if (events.length === 0 && candidates.length === 0) return;
				info(`events: [${events.join(', ')}]  →  candidates: [${candidates.join(', ')}]`);
			});
			try {
				await server.attach();
			} finally {
				watcher.stop();
			}
			return EXIT_OK;
		} catch (err) {
			error(`debug failed: ${(err as Error).message}`);
			return EXIT_RUNTIME;
		} finally {
			await server.teardown();
		}
	}
};
