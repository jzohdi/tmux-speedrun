/**
 * Failing tests for the shared attach/recovery run loop (issue #45 defect 3,
 * interface §6.2): `runAttachLoop` decouples a run's lifecycle from any single
 * tmux attach. A client exit is a signal to CLASSIFY (what did the user do?),
 * then recover and re-attach — never the end of the run.
 *
 * Everything is injected as a fake (server, observer, ui, engine, clock)
 * except `deriveCandidates`: the loop is specified to classify deltas through
 * the real detector, so these tests also depend on the issue #45 event→
 * candidate table (e.g. 'client-detached' → 'detach').
 *
 * `runAttachLoop` does not exist yet — every test fails on the export check
 * until it is implemented.
 */

import { describe, expect, it } from 'vitest';
import * as controllerModule from './controller';
import type { StateDelta, TmuxState } from '../engine/types';

type RunLoopResult = { completed: boolean; aborted: boolean; abortReason?: string };

const runAttachLoop = (
	controllerModule as unknown as {
		runAttachLoop?: (deps: Record<string, unknown>) => Promise<RunLoopResult>;
	}
).runAttachLoop;

function requireLoop() {
	expect(
		runAttachLoop,
		'controller.ts must export runAttachLoop (issue #45, interface §6.2)'
	).toBeTypeOf('function');
	return runAttachLoop!;
}

const EMPTY_STATE: TmuxState = {
	sessions: [],
	windows: [],
	panes: [],
	activePaneId: null,
	activeWindow: null,
	buffers: []
};

function mkDelta(commandEvents: string[]): StateDelta {
	return {
		prev: EMPTY_STATE,
		next: EMPTY_STATE,
		paneCountDelta: 0,
		sessionCountDelta: 0,
		windowCountDelta: 0,
		addedPanes: [],
		removedPaneIds: [],
		activePaneChanged: false,
		activeWindowChanged: false,
		activeSessionChanged: false,
		zoomToggled: false,
		enteredCopyMode: false,
		bufferRemoved: false,
		commandEvents,
		movedPanes: []
	} as StateDelta;
}

/** Assert the given op-label prefixes occur in `ops` in order (gaps allowed). */
function assertOrder(ops: string[], ...prefixes: string[]) {
	let from = -1;
	for (const prefix of prefixes) {
		const at = ops.findIndex((op, i) => i > from && op.startsWith(prefix));
		expect(at, `expected "${prefix}" after index ${from} in: ${ops.join(' → ')}`).toBeGreaterThan(
			from
		);
		from = at;
	}
}

type AttachSpec = {
	/** Fake time passing during this attach (default 50ms — a "rapid" exit). */
	durationMs?: number;
	/** Watcher deltas delivered mid-attach, each as its commandEvents. */
	midAttachEvents?: string[][];
	/** isAlive() after this attach (default true). */
	aliveAfter?: boolean;
	/** User events surfaced by the post-attach drain. */
	drainEvents?: string[];
};

function makeHarness(opts: {
	/** Canonical answer per step, in order. */
	answers: string[];
	attaches: AttachSpec[];
	loopOverrides?: Record<string, unknown>;
}) {
	const ops: string[] = [];
	const notices: string[] = [];
	const promptViews: { index: number }[] = [];
	let now = 0;
	let stepIndex = 0;
	let attachCount = 0;
	let watcherCallback: ((d: StateDelta) => unknown) | null = null;

	const engine = {
		isComplete: () => stepIndex >= opts.answers.length,
		view: () => ({
			prompt: `step ${stepIndex}`,
			index: stepIndex,
			total: opts.answers.length
		}),
		detectionStep: () => ({ prompt: `step ${stepIndex}` }),
		seedInput: () => undefined,
		trySubmit: async (candidates: string[]) => {
			if (stepIndex < opts.answers.length && candidates.includes(opts.answers[stepIndex])) {
				stepIndex++;
				ops.push(`advance:${stepIndex}`);
				return true;
			}
			return false;
		}
	};

	// NOTE: no `exec` on the server fake — the loop's tmux commands (e.g. the
	// completion detach-client) must go through observer.exec, the
	// suppression-accounted path (invariant SUP1).
	const server = {
		attach: async () => {
			const spec = opts.attaches[attachCount];
			attachCount++;
			ops.push(`attach:${attachCount}`);
			if (!spec) {
				throw new Error(`unscripted attach #${attachCount} — loop iterated more than expected`);
			}
			now += spec.durationMs ?? 50;
			for (const events of spec.midAttachEvents ?? []) {
				await watcherCallback?.(mkDelta(events));
			}
			return { code: 0 };
		},
		isAlive: async () => {
			ops.push('isAlive');
			return opts.attaches[attachCount - 1]?.aliveAfter ?? true;
		},
		ensureRunning: async (o?: { session?: string }) => {
			ops.push(`ensureRunning:${o?.session ?? ''}`);
			return { restartedServer: false, createdSession: false };
		}
	};

	const observer = {
		watch: (onDelta: (d: StateDelta) => unknown) => {
			watcherCallback = onDelta;
			ops.push('watch');
			return {
				stop: () => {
					watcherCallback = null;
					ops.push('watch:stop');
				}
			};
		},
		resetBaseline: async () => {
			ops.push('resetBaseline');
		},
		drainDelta: async (o?: { extraEvents?: string[] }) => {
			const spec = opts.attaches[attachCount - 1];
			const events = [...(spec?.drainEvents ?? []), ...(o?.extraEvents ?? [])];
			ops.push(`drain:${events.join(',')}`);
			return mkDelta(events);
		},
		exec: async (args: string[]) => {
			ops.push(`exec:${args.join(' ')}`);
			return { stdout: '', stderr: '', code: 0 };
		},
		expectEvents: (events: string[]) => {
			ops.push(`expectEvents:${events.join(',')}`);
		}
	};

	const ui = {
		setPrompt: async (...args: unknown[]) => {
			const first = args[0];
			const index =
				typeof first === 'object' && first !== null
					? (first as { index: number }).index
					: (args[1] as number);
			promptViews.push({ index });
			ops.push(`setPrompt:${index}`);
		},
		clear: async () => {
			ops.push('clear');
		},
		flash: async () => {}
	};

	const deps: Record<string, unknown> = {
		server,
		observer,
		ui,
		engine,
		notify: (message: string) => {
			notices.push(message);
			ops.push('notify');
		},
		clock: {
			sleep: async (ms: number) => {
				ops.push(`sleep:${ms}`);
				now += ms;
			},
			now: () => now
		},
		reattachDelayMs: 250,
		rapidExitMs: 2000,
		maxRapidExitsWithoutProgress: 3,
		sessionName: 'speedrun',
		...(opts.loopOverrides ?? {})
	};

	return {
		deps,
		ops,
		notices,
		promptViews,
		stepIndex: () => stepIndex,
		attachCount: () => attachCount
	};
}

describe('runAttachLoop — lifecycle decoupled from any single attach (defect 3)', () => {
	it('a detach step does not end the run: the exit is classified, the step advances, the loop re-attaches', async () => {
		const loop = requireLoop();
		const h = makeHarness({
			answers: ['detach', 'new-window'],
			attaches: [
				{ drainEvents: ['client-detached'] }, // user pressed prefix+d → client exited
				{ midAttachEvents: [['after-new-window']] } // then finishes step 2 mid-attach
			]
		});
		const result = await loop(h.deps);
		expect(result).toMatchObject({ completed: true, aborted: false });
		expect(h.attachCount()).toBe(2);
		assertOrder(h.ops, 'attach:1', 'drain', 'advance:1', 'setPrompt:1', 'attach:2', 'advance:2');
		// prompt is replaced IN PLACE: step 0 before attach, step 1 on advance
		// and re-asserted before the re-attach (defect 1)
		expect(h.promptViews.map((v) => v.index)).toEqual([0, 1, 1]);
	});

	it('prints a notice and waits the Ctrl-C window before every RE-attach, never before the first', async () => {
		const loop = requireLoop();
		const h = makeHarness({
			answers: ['detach'],
			attaches: [{ drainEvents: [] }, { drainEvents: ['client-detached'] }]
		});
		const result = await loop(h.deps);
		expect(result).toMatchObject({ completed: true, aborted: false });
		expect(h.notices).toHaveLength(1);
		const firstAttachAt = h.ops.indexOf('attach:1');
		expect(h.ops.slice(0, firstAttachAt)).not.toContain('notify');
		assertOrder(h.ops, 'attach:1', 'notify', 'sleep:250', 'attach:2');
	});

	it('re-asserts the prompt and resets the observer baseline before every attach', async () => {
		const loop = requireLoop();
		const h = makeHarness({
			answers: ['detach', 'select-window'],
			attaches: [{ drainEvents: ['client-detached'] }, { drainEvents: ['after-select-window'] }]
		});
		const result = await loop(h.deps);
		expect(result).toMatchObject({ completed: true, aborted: false });
		assertOrder(
			h.ops,
			'setPrompt:0',
			'resetBaseline',
			'attach:1',
			'setPrompt:1',
			'resetBaseline',
			'attach:2'
		);
	});

	it('kill-session as the FIRST step: classified from the drain BEFORE recovery runs', async () => {
		const loop = requireLoop();
		const h = makeHarness({
			answers: ['kill-session', 'detach'],
			attaches: [
				{ drainEvents: ['after-kill-session', 'session-closed'] },
				{ drainEvents: ['client-detached'] }
			]
		});
		const result = await loop(h.deps);
		expect(result).toMatchObject({ completed: true, aborted: false });
		// recovery (ensureRunning) must come AFTER the exit was classified —
		// never overwrite the evidence of what the user did
		assertOrder(h.ops, 'attach:1', 'drain', 'advance:1', 'ensureRunning:speedrun', 'attach:2', 'advance:2');
	});

	it('a dead server is classified via SERVER_DIED_EVENT and the run continues (kill-server step)', async () => {
		const loop = requireLoop();
		const h = makeHarness({
			answers: ['kill-server', 'detach'],
			attaches: [{ aliveAfter: false }, { drainEvents: ['client-detached'] }]
		});
		const result = await loop(h.deps);
		expect(result).toMatchObject({ completed: true, aborted: false });
		// the loop injects the synthetic event into the drain (interface §6.2 step 9)
		expect(h.ops).toContain('drain:speedrun-server-died');
		assertOrder(
			h.ops,
			'attach:1',
			'isAlive',
			'drain:speedrun-server-died',
			'advance:1',
			'ensureRunning:speedrun',
			'attach:2'
		);
	});

	it('completing the final step mid-attach clears the prompt, detaches via an ACCOUNTED exec, and never re-attaches', async () => {
		const loop = requireLoop();
		const h = makeHarness({
			answers: ['new-window'],
			attaches: [{ midAttachEvents: [['after-new-window']], drainEvents: [] }]
		});
		const result = await loop(h.deps);
		expect(result).toMatchObject({ completed: true, aborted: false });
		expect(h.attachCount()).toBe(1);
		// observer.exec is the suppression-accounted path; the server fake has
		// no exec at all, so an unaccounted detach-client would throw
		assertOrder(h.ops, 'advance:1', 'clear', 'exec:detach-client');
	});

	it('suppresses the FIRST attach\'s own client-attached events, but never recovery re-attaches', async () => {
		const loop = requireLoop();
		const h = makeHarness({
			answers: ['detach', 'attach-session'],
			attaches: [
				{ drainEvents: ['client-detached'] },
				// the runner's re-attach IS the user's post-detach flow: its events
				// must NOT be suppressed so they can satisfy an attach-session step
				{ drainEvents: ['client-attached', 'after-attach-session'] }
			]
		});
		const result = await loop(h.deps);
		expect(result).toMatchObject({ completed: true, aborted: false });
		const expectCalls = h.ops.filter((op) => op.startsWith('expectEvents:'));
		expect(expectCalls).toEqual(['expectEvents:client-attached,after-attach-session']);
		assertOrder(h.ops, 'expectEvents:', 'attach:1');
	});
});

describe('runAttachLoop — rapid-exit guard (never traps the user in a dead loop)', () => {
	it('aborts after N consecutive rapid exits without progress', async () => {
		const loop = requireLoop();
		const h = makeHarness({
			answers: ['new-window'],
			attaches: [{}, {}, {}] // three rapid exits, nothing ever advances
		});
		const result = await loop(h.deps);
		expect(result.completed).toBe(false);
		expect(result.aborted).toBe(true);
		expect(result.abortReason).toBeTruthy();
		expect(h.attachCount()).toBe(3);
	});

	it('slow attaches without progress do not trip the guard', async () => {
		const loop = requireLoop();
		const h = makeHarness({
			answers: ['detach'],
			attaches: [
				{ durationMs: 60_000 },
				{ durationMs: 60_000 },
				{ durationMs: 60_000 },
				{ durationMs: 60_000, drainEvents: ['client-detached'] }
			],
			loopOverrides: { maxRapidExitsWithoutProgress: 2 }
		});
		const result = await loop(h.deps);
		expect(result).toMatchObject({ completed: true, aborted: false });
		expect(h.attachCount()).toBe(4);
	});

	it('a mid-attach advance counts as progress even when the client then exits rapidly', async () => {
		const loop = requireLoop();
		const h = makeHarness({
			answers: ['new-window', 'never-happens'],
			attaches: [
				{}, // rapid, no progress (counter → 1)
				{ midAttachEvents: [['after-new-window']] }, // rapid, but advanced (counter resets)
				{}, // rapid, no progress (counter → 1)
				{} // rapid, no progress (counter → 2 → abort)
			],
			loopOverrides: { maxRapidExitsWithoutProgress: 2 }
		});
		const result = await loop(h.deps);
		expect(result).toMatchObject({ completed: false, aborted: true });
		expect(h.attachCount()).toBe(4);
		expect(h.stepIndex()).toBe(1);
	});
});
