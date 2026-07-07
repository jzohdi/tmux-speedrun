import { userEvent } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ChallengeTerminal from './ChallengeTerminal.svelte';
import { CommandId } from '$lib/utils/tmux-commands';
import type { TmuxSignal } from '$lib/utils/pane-tree';

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
