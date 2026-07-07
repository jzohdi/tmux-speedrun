/**
 * Failing tests for R4 continuous practice mode (issue #45, PR #46 third
 * feedback round, interface §12.1) PLUS the migrated R3 practice-hint tests
 * (interface §11.2).
 *
 * R4 restructures `PracticeController` to take the WHOLE ordered drill list
 * (`items: PracticeItem[]`) instead of a single `item`, and to run it in ONE
 * continuous `runAttachLoop` over a flattened `(item, step)` sequence with a
 * single GLOBAL index. The reported bug: with one server + one loop *per drill*,
 * every drill ends by detaching the client, tearing down its server, and
 * re-attaching for the next drill — the "detach/re-attach on almost every
 * command" the user reports. Challenge mode never had this because it runs one
 * loop over all steps, replacing the prompt in place.
 *
 * These tests exercise the REAL `PracticeController` (no module mocks) against
 * lightweight fakes for server/observer/ui. Because the constructor now takes
 * `items`, every construction here uses the new shape; the shipped R3 hint
 * tests are migrated to a single-element `items` list (interface §10 note:
 * update shipped tests to the new contract rather than preserve the stale one).
 *
 * TMUX_COMMANDS is imported by real path (not `$lib`) so the suite runs under a
 * bare vitest invocation too (see oneshot.test.ts for the same rationale).
 */

import { describe, expect, it } from 'vitest';
import { ChallengeController, PracticeController } from './controller';
import { TMUX_COMMANDS } from '../../../src/lib/data/tmux-commands';
import type { StateDelta, TmuxState } from '../engine/types';
import type { IsolatedTmuxServer } from './server';
import type { TmuxObserver } from './observer';
import type { StatusLine } from '../ui/status-line';
import type { PracticeItem } from '$lib/data/practice-flow';
import type { CliChallengeSession } from '../api/challenge-session';

const EMPTY_STATE: TmuxState = {
	sessions: [],
	windows: [],
	panes: [],
	activePaneId: null,
	activeWindow: null,
	buffers: []
};

function makeDelta(over: Partial<StateDelta> = {}): StateDelta {
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
		commandEvents: [],
		movedPanes: [],
		...over
	} as StateDelta;
}

type PromptView = { prompt: string; index: number; total: number; hotkey?: string };

/**
 * Fakes that drive the real `runAttachLoop`: every attach ends immediately and
 * the post-attach drain returns `completingDelta`, which advances whatever step
 * is current. A run over N flattened steps therefore takes N attach iterations,
 * advancing exactly one step per iteration — with no detach between drills.
 */
function makeFakes(completingDelta: StateDelta) {
	const promptViews: PromptView[] = [];
	const execCalls: string[][] = [];
	const drainSeedInputs: (string | undefined)[] = [];
	let clearCount = 0;

	const server = {
		liveHooks: new Set(['client-attached', 'after-attach-session']),
		attach: async () => ({ code: 0 }),
		isAlive: async () => true,
		ensureRunning: async () => ({ restartedServer: false, createdSession: false })
	} as unknown as IsolatedTmuxServer;

	const observer = {
		watch: () => ({ stop: () => {} }),
		resetBaseline: async () => {},
		drainDelta: async (opts?: { seedInput?: string }) => {
			drainSeedInputs.push(opts?.seedInput);
			return completingDelta;
		},
		exec: async (args: string[]) => {
			execCalls.push(args);
			return { stdout: '', stderr: '', code: 0 };
		},
		expectEvents: () => {}
	} as unknown as TmuxObserver;

	const ui = {
		setPrompt: async (view: PromptView) => {
			promptViews.push(view);
		},
		clear: async () => {
			clearCount++;
		},
		flash: async () => {}
	} as unknown as StatusLine;

	return {
		server,
		observer,
		ui,
		promptViews,
		execCalls,
		drainSeedInputs,
		getClearCount: () => clearCount
	};
}

/** Fast-forward: the re-attach delay between drills is trimmed so multi-step
 *  runs don't sleep the default 1000 ms per iteration. */
function commandStepItem(id: string, commandName: string): PracticeItem {
	const cmd = TMUX_COMMANDS.find((c) => c.name === commandName)!;
	return {
		id,
		category: cmd.category,
		title: commandName,
		description: cmd.description,
		steps: [{ id, kind: 'command', prompt: cmd.description, commandName }]
	} as unknown as PracticeItem;
}

describe('PracticeController — R3 command-step hint, migrated to items[] (interface §11.2 + issue #53)', () => {
	it('carries the command shortcut as a separate `hotkey` field, not joined into the prompt', async () => {
		const cmd = TMUX_COMMANDS.find((c) => c.name === 'rename-window')!;
		const item = commandStepItem('rename-window', 'rename-window');

		const f = makeFakes(makeDelta({ commandEvents: ['after-rename-window'] }));
		await new PracticeController({
			server: f.server,
			observer: f.observer,
			items: [item],
			ui: f.ui
		} as never).run();

		expect(f.promptViews.length, 'the run loop never rendered a prompt').toBeGreaterThan(0);
		// The prompt is the plain description; the shortcut is now surfaced
		// separately so the status line can emphasize it (issue #53). The em-dash
		// join is gone, so the shortcut no longer bleeds into the prompt text.
		expect(f.promptViews[0].prompt).toContain(cmd.description);
		expect(
			f.promptViews[0].hotkey,
			'practice must surface the keystroke as structured data'
		).toBe(cmd.shortcut);
		expect(
			f.promptViews[0].prompt,
			'the shortcut must NOT be concatenated into the prompt text anymore'
		).not.toContain(cmd.shortcut);
	});

	it('returns a `copy-mode-action` step prompt verbatim (no bogus hint appended)', async () => {
		const prompt = 'Start the selection.';
		const item: PracticeItem = {
			id: 'copy-paste-sequence',
			category: 'misc',
			title: 'copy-mode / paste-buffer',
			description: 'copy/paste',
			seedInput: 'hi',
			steps: [
				{ id: 'begin-selection', kind: 'copy-mode-action', prompt, action: 'begin-selection' }
			]
		} as unknown as PracticeItem;

		const f = makeFakes(makeDelta({ enteredCopyMode: true }));
		await new PracticeController({
			server: f.server,
			observer: f.observer,
			items: [item],
			ui: f.ui
		} as never).run();

		expect(f.promptViews[0].prompt).toBe(prompt);
	});
});

describe('PracticeController — R4 continuous run over all drills (interface §12.1)', () => {
	it('progresses a single GLOBAL index across items with no detach between drills', async () => {
		const items = [
			commandStepItem('new-window', 'new-window'),
			commandStepItem('rename-window', 'rename-window')
		];
		// One delta that advances either command step (both after-hooks present).
		const delta = makeDelta({ commandEvents: ['after-new-window', 'after-rename-window'] });

		const f = makeFakes(delta);
		const result = await new PracticeController({
			server: f.server,
			observer: f.observer,
			items,
			ui: f.ui
		} as never).run();

		expect(result.completed, 'the whole drill list should complete in one run').toBe(true);

		// The status line always shows the GLOBAL total (2), never a per-item
		// total of 1 — proof the engine flattened both items into one sequence.
		expect(f.promptViews.length).toBeGreaterThan(0);
		for (const v of f.promptViews) {
			expect(v.total, 'view.total must be the global step count').toBe(2);
		}
		const indices = f.promptViews.map((v) => v.index);
		expect(indices, 'the global index must reach the second drill').toContain(1);

		// The second drill's prompt was rendered in the SAME run (we advanced into
		// it without a fresh controller / server).
		const renameDesc = TMUX_COMMANDS.find((c) => c.name === 'rename-window')!.description;
		expect(f.promptViews.some((v) => v.prompt.includes(renameDesc))).toBe(true);

		// Continuity guarantee: `detach-client` is issued ONCE, only at final
		// completion — NOT once per drill (the reported regression).
		const detachExecs = f.execCalls.filter((a) => a[0] === 'detach-client');
		expect(detachExecs.length, 'detach must happen once for the whole run, not per drill').toBe(1);
		expect(f.getClearCount(), 'the prompt is cleared once, at completion').toBe(1);
	});

	it('view() reports the global index/total and appends the shortcut hint only for command steps', async () => {
		const renameItem = commandStepItem('rename-window', 'rename-window');
		const copyPrompt = 'Start the selection.';
		const copyItem: PracticeItem = {
			id: 'copy-paste-sequence',
			category: 'misc',
			title: 'copy-mode / paste-buffer',
			description: 'copy/paste',
			seedInput: 'hi',
			steps: [
				{ id: 'begin-selection', kind: 'copy-mode-action', prompt: copyPrompt, action: 'begin-selection' }
			]
		} as unknown as PracticeItem;

		const delta = makeDelta({ commandEvents: ['after-rename-window'], enteredCopyMode: true });
		const f = makeFakes(delta);
		await new PracticeController({
			server: f.server,
			observer: f.observer,
			items: [renameItem, copyItem],
			ui: f.ui
		} as never).run();

		for (const v of f.promptViews) {
			expect(v.total, 'global total across both items').toBe(2);
		}
		const renameShortcut = TMUX_COMMANDS.find((c) => c.name === 'rename-window')!.shortcut;
		expect(
			f.promptViews.some((v) => v.hotkey === renameShortcut),
			'command step must surface its shortcut on the hotkey field'
		).toBe(true);
		// The copy-mode-action step is rendered verbatim, with NO hotkey (no
		// shortcut to emphasize).
		expect(
			f.promptViews.some((v) => v.prompt === copyPrompt && v.hotkey === undefined),
			'copy-mode-action prompt must be verbatim with no hotkey'
		).toBe(true);
	});

	it('seedInput is the copy-paste seed only while a copy-paste step is current', async () => {
		const renameItem = commandStepItem('rename-window', 'rename-window'); // no seedInput
		const copyItem: PracticeItem = {
			id: 'copy-paste-sequence',
			category: 'misc',
			title: 'copy-mode / paste-buffer',
			description: 'copy/paste',
			seedInput: 'hi',
			steps: [
				{ id: 'begin-selection', kind: 'copy-mode-action', prompt: 'Start the selection.', action: 'begin-selection' }
			]
		} as unknown as PracticeItem;

		const delta = makeDelta({ commandEvents: ['after-rename-window'], enteredCopyMode: true });
		const f = makeFakes(delta);
		await new PracticeController({
			server: f.server,
			observer: f.observer,
			items: [renameItem, copyItem],
			ui: f.ui
		} as never).run();

		// The loop resolves one step per attach; the seedInput handed to the drain
		// reflects the current pair's ITEM seed — undefined for the command drill,
		// 'hi' only while the copy-paste drill is current.
		expect(f.drainSeedInputs).toEqual([undefined, 'hi']);
	});
});

describe('ChallengeController — prompt is NOT hinted (R3, interface §11.2 — recall test)', () => {
	it('renders the decrypted step prompt unchanged (no shortcut leaked)', async () => {
		const prompt = 'Rename the current window';
		let index = 0;
		const steps = [{ prompt, answer: 'rename-window' }];
		const session = {
			isComplete: () => index >= steps.length,
			decryptCurrentStep: async () => ({ prompt: steps[index].prompt }),
			currentStepIndex: () => index,
			totalSteps: () => steps.length,
			submitAnswer: async (answer: string) => {
				if (index < steps.length && answer === steps[index].answer) {
					index++;
					return true;
				}
				return false;
			},
			finish: async () => ({}) as unknown
		} as unknown as CliChallengeSession;

		const f = makeFakes(makeDelta({ commandEvents: ['after-rename-window'] }));
		await new ChallengeController({
			server: f.server,
			observer: f.observer,
			session,
			ui: f.ui
		}).run();

		expect(f.promptViews[0].prompt).toBe(prompt);
		expect(f.promptViews[0].prompt, 'challenge must not append a hint separator').not.toContain(
			'—'
		);
	});
});
