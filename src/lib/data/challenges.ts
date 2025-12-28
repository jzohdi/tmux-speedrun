/**
 * Challenges data structure.
 * Each challenge references commands from the tmux-commands.ts file.
 * This ensures the man page is always in sync with available challenges.
 */

import type { TmuxCommand } from './tmux-commands';
import { getCommandByName } from './tmux-commands';

export type Challenge = {
	difficulty: number; // 0-30 scale
	commandNames: string[]; // References to TmuxCommand.name
};

export type ChallengeWithCommands = Challenge & {
	commands: TmuxCommand[];
	commandCount: number;
};

// Hardcoded challenges - will be moved to database later
export const CHALLENGES: Challenge[] = [
	{
		difficulty: 5,
		commandNames: ['new-session', 'new-window', 'next-window', 'previous-window', 'detach']
	},
	{
		difficulty: 12,
		commandNames: ['split-horizontal', 'split-vertical', 'select-pane', 'kill-pane', 'toggle-zoom']
	},
	{
		difficulty: 15,
		commandNames: ['new-window', 'select-window', 'rename-window', 'kill-window', 'list-windows', 'last-window']
	},
	{
		difficulty: 18,
		commandNames: ['new-session', 'attach-session', 'list-sessions', 'kill-session', 'detach']
	},
	{
		difficulty: 25,
		commandNames: [
			'new-session',
			'new-window',
			'split-horizontal',
			'split-vertical',
			'select-pane',
			'next-window',
			'toggle-zoom',
			'kill-pane',
			'detach'
		]
	}
];

// Helper functions

/**
 * Get a challenge by its numerical index (0-based).
 * challenge/0 returns CHALLENGES[0], challenge/1 returns CHALLENGES[1], etc.
 */
export function getChallengeByIndex(index: number): Challenge | undefined {
	if (index < 0 || index >= CHALLENGES.length) {
		return undefined;
	}

	return CHALLENGES[index];
}

/**
 * Get challenge with commands by numerical index (0-based).
 */
export function getChallengeWithCommandsByIndex(index: number): ChallengeWithCommands | undefined {
	const challenge = getChallengeByIndex(index);
	if (!challenge) {
		return undefined;
	}

	const commands = challenge.commandNames
		.map((name) => getCommandByName(name))
		.filter((cmd): cmd is TmuxCommand => cmd !== undefined);

	return {
		...challenge,
		commands,
		commandCount: commands.length
	};
}

/**
 * Get the total number of available challenges.
 */
export function getChallengeCount(): number {
	return CHALLENGES.length;
}

/**
 * Get the maximum valid challenge index (0-based).
 */
export function getMaxChallengeIndex(): number {
	return CHALLENGES.length - 1;
}

export function getAllChallengesWithMeta(): Array<Challenge & { commandCount: number; index: number }> {
	return CHALLENGES.map((challenge, index) => ({
		...challenge,
		index,
		commandCount: challenge.commandNames.length
	}));
}

export function getDifficultyLabel(difficulty: number): string {
	if (difficulty <= 10) {
		return 'Beginner';
	}
	if (difficulty <= 20) {
		return 'Intermediate';
	}

	return 'Advanced';
}

export function getDifficultyColor(difficulty: number): string {
	if (difficulty <= 10) {
		return 'text-green-400';
	}
	if (difficulty <= 20) {
		return 'text-yellow-400';
	}

	return 'text-red-400';
}

/**
 * Get all unique commands used across all challenges.
 * This is used to validate that all commands in challenges exist in the commands list.
 */
export function getAllUsedCommands(): string[] {
	const allCommands = new Set<string>();
	for (const challenge of CHALLENGES) {
		for (const cmd of challenge.commandNames) {
			allCommands.add(cmd);
		}
	}

	return Array.from(allCommands);
}

