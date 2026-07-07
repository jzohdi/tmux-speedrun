/**
 * Challenge/practice status line (issue #35 §8; issue #45 defect 1, §7).
 *
 * The prompt has exactly ONE source of truth: the `@speedrun_prompt` user
 * option, referenced once by the config's static `status-left`. StatusLine
 * only ever writes that option — never `status-left` — so tmux owns the
 * redraw and prompts can never stack (invariant PR1).
 */

import type { IsolatedTmuxServer } from '../tmux/server';

export type PromptView = {
	prompt: string;
	index: number;
	total: number;
	/** Present only when a shortcut hint should be emphasized (practice command steps). */
	hotkey?: string;
};

/**
 * Visible-width budget for the composed value. `status-left-length` (120,
 * locked by config.test.ts) limits DISPLAY columns; `#[…]` style directives
 * occupy zero columns and `##` renders as one. Keep a 2-column margin.
 */
const MAX_VISIBLE = 118;

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
		await this.server.exec(['set', '-g', '@speedrun_prompt', compose(view)]);
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
 * Compose the tmux FORMAT STRING written to `@speedrun_prompt` by concatenating
 * literal `#[…]` style directives (never escaped) around escaped user-text
 * segments (issue #53):
 *
 *   - a de-emphasized `[i/N]` counter,
 *   - the descriptive prompt text (default style),
 *   - an optional bold/color hotkey emphasis (` — <hotkey>`), only when a
 *     shortcut hint is present, and
 *   - trailing separation so the prompt never abuts the tmux window list.
 *
 * Length budgeting works on VISIBLE width: only the descriptive text is
 * truncated, and truncation happens on the raw text BEFORE escaping/wrapping,
 * so a cut can never land inside a `##` pair or a `#[…]` directive.
 */
function compose(view: PromptView): string {
	const counterLabel = `[${view.index + 1}/${view.total}]`;
	const counterWidth = counterLabel.length + 1; // + trailing space

	const hotkey = view.hotkey ? collapse(view.hotkey) : '';
	const hasHotkey = hotkey.length > 0;
	// ` — ` (3 columns) + the hotkey's visible width.
	const hotkeyWidth = hasHotkey ? 3 + hotkey.length : 0;

	const trailingWidth = 2;
	const remaining = Math.max(0, MAX_VISIBLE - counterWidth - hotkeyWidth - trailingWidth);
	const text = collapse(view.prompt).slice(0, remaining);

	let out = `#[fg=colour245]${counterLabel}#[default] ${escapeText(text)}`;
	if (hasHotkey) {
		out += ` — #[fg=colour227,bold]${closeStyle(escapeText(hotkey))}`;
	}
	return out + '  ';
}

/** Collapse runs of whitespace to a single space (does NOT escape `#`). */
function collapse(text: string): string {
	return text.replace(/\s+/g, ' ');
}

/**
 * Append the `#[default]` reset that closes a styled segment. If the escaped
 * text ends with a literal `#` (i.e. the user text ended in `#`, doubled to
 * `##`), a directly-adjacent `#[default]` would read as the ambiguous run
 * `##[…]`. Separate the two with a space so the escaped `#` and the intentional
 * directive stay visually distinct; text that does not end in `#` keeps the
 * directive adjacent.
 */
function closeStyle(escaped: string): string {
	return escaped.endsWith('#') ? `${escaped} #[default]` : `${escaped}#[default]`;
}

/**
 * Escape a user-derived text segment for tmux format expansion: double every
 * `#` → `##` so a literal `#` survives. Applied ONLY to text segments, never
 * to the intentional `#[…]` style directives, which must keep their single `#`.
 */
function escapeText(text: string): string {
	return text.replaceAll('#', '##');
}
