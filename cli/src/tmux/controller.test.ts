/**
 * Failing tests for the R3 practice-mode command hint (issue #45, plan §9.2,
 * interface §11.2): the practice `StepEngine.view()` must append the command's
 * `shortcut` (e.g. `Rename the current window — prefix + ,`) so the drill tells
 * the user HOW to perform each command. Challenge mode is deliberately NOT
 * given hints (it tests recall), and `copy-mode-action` steps — already
 * step-by-step instructions — keep their prompt verbatim.
 *
 * The controllers already exist; these tests exercise the composed prompt
 * through `ui.setPrompt`, which the run loop calls with `engine.view()` before
 * the first attach. Fakes stand in for the server/observer/ui; the run
 * completes on the first attach's drain so the loop returns immediately.
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

type PromptView = { prompt: string; index: number; total: number };

/**
 * Drive a controller to completion on its first attach, capturing every
 * `ui.setPrompt` view. `completingDelta` is what the post-attach drain returns
 * — its derived candidates advance (and complete) the single-step run.
 */
function makeFakes(completingDelta: StateDelta) {
	const promptViews: PromptView[] = [];

	const server = {
		liveHooks: new Set(['client-attached', 'after-attach-session']),
		attach: async () => ({ code: 0 }),
		isAlive: async () => true,
		ensureRunning: async () => ({ restartedServer: false, createdSession: false })
	} as unknown as IsolatedTmuxServer;

	const observer = {
		watch: () => ({ stop: () => {} }),
		resetBaseline: async () => {},
		drainDelta: async () => completingDelta,
		exec: async () => ({ stdout: '', stderr: '', code: 0 }),
		expectEvents: () => {}
	} as unknown as TmuxObserver;

	const ui = {
		setPrompt: async (view: PromptView) => {
			promptViews.push(view);
		},
		clear: async () => {},
		flash: async () => {}
	} as unknown as StatusLine;

	return { server, observer, ui, promptViews };
}

async function runPractice(item: PracticeItem, completingDelta: StateDelta): Promise<PromptView[]> {
	const { server, observer, ui, promptViews } = makeFakes(completingDelta);
	await new PracticeController({ server, observer, item, ui }).run();
	return promptViews;
}

describe('PracticeController — command-step hint (R3, interface §11.2)', () => {
	it('appends the command shortcut to a `command` step prompt', async () => {
		const cmd = TMUX_COMMANDS.find((c) => c.name === 'rename-window')!;
		const item: PracticeItem = {
			id: 'rename-window',
			category: 'window',
			title: 'rename-window',
			description: cmd.description,
			steps: [
				{
					id: 'rename-window',
					kind: 'command',
					prompt: cmd.description,
					commandName: 'rename-window'
				}
			]
		} as unknown as PracticeItem;

		const views = await runPractice(item, makeDelta({ commandEvents: ['after-rename-window'] }));

		expect(views.length, 'the run loop never rendered a prompt').toBeGreaterThan(0);
		// e.g. "Rename the current window — prefix + ,"
		expect(views[0].prompt).toContain(cmd.description);
		expect(views[0].prompt, 'practice must surface the keystroke/typed form').toContain(
			cmd.shortcut
		);
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

		const views = await runPractice(item, makeDelta({ enteredCopyMode: true }));

		expect(views[0].prompt).toBe(prompt);
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

		const { server, observer, ui, promptViews } = makeFakes(
			makeDelta({ commandEvents: ['after-rename-window'] })
		);
		await new ChallengeController({ server, observer, session, ui }).run();

		expect(promptViews[0].prompt).toBe(prompt);
		expect(promptViews[0].prompt, 'challenge must not append a hint separator').not.toContain('—');
	});
});
