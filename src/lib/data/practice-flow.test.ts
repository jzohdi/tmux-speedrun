import { describe, expect, it } from 'vitest';

import { TMUX_COMMANDS } from './tmux-commands';
import {
	createCopyPastePracticeItem,
	createPracticeItems,
	shouldPreserveTerminalInputOnStepCompletion
} from './practice-flow';

describe('practice flow', () => {
	it('adds the ordered copy and paste practice item once', () => {
		const items = createPracticeItems(TMUX_COMMANDS);
		const sequenceItems = items.filter((item) => item.id === 'copy-paste-sequence');

		expect(sequenceItems).toHaveLength(1);
		expect(items.some((item) => item.id === 'copy-mode')).toBe(false);
		expect(items.some((item) => item.id === 'paste-buffer')).toBe(false);
	});

	it('skips the composite copy practice item when copy or paste is unavailable', () => {
		const items = createPracticeItems(
			TMUX_COMMANDS.filter((command) => command.name !== 'paste-buffer')
		);

		expect(items.some((item) => item.id === 'copy-paste-sequence')).toBe(false);
	});

	it('defines the copy sequence steps in the expected order', () => {
		const item = createCopyPastePracticeItem('hi');

		expect(item.steps).toEqual([
			expect.objectContaining({ id: 'copy-mode', kind: 'command', commandName: 'copy-mode' }),
			expect.objectContaining({
				id: 'begin-selection',
				kind: 'copy-mode-action',
				action: 'begin-selection'
			}),
			expect.objectContaining({
				id: 'cursor-left',
				kind: 'copy-mode-action',
				action: 'cursor-left'
			}),
			expect.objectContaining({
				id: 'copy-selection-and-cancel',
				kind: 'copy-mode-action',
				action: 'copy-selection-and-cancel'
			}),
			expect.objectContaining({ id: 'paste-buffer', kind: 'command', commandName: 'paste-buffer' })
		]);
		expect(item.seedInput).toBe('hi');
	});

	it('preserves terminal input only after the final paste step', () => {
		const item = createCopyPastePracticeItem('hi');
		const pasteStep = item.steps[item.steps.length - 1];
		const copyStep = item.steps[item.steps.length - 2];

		expect(shouldPreserveTerminalInputOnStepCompletion(item, pasteStep)).toBe(true);
		expect(shouldPreserveTerminalInputOnStepCompletion(item, copyStep)).toBe(false);
		expect(
			shouldPreserveTerminalInputOnStepCompletion(createPracticeItems(TMUX_COMMANDS)[0], {
				id: 'show-time',
				kind: 'command',
				prompt: 'Display the clock',
				commandName: 'show-time'
			})
		).toBe(false);
	});
});
