/**
 * Challenge/practice status line (issue #35, interface §8/§5.2).
 *
 * Surfaces the current step prompt + progress in the isolated tmux server's
 * status bar (so the attached user sees it without leaving tmux), and can flash
 * a popup message on advance.
 */

import type { IsolatedTmuxServer } from '../tmux/server';

export class StatusLine {
	constructor(private server: IsolatedTmuxServer) {}

	/** Update the persistent status-left with the step prompt + progress. */
	async setPrompt(prompt: string, stepIndex: number, totalSteps: number): Promise<void> {
		const left = `[${stepIndex + 1}/${totalSteps}] ${prompt}`;
		await this.server.exec(['set', '-g', 'status-left', sanitize(left)]);
	}

	/** Briefly flash a transient message (e.g. "not quite, try again"). */
	async flash(message: string): Promise<void> {
		await this.server.exec(['display-message', message]);
	}

	/** Clear the prompt (e.g. on completion). */
	async clear(): Promise<void> {
		await this.server.exec(['set', '-g', 'status-left', '[tmux-speedrun] ']);
	}
}

/** tmux status strings can't contain raw newlines; collapse whitespace. */
function sanitize(text: string): string {
	return text.replace(/\s+/g, ' ').slice(0, 160);
}
