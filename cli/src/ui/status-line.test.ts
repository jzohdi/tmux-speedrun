/**
 * Failing tests for the styled, separated practice-mode status line
 * (issue #53, interface §7) — building on the single-source invariant from
 * issue #45 defect 1.
 *
 * The prompt keeps exactly ONE source of truth: the `@speedrun_prompt` user
 * option, referenced once by the config's static `status-left`. StatusLine
 * only ever writes that option — never `status-left` — so tmux owns the
 * redraw and prompts can never stack (invariant PR1).
 *
 * Issue #53 adds styling: the value is a tmux FORMAT STRING composed by
 * concatenating literal `#[…]` style directives (never escaped) around
 * escaped user-text segments — a de-emphasized counter, the descriptive
 * text, an optional bold/color hotkey emphasis, and trailing separation so
 * the prompt never abuts the tmux window list.
 */

import { describe, expect, it } from 'vitest';
import { StatusLine } from './status-line';
import type { IsolatedTmuxServer } from '../tmux/server';
import type { TmuxResult } from '../tmux/client';

function makeUi() {
	const calls: string[][] = [];
	const server = {
		exec: async (args: string[]): Promise<TmuxResult> => {
			calls.push(args);
			return { stdout: '', stderr: '', code: 0 };
		}
	} as unknown as IsolatedTmuxServer;
	return { ui: new StatusLine(server), calls };
}

/** Values written to the @speedrun_prompt option, in call order. */
function promptWrites(calls: string[][]): string[] {
	return calls
		.filter((args) => args.includes('@speedrun_prompt'))
		.map((args) => args[args.indexOf('@speedrun_prompt') + 1]);
}

/** The styled view shape issue #53 introduces (`hotkey?` is new). */
type StyledView = { prompt: string; index: number; total: number; hotkey?: string };

/** Call the (view-object) overload of setPrompt with the new styled shape. */
function setView(ui: StatusLine, view: StyledView): Promise<void> {
	return (ui as unknown as { setPrompt(v: StyledView): Promise<void> }).setPrompt(view);
}

/**
 * Visible width of a composed value: `#[…]` style directives occupy zero
 * display columns and `##` renders as a single `#`, so strip the directives
 * then collapse doubled `#` before measuring (interface §4).
 */
function visibleWidth(value: string): number {
	return value.replace(/#\[[^\]]*\]/g, '').replaceAll('##', '#').length;
}

describe('StatusLine — single-source prompt rendering (invariant PR1)', () => {
	it('setPrompt writes the @speedrun_prompt user option, never status-left', async () => {
		const { ui, calls } = makeUi();
		await ui.setPrompt('Split the pane', 0, 10);
		const writes = promptWrites(calls);
		expect(writes).toHaveLength(1);
		expect(writes[0]).toContain('[1/10]');
		expect(writes[0]).toContain('Split the pane');
		expect(calls.flat()).not.toContain('status-left');
	});

	it('also accepts a view object { prompt, index, total } (the run loop passes engine.view())', async () => {
		const { ui, calls } = makeUi();
		await setView(ui, { prompt: 'Rename the window', index: 2, total: 9 });
		const [value] = promptWrites(calls);
		expect(value).toContain('[3/9]');
		expect(value).toContain('Rename the window');
	});

	it('clear() empties @speedrun_prompt and never touches status-left', async () => {
		const { ui, calls } = makeUi();
		await ui.clear();
		expect(promptWrites(calls)).toEqual(['']);
		expect(calls.flat()).not.toContain('status-left');
	});
});

describe('StatusLine — styled, separated prompts (issue #53, interface §7)', () => {
	it('de-emphasizes the [i/N] counter with a style directive closed by #[default]', async () => {
		const { ui, calls } = makeUi();
		await ui.setPrompt('Split the pane', 0, 10);
		const [value] = promptWrites(calls);
		// A leading `#[fg=…]` wraps the counter and is immediately closed by
		// `#[default]` followed by a separating space before the description.
		expect(value).toMatch(/^#\[fg=[^\]]*\]\[1\/10\]#\[default\] /);
	});

	it('emphasizes the hotkey (bold + color) when a shortcut hint is present', async () => {
		const { ui, calls } = makeUi();
		await setView(ui, {
			prompt: 'Split the current pane vertically',
			index: 2,
			total: 12,
			hotkey: 'prefix + "'
		});
		const [value] = promptWrites(calls);
		// The descriptive text and the hotkey are separated by a spaced em-dash…
		expect(value).toContain(' — ');
		// …and the hotkey itself is wrapped in a bold style directive, closed by
		// `#[default]` (color number is not pinned — only the structure is).
		expect(value).toContain('bold');
		expect(value).toMatch(/#\[[^\]]*\]prefix \+ "#\[default\]/);
	});

	it('adds NO hotkey emphasis when no shortcut is shown (challenge / copy-mode parity)', async () => {
		const { ui, calls } = makeUi();
		await setView(ui, { prompt: 'Rename the window', index: 2, total: 9 });
		const [value] = promptWrites(calls);
		expect(value).toContain('Rename the window');
		expect(value, 'un-hinted prompts must not carry a bold hotkey directive').not.toContain('bold');
	});

	it("escapes '#' in user text as '##' while leaving intentional #[…] directives intact", async () => {
		const { ui, calls } = makeUi();
		await setView(ui, { prompt: 'Select window #1', index: 0, total: 2, hotkey: 'ctrl + #' });
		const [value] = promptWrites(calls);
		// User `#` is doubled in BOTH the prompt and the hotkey…
		expect(value).toContain('##1');
		expect(value).toContain('ctrl + ##');
		// …but the style directives keep their single `#` (never doubled to `##[`).
		expect(value).toContain('#[fg=');
		expect(value).not.toContain('##[');
	});

	it('emits balanced directives that never leak style past the prompt', async () => {
		const { ui, calls } = makeUi();
		await setView(ui, {
			prompt: 'Split the pane',
			index: 0,
			total: 4,
			hotkey: 'prefix + "'
		});
		const [value] = promptWrites(calls);
		// Every opening `#[fg=…]` is balanced by a closing `#[default]`.
		const opens = (value.match(/#\[fg=/g) ?? []).length;
		const closes = (value.match(/#\[default\]/g) ?? []).length;
		expect(opens).toBeGreaterThan(0);
		expect(closes).toBe(opens);
		// The value never ends mid-directive.
		expect(value).not.toMatch(/#\[[^\]]*$/);
	});

	it('ends with trailing separation so the prompt never abuts the window list', async () => {
		const { ui, calls } = makeUi();
		await setView(ui, { prompt: 'Rename the window', index: 2, total: 9 });
		const [value] = promptWrites(calls);
		expect(value.endsWith('  ')).toBe(true);
	});

	it('collapses whitespace in the descriptive text', async () => {
		const { ui, calls } = makeUi();
		await ui.setPrompt('long   prompt\nwith\tgaps', 0, 5);
		const [value] = promptWrites(calls);
		expect(value).toContain('long prompt with gaps');
	});

	it('bounds the VISIBLE width to <= 118 by truncating only the descriptive text', async () => {
		const { ui, calls } = makeUi();
		await setView(ui, {
			prompt: 'x'.repeat(300),
			index: 0,
			total: 5,
			hotkey: 'prefix + "'
		});
		const [value] = promptWrites(calls);
		expect(value).toBeDefined();
		// Style directives + `##` do not count toward the tmux status-left-length
		// budget; the visible width stays within 118 (< status-left-length 120).
		expect(visibleWidth(value)).toBeLessThanOrEqual(118);
		// The counter and hotkey are the scannable payload and are never truncated.
		expect(value).toContain('[1/5]');
		expect(value).toContain('prefix + "');
		expect(value).toContain('bold');
	});
});
