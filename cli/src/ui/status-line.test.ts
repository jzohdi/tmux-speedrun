/**
 * Failing tests for the status line (issue #45 defect 1, interface §7).
 *
 * The prompt gets exactly ONE source of truth: the `@speedrun_prompt` user
 * option, referenced once by the config's static `status-left`. StatusLine
 * only ever writes that option — never `status-left` — so tmux owns the
 * redraw and prompts can never stack (invariant PR1).
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

describe('StatusLine — single-source prompt rendering (interface §7)', () => {
	it('setPrompt writes the @speedrun_prompt user option, never status-left', async () => {
		const { ui, calls } = makeUi();
		await ui.setPrompt('Split the pane', 0, 10);
		const writes = promptWrites(calls);
		expect(writes).toHaveLength(1);
		expect(writes[0]).toBe('[1/10] Split the pane');
		expect(calls.flat()).not.toContain('status-left');
	});

	it('also accepts a view object { prompt, index, total } (the run loop passes engine.view())', async () => {
		const { ui, calls } = makeUi();
		await (
			ui as unknown as {
				setPrompt(view: { prompt: string; index: number; total: number }): Promise<void>;
			}
		).setPrompt({ prompt: 'Rename the window', index: 2, total: 9 });
		expect(promptWrites(calls)).toEqual(['[3/9] Rename the window']);
	});

	it('clear() empties @speedrun_prompt and never touches status-left', async () => {
		const { ui, calls } = makeUi();
		await ui.clear();
		expect(promptWrites(calls)).toEqual(['']);
		expect(calls.flat()).not.toContain('status-left');
	});

	it('sanitizes: whitespace collapsed, value truncated to 118 chars (fits status-left-length 120)', async () => {
		const { ui, calls } = makeUi();
		await ui.setPrompt(`long   prompt\nwith\tgaps ${'x'.repeat(300)}`, 0, 5);
		const [value] = promptWrites(calls);
		expect(value).toBeDefined();
		expect(value.startsWith('[1/5] long prompt with gaps ')).toBe(true);
		expect(value.length).toBeLessThanOrEqual(118);
	});

	it("escapes '#' as '##' so tmux format expansion cannot mangle the prompt", async () => {
		const { ui, calls } = makeUi();
		await ui.setPrompt('Select window #1', 0, 2);
		const [value] = promptWrites(calls);
		expect(value).toBeDefined();
		expect(value).toContain('##1');
	});
});
