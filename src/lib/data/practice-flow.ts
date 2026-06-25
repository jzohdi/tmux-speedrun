import type { TmuxCommand } from './tmux-commands';
import type { CommandIdType } from '$lib/utils/tmux-commands';
import type { CopyModeAction } from '$lib/utils/tmux-conf';

const COPY_PASTE_PRACTICE_SEED = 'hi';

export type PracticeStep =
	| {
			id: string;
			kind: 'command';
			prompt: string;
			commandName: CommandIdType;
	  }
	| {
			id: string;
			kind: 'copy-mode-action';
			prompt: string;
			action: CopyModeAction;
	  };

export type PracticeItem = {
	id: string;
	category: TmuxCommand['category'];
	title: string;
	description: string;
	steps: PracticeStep[];
	seedInput?: string;
	requiresInput?: boolean;
};

function isStandaloneCopyPasteCommand(command: TmuxCommand): boolean {
	return command.name === 'copy-mode' || command.name === 'paste-buffer';
}

function createCommandPracticeItem(command: TmuxCommand): PracticeItem {
	return {
		id: command.name,
		category: command.category,
		title: command.name,
		description: command.description,
		requiresInput: command.requiresInput === true,
		steps: [
			{
				id: command.name,
				kind: 'command',
				prompt: command.description,
				commandName: command.name as CommandIdType
			}
		]
	};
}

export function createCopyPastePracticeItem(seedInput = COPY_PASTE_PRACTICE_SEED): PracticeItem {
	return {
		id: 'copy-paste-sequence',
		category: 'misc',
		title: 'copy-mode / paste-buffer',
		description: 'Practice the full tmux copy-and-paste workflow in order.',
		seedInput,
		steps: [
			{
				id: 'copy-mode',
				kind: 'command',
				prompt: `Enter copy mode to copy "${seedInput}" from the prompt.`,
				commandName: 'copy-mode'
			},
			{
				id: 'begin-selection',
				kind: 'copy-mode-action',
				prompt: 'Start the selection.',
				action: 'begin-selection'
			},
			{
				id: 'cursor-left',
				kind: 'copy-mode-action',
				prompt: `Move left once to highlight all of "${seedInput}".`,
				action: 'cursor-left'
			},
			{
				id: 'copy-selection-and-cancel',
				kind: 'copy-mode-action',
				prompt: 'Copy the highlighted text and exit copy mode.',
				action: 'copy-selection-and-cancel'
			},
			{
				id: 'paste-buffer',
				kind: 'command',
				prompt: 'Paste the copied text back into the prompt.',
				commandName: 'paste-buffer'
			}
		]
	};
}

export function createPracticeItems(commands: TmuxCommand[]): PracticeItem[] {
	const commandItems = commands
		.filter((command) => !isStandaloneCopyPasteCommand(command))
		.map(createCommandPracticeItem);
	const hasCopyMode = commands.some((command) => command.name === 'copy-mode');
	const hasPasteBuffer = commands.some((command) => command.name === 'paste-buffer');

	return hasCopyMode && hasPasteBuffer
		? [...commandItems, createCopyPastePracticeItem()]
		: commandItems;
}

export function shouldPreserveTerminalInputOnStepCompletion(
	item: PracticeItem,
	step: PracticeStep
): boolean {
	return (
		item.id === 'copy-paste-sequence' &&
		step.kind === 'command' &&
		step.commandName === 'paste-buffer'
	);
}
