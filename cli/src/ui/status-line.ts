/**
 * Challenge/practice status line (issue #35 §8; issue #45 defect 1, §7).
 *
 * The prompt has exactly ONE source of truth: the `@speedrun_prompt` user
 * option, referenced once by the config's static `status-left`. StatusLine
 * only ever writes that option — never `status-left` — so tmux owns the
 * redraw and prompts can never stack (invariant PR1).
 */

import type { IsolatedTmuxServer } from '../tmux/server';

export type PromptView = { prompt: string; index: number; total: number };

export class StatusLine {
	constructor(private server: IsolatedTmuxServer) {}

	/** Write the step prompt + progress to @speedrun_prompt (idempotent). */
	async setPrompt(view: PromptView): Promise<void>;
	async setPrompt(prompt: string, stepIndex: number, totalSteps: number): Promise<void>;
	async setPrompt(
		promptOrView: string | PromptView,
		stepIndex?: number,
		totalSteps?: number
	): Promise<void> {
		const view: PromptView =
			typeof promptOrView === 'object'
				? promptOrView
				: { prompt: promptOrView, index: stepIndex!, total: totalSteps! };
		const left = `[${view.index + 1}/${view.total}] ${view.prompt}`;
		await this.server.exec(['set', '-g', '@speedrun_prompt', sanitize(left)]);
	}

	/** Briefly flash a transient message (e.g. "not quite, try again"). */
	async flash(message: string): Promise<void> {
		await this.server.exec(['display-message', message]);
	}

	/** Clear the prompt (e.g. on completion). */
	async clear(): Promise<void> {
		await this.server.exec(['set', '-g', '@speedrun_prompt', '']);
	}
}

/**
 * Collapse whitespace, truncate to fit status-left-length 120, and escape `#`
 * (the value is expanded as a tmux format string by the static status-left).
 */
function sanitize(text: string): string {
	return text.replace(/\s+/g, ' ').slice(0, 118).replaceAll('#', '##');
}
