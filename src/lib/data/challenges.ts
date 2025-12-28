/**
 * Challenges data structure.
 * Each challenge references commands from the tmux-commands.ts file.
 * This ensures the man page is always in sync with available challenges.
 */

import type { TmuxCommand } from './tmux-commands';
import { getCommandByName } from './tmux-commands';

export type Challenge = {
	id: string;
	name: string;
	description: string;
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
		id: 'basics-101',
		name: 'Basics 101',
		description: 'Learn the fundamental tmux commands: create sessions, windows, and navigate between them.',
		difficulty: 5,
		commandNames: ['new-session', 'new-window', 'next-window', 'previous-window', 'detach']
	},
	{
		id: 'pane-master',
		name: 'Pane Master',
		description: 'Master pane management: split, navigate, and resize panes efficiently.',
		difficulty: 12,
		commandNames: ['split-horizontal', 'split-vertical', 'select-pane', 'kill-pane', 'toggle-zoom']
	},
	{
		id: 'window-warrior',
		name: 'Window Warrior',
		description: 'Become proficient with window operations and fast navigation.',
		difficulty: 15,
		commandNames: ['new-window', 'select-window', 'rename-window', 'kill-window', 'list-windows', 'last-window']
	},
	{
		id: 'session-ninja',
		name: 'Session Ninja',
		description: 'Handle multiple sessions like a pro: create, switch, and manage sessions.',
		difficulty: 18,
		commandNames: ['new-session', 'attach-session', 'list-sessions', 'kill-session', 'detach']
	},
	{
		id: 'speed-demon',
		name: 'Speed Demon',
		description: 'Put it all together in a high-intensity challenge using all core tmux features.',
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
export function getChallengeById(id: string): Challenge | undefined {
	return CHALLENGES.find((c) => c.id === id);
}

export function getChallengeWithCommands(id: string): ChallengeWithCommands | undefined {
	const challenge = getChallengeById(id);
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

export function getAllChallengesWithMeta(): Array<Challenge & { commandCount: number }> {
	return CHALLENGES.map((challenge) => ({
		...challenge,
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

