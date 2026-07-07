import { userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ChallengeTerminal from './ChallengeTerminal.svelte';
import { CommandId, commandPopulatesTerminalInput } from '$lib/utils/tmux-commands';
import * as tmuxCommands from '$lib/utils/tmux-commands';
import type { TmuxSignal } from '$lib/utils/pane-tree';

/**
 * Issue #50: the challenge route must NOT dismiss/refocus away from the command-prompt overlay.
 * The real gate is `commandOpensInputOverlay(commandName)` in `$lib/utils/tmux-commands`, which
 * does not exist yet. We reach it through the module namespace on purpose: a *named* import of a
 * not-yet-created export hard-fails the whole browser bundle (esbuild "No matching export"), which
 * would report "no tests" for this file instead of a clean per-test failure. A namespace property
 * access is simply `undefined` until the feature lands, so this file stays importable and the test
 * below goes red for the right reason (the predicate is missing → the overlay gets dismissed) and
 * green once `commandOpensInputOverlay` is implemented. The export itself is unit-locked in
 * tmux-commands.test.ts.
 */
function opensInputOverlay(commandName: TmuxSignal['commandName']): boolean {
	const predicate = (tmuxCommands as unknown as Record<string, unknown>).commandOpensInputOverlay;
	return typeof predicate === 'function' && predicate(commandName) === true;
}

/**
 * The challenge route preserves the input for input-populating commands via
 * `commandPopulatesTerminalInput(signal.commandName)` (unit-tested in
 * tmux-commands.test.ts). Here we inline that predicate's exact semantics — preserve only
 * for paste-buffer — so this browser file stays importable while the feature is unbuilt.
 */
function populatesTerminalInput(commandName: TmuxSignal['commandName']): boolean {
	return commandName === CommandId.PASTE_BUFFER;
}

/**
 * Issue #42: non-required commands must still affect the terminal, independent of the
 * challenge's current required step. These tests exercise both invocation surfaces —
 * command mode (`prefix + :`) and the `prefix + ]` paste key — and the challenge consumer's
 * clear/preserve behavior.
 */

type Screen = Awaited<ReturnType<typeof render>>;

function getTerminal(screen: Screen) {
	return screen.getByRole('application', { name: /challenge terminal/i });
}

/** Seed buffer0001 via copy mode; its content is the two-char selection "% ". */
async function seedBufferViaCopyMode(screen: Screen): Promise<void> {
	await userEvent.click(getTerminal(screen));
	await userEvent.keyboard('{Control>}b{/Control}{[}');
	await userEvent.keyboard('{Control>}{Space}{/Control}');
	await userEvent.keyboard('{ArrowLeft}');
	await userEvent.keyboard('{Alt>}w{/Alt}');
	await expect.element(screen.getByText('Copied to buffer0001')).toBeVisible();
}

describe('ChallengeTerminal command-prompt executes commands regardless of the required step', () => {
	it('pastes the latest buffer when paste-buffer is typed into the command prompt', async () => {
		const screen = await render(ChallengeTerminal);

		await seedBufferViaCopyMode(screen);

		// Open the command prompt (prefix + :) and run paste-buffer generically.
		await userEvent.keyboard('{Control>}b{/Control}:');
		await userEvent.keyboard('paste-buffer{Enter}');

		await expect.element(screen.getByRole('textbox')).toHaveValue('% ');
	});

	it('enters copy mode when copy-mode is typed into the command prompt', async () => {
		const screen = await render(ChallengeTerminal);

		await userEvent.click(getTerminal(screen));
		await userEvent.keyboard('{Control>}b{/Control}:');
		await userEvent.keyboard('copy-mode{Enter}');

		await expect.element(screen.getByText('tmux: copy mode')).toBeVisible();
	});

	it('runs list-buffers via the command prompt and shows its output', async () => {
		const screen = await render(ChallengeTerminal);

		await seedBufferViaCopyMode(screen);

		await userEvent.keyboard('{Control>}b{/Control}:');
		await userEvent.keyboard('list-buffers{Enter}');

		await expect.element(screen.getByText(/buffer0001:/)).toBeVisible();
	});

	it('runs list-windows via the command prompt and shows its output', async () => {
		const screen = await render(ChallengeTerminal);

		await userEvent.click(getTerminal(screen));
		await userEvent.keyboard('{Control>}b{/Control}:');
		await userEvent.keyboard('list-windows{Enter}');

		await expect.element(screen.getByText(/0: main/)).toBeVisible();
	});
});

describe('ChallengeTerminal paste survives a clearing consumer (challenge-route gate)', () => {
	/**
	 * Mimics the challenge route consumer: it clears the terminal input after every
	 * command-executed signal EXCEPT for input-populating commands (paste-buffer), using the
	 * real `commandPopulatesTerminalInput` predicate.
	 */
	async function mountWithClearingConsumer(): Promise<{ screen: Screen; signals: TmuxSignal[] }> {
		const signals: TmuxSignal[] = [];
		const holder: { api: { clearInput: () => void } | null } = { api: null };
		const screen = await render(ChallengeTerminal, {
			onSignal: (signal: TmuxSignal) => {
				signals.push(signal);
				if (signal.type === 'command-executed' && !populatesTerminalInput(signal.commandName)) {
					holder.api?.clearInput();
				}
			}
		});
		holder.api = screen.component as unknown as { clearInput: () => void };
		return { screen, signals };
	}

	it('retains the pasted input when pasting with prefix + ] while a different step is required', async () => {
		const { screen, signals } = await mountWithClearingConsumer();

		await seedBufferViaCopyMode(screen);

		// Paste via the prefix key. The consumer would wipe this input unless the emitted
		// signal is tagged with commandName: paste-buffer.
		await userEvent.keyboard('{Control>}b{/Control}{]}');

		await expect.element(screen.getByRole('textbox')).toHaveValue('% ');

		// Scoring input is unchanged: the paste still emits the composite copy/paste answer,
		// now additionally tagged with commandName so the gate can detect it.
		const pasteSignal = signals.find(
			(s) => s.type === 'command-executed' && s.commandName === CommandId.PASTE_BUFFER
		);
		expect(pasteSignal).toBeDefined();
		expect(pasteSignal?.command).toBeTruthy();
	});

	it('retains the pasted input when pasting via the command prompt while a different step is required', async () => {
		const { screen } = await mountWithClearingConsumer();

		await seedBufferViaCopyMode(screen);

		await userEvent.keyboard('{Control>}b{/Control}:');
		await userEvent.keyboard('paste-buffer{Enter}');

		await expect.element(screen.getByRole('textbox')).toHaveValue('% ');
	});

	it('still clears the input for a non-input command (contrast case)', async () => {
		const { screen } = await mountWithClearingConsumer();
		const input = screen.getByRole('textbox');

		await userEvent.click(input);
		await userEvent.keyboard('hello');
		await expect.element(input).toHaveValue('hello');

		// A non-input command (list-windows) must trigger the consumer's clearInput().
		await userEvent.click(getTerminal(screen));
		await userEvent.keyboard('{Control>}b{/Control}:');
		await userEvent.keyboard('list-windows{Enter}');

		await expect.element(input).toHaveValue('');
	});
});

describe('ChallengeTerminal command-prompt survives the challenge-route consumer (issue #50)', () => {
	/**
	 * Mimics the real challenge route (`src/routes/challenge/[id]/+page.svelte` `handleSignal`):
	 * it is async and awaits `submitAnswer` before clearing/refocusing the terminal, so the
	 * clear/focus land on a later microtask — AFTER `ChallengeTerminal.handleCommand` has opened
	 * the command-prompt overlay. That ordering is exactly what makes the bug observable: a
	 * synchronous consumer would run before the overlay opens and never dismiss it.
	 *
	 * The gate mirrors the route's intended fix: skip `clearInput()` for input-populating
	 * (paste-buffer) OR overlay-opening (command-prompt) commands, and skip `focus()` for
	 * overlay-opening commands so the cursor is not pulled out of the overlay input. `focus()`
	 * for every other command is unchanged.
	 */
	async function mountWithClearingAndFocusingConsumer(): Promise<{
		screen: Screen;
		signals: TmuxSignal[];
	}> {
		const signals: TmuxSignal[] = [];
		const holder: { api: { clearInput: () => void; focus: () => Promise<void> } | null } = {
			api: null
		};
		const screen = await render(ChallengeTerminal, {
			onSignal: (signal: TmuxSignal) => {
				signals.push(signal);
				if (signal.type !== 'command-executed') {
					return;
				}
				// Defer like the real async handler (which awaits submitAnswer) so the clear/focus
				// run after the overlay has opened.
				void (async () => {
					await Promise.resolve();
					const opensOverlay = opensInputOverlay(signal.commandName);
					if (!commandPopulatesTerminalInput(signal.commandName) && !opensOverlay) {
						holder.api?.clearInput();
					}
					if (!opensOverlay) {
						await holder.api?.focus();
					}
				})();
			}
		});
		holder.api = screen.component as unknown as {
			clearInput: () => void;
			focus: () => Promise<void>;
		};
		return { screen, signals };
	}

	/** Flush microtasks + one animation frame so the deferred consumer clear/focus has run. */
	async function flushConsumer(): Promise<void> {
		await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
		await Promise.resolve();
	}

	it('keeps the orange command-prompt overlay open and focused, and still scores, after prefix + :', async () => {
		const { screen, signals } = await mountWithClearingAndFocusingConsumer();

		await userEvent.click(getTerminal(screen));
		await userEvent.keyboard('{Control>}b{/Control}:');

		// Let the route-mimicking consumer's deferred clearInput()/focus() run. Before the fix
		// they dismiss the just-opened overlay (clearInput sets inputModeCommand = null) and steal
		// focus back to the pane; after the fix the gate skips both for command-prompt.
		await flushConsumer();

		const statusInput = document.querySelector('.status-input') as HTMLInputElement | null;
		expect(statusInput).not.toBeNull();
		// The overlay's own auto-focus keeps the cursor in the prompt (the consumer skipped focus()).
		expect(document.activeElement).toBe(statusInput);

		// Scoring parity: the command-prompt step is still verified from the signal emitted when
		// the prompt opens, exactly as today.
		const promptSignal = signals.find(
			(s) => s.type === 'command-executed' && s.commandName === CommandId.COMMAND_PROMPT
		);
		expect(promptSignal).toBeDefined();
	});

	it('lets the user type a command into the surviving overlay and run it', async () => {
		const { screen } = await mountWithClearingAndFocusingConsumer();

		await userEvent.click(getTerminal(screen));
		await userEvent.keyboard('{Control>}b{/Control}:');
		await flushConsumer();

		// Precondition (red before the fix): the cursor is in the overlay, not the pane — so the
		// keystrokes below genuinely go through the command-prompt path rather than the pane input.
		const statusInput = document.querySelector('.status-input') as HTMLInputElement | null;
		expect(document.activeElement).toBe(statusInput);

		await userEvent.keyboard('list-windows{Enter}');

		// Submitting the overlay runs the command (its output shows) and closes the overlay.
		await expect.element(screen.getByText(/0: main/)).toBeVisible();
		expect(document.querySelector('.status-input')).toBeNull();
	});
});
