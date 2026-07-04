/**
 * Challenge / practice run controllers (issue #35, interface §8).
 *
 * Each controller decrypts/loads the current step, renders the prompt on the
 * status line, attaches the user's TTY, and — on each observed state delta —
 * derives candidate answers and advances when one is accepted. On completion a
 * challenge submits its proof; teardown is handled by the caller in `finally`.
 */

import type { IsolatedTmuxServer } from './server';
import type { TmuxObserver } from './observer';
import { deriveCandidates } from './detector';
import type { CliChallengeSession, FinishResponse } from '../api/challenge-session';
import type { StatusLine } from '../ui/status-line';
import type { DecryptedStep } from '$lib/client/challenge-core';
import type { PracticeItem, PracticeStep } from '$lib/data/practice-flow';

export type ChallengeRunResult = { completed: boolean; finish?: FinishResponse; aborted?: boolean };

export class ChallengeController {
	private server: IsolatedTmuxServer;
	private observer: TmuxObserver;
	private session: CliChallengeSession;
	private ui: StatusLine;

	constructor(args: {
		server: IsolatedTmuxServer;
		observer: TmuxObserver;
		session: CliChallengeSession;
		ui: StatusLine;
	}) {
		this.server = args.server;
		this.observer = args.observer;
		this.session = args.session;
		this.ui = args.ui;
	}

	async run(): Promise<ChallengeRunResult> {
		let step = await this.session.decryptCurrentStep();
		await this.ui.setPrompt(
			step.prompt,
			this.session.currentStepIndex(),
			this.session.totalSteps()
		);

		let advancing = false;
		const watcher = this.observer.watch(
			async (delta) => {
				if (advancing || this.session.isComplete()) return;
				advancing = true;
				try {
					const candidates = deriveCandidates(delta, step);
					for (const candidate of candidates) {
						if (await this.session.submitAnswer(candidate)) {
							if (this.session.isComplete()) {
								await this.ui.clear();
								await this.server.exec(['detach-client']);
								return;
							}
							step = await this.session.decryptCurrentStep();
							await this.ui.setPrompt(
								step.prompt,
								this.session.currentStepIndex(),
								this.session.totalSteps()
							);
							return;
						}
					}
				} finally {
					advancing = false;
				}
			},
			{ seedInput: step.seedInput }
		);

		try {
			await this.server.attach();
		} finally {
			watcher.stop();
		}

		if (this.session.isComplete()) {
			const finish = await this.session.finish();
			return { completed: true, finish };
		}
		return { completed: false, aborted: true };
	}
}

export class PracticeController {
	private server: IsolatedTmuxServer;
	private observer: TmuxObserver;
	private item: PracticeItem;
	private ui: StatusLine;

	constructor(args: {
		server: IsolatedTmuxServer;
		observer: TmuxObserver;
		item: PracticeItem;
		ui: StatusLine;
	}) {
		this.server = args.server;
		this.observer = args.observer;
		this.item = args.item;
		this.ui = args.ui;
	}

	async run(): Promise<{ completed: boolean; aborted?: boolean }> {
		let index = 0;
		const total = this.item.steps.length;
		await this.showStep(index);

		let advancing = false;
		const watcher = this.observer.watch(
			async (delta) => {
				if (advancing || index >= total) return;
				advancing = true;
				try {
					if (matchesPracticeStep(delta, this.item.steps[index], this.item.seedInput)) {
						index++;
						if (index >= total) {
							await this.ui.clear();
							await this.server.exec(['detach-client']);
							return;
						}
						await this.showStep(index);
					}
				} finally {
					advancing = false;
				}
			},
			{ seedInput: this.item.seedInput }
		);

		try {
			await this.server.attach();
		} finally {
			watcher.stop();
		}

		return { completed: index >= total, aborted: index < total };
	}

	private async showStep(index: number): Promise<void> {
		await this.ui.setPrompt(this.item.steps[index].prompt, index, this.item.steps.length);
	}
}

/** Practice matching: the observed delta's candidate set must include the step's command. */
function matchesPracticeStep(
	delta: import('../engine/types').StateDelta,
	step: PracticeStep,
	seedInput?: string
): boolean {
	const pseudoStep: DecryptedStep = { prompt: step.prompt, seedInput };
	const candidates = deriveCandidates(delta, pseudoStep);
	if (step.kind === 'command') {
		return candidates.includes(step.commandName);
	}
	// copy-mode-action steps: accept entering copy mode / buffer changes as progress.
	return delta.enteredCopyMode || delta.bufferAdded !== undefined || delta.pasteObserved === true;
}
