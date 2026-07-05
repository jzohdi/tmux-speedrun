/**
 * Challenge / practice run controllers (issue #35 §8; issue #45 interface §6).
 *
 * Issue #45 decouples a run's lifecycle from any single tmux attach: the
 * shared `runAttachLoop` treats every client exit as something to CLASSIFY
 * (what did the user do?), then recovers the private server/session and
 * re-attaches. A run ends only on completion, the rapid-exit guard, or
 * process death (Ctrl-C / terminal close → server.ts signal handlers) —
 * never because a challenge step exited tmux (invariant LIFE1).
 */

import type { IsolatedTmuxServer } from './server';
import type { TmuxObserver } from './observer';
import { deriveCandidates, SERVER_DIED_EVENT } from './detector';
import type { CliChallengeSession, FinishResponse } from '../api/challenge-session';
import type { StatusLine } from '../ui/status-line';
import type { StateDelta } from '../engine/types';
import type { DecryptedStep } from '$lib/client/challenge-core';
import type { PracticeItem } from '$lib/data/practice-flow';
import { expectedSinkEventsFor, RUNNER_ATTACH_COMMAND } from './config';
import { TMUX_COMMANDS } from '$lib/data/tmux-commands';

/**
 * Practice mode guides the user through each command, so it surfaces HOW to
 * perform it: the command's `shortcut` (keystrokes / typed form) is appended to
 * the step prompt (issue #45 R3 §9.2). Challenge mode is deliberately NOT hinted
 * — it tests recall.
 */
const COMMAND_SHORTCUTS = new Map(TMUX_COMMANDS.map((c) => [c.name, c.shortcut]));

export type ChallengeRunResult = { completed: boolean; finish?: FinishResponse; aborted?: boolean };

/** One abstraction over challenge & practice step progression (interface §6.1). */
export type StepEngine = {
	isComplete(): boolean;
	/** Current step for display; index is 0-based. Only valid while !isComplete(). */
	view(): { prompt: string; index: number; total: number };
	/** The step object handed to deriveCandidates. */
	detectionStep(): DecryptedStep;
	seedInput(): string | undefined;
	/** Try to advance one step; true iff advanced. */
	trySubmit(candidates: string[], delta: StateDelta): Promise<boolean>;
};

export type RunLoopDeps = {
	server: Pick<IsolatedTmuxServer, 'attach' | 'isAlive' | 'ensureRunning' | 'liveHooks'>;
	observer: Pick<TmuxObserver, 'watch' | 'resetBaseline' | 'drainDelta' | 'exec' | 'expectEvents'>;
	ui: Pick<StatusLine, 'setPrompt' | 'clear'>;
	engine: StepEngine;
	/** One-line notices printed to the launching terminal between attaches. */
	notify?: (message: string) => void;
	/** Injectable time for tests. */
	clock?: { sleep(ms: number): Promise<void>; now(): number };
	reattachDelayMs?: number; // the Ctrl-C abort window before each re-attach
	rapidExitMs?: number; // an attach shorter than this counts toward the guard
	maxRapidExitsWithoutProgress?: number; // consecutive rapid no-progress exits before abort
	sessionName?: string; // recovery session name (default: server's initialSession)
};

export type RunLoopResult = { completed: boolean; aborted: boolean; abortReason?: string };

/**
 * The shared attach/recovery loop (interface §6.2 — the iteration order is
 * normative: classification of WHY the client exited always happens BEFORE
 * recovery, so recovery can never overwrite the evidence of what the user did).
 */
export async function runAttachLoop(deps: RunLoopDeps): Promise<RunLoopResult> {
	const { server, observer, ui, engine } = deps;
	const notify = deps.notify ?? (() => {});
	const clock = deps.clock ?? {
		sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
		now: () => Date.now()
	};
	const reattachDelayMs = deps.reattachDelayMs ?? 1000;
	const rapidExitMs = deps.rapidExitMs ?? 2000;
	const maxRapidExits = deps.maxRapidExitsWithoutProgress ?? 3;

	let firstAttach = true;
	let rapidNoProgress = 0;
	let advancedThisIteration = false;
	// Serializes submission chains: at most one runs at a time, in arrival order
	// (a dropped delta would lose its command events for good).
	let submitChain: Promise<unknown> = Promise.resolve();

	const submitDelta = (delta: StateDelta): Promise<boolean> => {
		const run = async (): Promise<boolean> => {
			if (engine.isComplete()) return false;
			const candidates = deriveCandidates(delta, engine.detectionStep());
			if (!(await engine.trySubmit(candidates, delta))) return false;
			advancedThisIteration = true;
			if (engine.isComplete()) {
				await ui.clear();
				// Accounted exec (SUP1); a "no client" error is fine — the
				// completing action may already have ended the attach.
				await observer.exec(['detach-client']);
			} else {
				await ui.setPrompt(engine.view()); // in-place replace (defect 1)
			}
			return true;
		};
		const result = submitChain.then(run, run);
		submitChain = result.catch(() => undefined);
		return result;
	};

	for (;;) {
		// 1. Done?
		if (engine.isComplete()) return { completed: true, aborted: false };

		// 2–3. Re-assert the current prompt, then re-baseline so startup/recovery
		// actions can never look like user actions.
		await ui.setPrompt(engine.view());
		await observer.resetBaseline();

		// 4. The deliberate Ctrl-C window before every RE-attach.
		if (!firstAttach) {
			notify('Re-attaching — press Ctrl-C now to quit.');
			await clock.sleep(reattachDelayMs);
		}

		// 5. Watch while attached.
		const watcher = observer.watch((delta) => submitDelta(delta), {
			getSeedInput: () => engine.seedInput()
		});

		// 6. Suppress the FIRST attach's own client events. Recovery re-attaches
		// are deliberately NOT suppressed: the runner's re-attach IS the user's
		// post-detach flow and may legitimately satisfy an attach-session step.
		if (firstAttach) {
			observer.expectEvents(expectedSinkEventsFor([RUNNER_ATTACH_COMMAND], server.liveHooks));
		}

		// 7. Attach until the client exits — for any reason.
		advancedThisIteration = false;
		const attachedAt = clock.now();
		try {
			await server.attach();
		} finally {
			watcher.stop();
		}
		firstAttach = false;

		// 8–10. Classify WHY the client exited BEFORE any recovery.
		const alive = await server.isAlive();
		const delta = await observer.drainDelta({
			extraEvents: alive ? [] : [SERVER_DIED_EVENT],
			seedInput: engine.seedInput()
		});
		await submitDelta(delta);

		// 11. Completed by the drain (or mid-attach)?
		if (engine.isComplete()) return { completed: true, aborted: false };

		// 12. Tight-loop guard: repeated instant exits with no progress abort the
		// run instead of trapping the user in an attach loop.
		if (!advancedThisIteration && clock.now() - attachedAt < rapidExitMs) {
			rapidNoProgress++;
		} else {
			rapidNoProgress = 0;
		}
		if (rapidNoProgress >= maxRapidExits) {
			return {
				completed: false,
				aborted: true,
				abortReason: `tmux exited ${rapidNoProgress} times in a row without step progress; aborting the run.`
			};
		}

		// 13. Recover AFTER classification: server back on the same socket, at
		// least one session to re-attach to.
		await server.ensureRunning({ session: deps.sessionName });
	}
}

export class ChallengeController {
	private server: IsolatedTmuxServer;
	private observer: TmuxObserver;
	private session: CliChallengeSession;
	private ui: StatusLine;
	private notify?: (message: string) => void;

	constructor(args: {
		server: IsolatedTmuxServer;
		observer: TmuxObserver;
		session: CliChallengeSession;
		ui: StatusLine;
		notify?: (message: string) => void;
	}) {
		this.server = args.server;
		this.observer = args.observer;
		this.session = args.session;
		this.ui = args.ui;
		this.notify = args.notify;
	}

	async run(): Promise<ChallengeRunResult> {
		const session = this.session;
		let step: DecryptedStep | null = session.isComplete()
			? null
			: await session.decryptCurrentStep();

		const engine: StepEngine = {
			isComplete: () => session.isComplete(),
			view: () => ({
				prompt: step?.prompt ?? '',
				index: session.currentStepIndex(),
				total: session.totalSteps()
			}),
			detectionStep: () => step ?? { prompt: '' },
			seedInput: () => step?.seedInput,
			trySubmit: async (candidates) => {
				for (const candidate of candidates) {
					if (await session.submitAnswer(candidate)) {
						step = session.isComplete() ? null : await session.decryptCurrentStep();
						return true;
					}
				}
				return false;
			}
		};

		const result = await runAttachLoop({
			server: this.server,
			observer: this.observer,
			ui: this.ui,
			engine,
			notify: this.notify
		});

		if (result.completed) {
			const finish = await session.finish();
			return { completed: true, finish };
		}
		if (result.abortReason) this.notify?.(result.abortReason);
		return { completed: false, aborted: true };
	}
}

export class PracticeController {
	private server: IsolatedTmuxServer;
	private observer: TmuxObserver;
	private items: PracticeItem[];
	private ui: StatusLine;
	private notify?: (message: string) => void;

	constructor(args: {
		server: IsolatedTmuxServer;
		observer: TmuxObserver;
		items: PracticeItem[];
		ui: StatusLine;
		notify?: (message: string) => void;
	}) {
		this.server = args.server;
		this.observer = args.observer;
		this.items = args.items;
		this.ui = args.ui;
		this.notify = args.notify;
	}

	async run(): Promise<{ completed: boolean; aborted?: boolean }> {
		// Flatten every drill into one linear (item, step) sequence tracked by a
		// single GLOBAL index, so the whole practice set runs in ONE continuous
		// attach loop — the prompt is replaced in place between drills, exactly
		// like challenge, with no detach/re-attach per command (interface §12.1).
		const flat = this.items.flatMap((item) => item.steps.map((step) => ({ item, step })));
		const total = flat.length;
		let index = 0;

		const engine: StepEngine = {
			isComplete: () => index >= total,
			view: () => {
				const { step } = flat[index];
				// Only `command` steps get a shortcut hint; `copy-mode-action` steps
				// already carry a step-by-step instruction and keep their prompt verbatim.
				const shortcut =
					step.kind === 'command' ? COMMAND_SHORTCUTS.get(step.commandName) : undefined;
				const prompt = shortcut ? `${step.prompt} — ${shortcut}` : step.prompt;
				return { prompt, index, total };
			},
			detectionStep: () => ({
				prompt: flat[index].step.prompt,
				seedInput: flat[index].item.seedInput
			}),
			seedInput: () => flat[index]?.item.seedInput,
			trySubmit: async (candidates, delta) => {
				const { step } = flat[index];
				const matched =
					step.kind === 'command'
						? candidates.includes(step.commandName)
						: // copy-mode-action steps: entering copy mode / buffer changes count.
							delta.enteredCopyMode ||
							delta.bufferAdded !== undefined ||
							delta.pasteObserved === true;
				if (!matched) return false;
				index++;
				return true;
			}
		};

		const result = await runAttachLoop({
			server: this.server,
			observer: this.observer,
			ui: this.ui,
			engine,
			notify: this.notify
		});

		if (!result.completed && result.abortReason) this.notify?.(result.abortReason);
		return { completed: result.completed, aborted: !result.completed };
	}
}
