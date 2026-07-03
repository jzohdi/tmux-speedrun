/**
 * Challenge pool configuration.
 *
 * Each challenge level has:
 * - A pool of commands to draw from (defined by a filter function)
 * - A target instruction count
 * - A minimum number of input commands (rename-style with random strings)
 *
 * Pool composition is flexible and can be easily adjusted.
 * Current design (difficulty-gated so later challenges use more advanced commands):
 * - C0: Beginner commands only (16 commands)
 * - C1-C2: Beginner + Intermediate (30 commands)
 * - C3-C5: All commands, including Advanced (39 commands)
 *
 * Instruction counts taper as challenges progress:
 * C0=18, C1=26, C2=33, C3=39, C4=44, C5=48
 *
 * Input commands (rename-window, rename-session) add security by
 * expanding the answer space from 39 options to 39 + (N × 144,000),
 * where 144,000 = 40 adjectives × 40 nouns × 90 number suffixes.
 */

import type { TmuxCommand } from '$lib/data/tmux-commands';
import { CHALLENGE_INSTRUCTION_COUNTS } from '$lib/data/challenge-scaling';
import { TMUX_COMMANDS } from '$lib/data/tmux-commands';

/**
 * Configuration for a single challenge's command pool.
 */
export type PoolConfig = {
	challengeId: number;
	instructionCount: number;
	filter: (cmd: TmuxCommand) => boolean;
	/**
	 * Minimum number of input commands (rename-style) to include.
	 * These commands require typing a random string, expanding the answer space.
	 */
	minInputCommands: number;
};

const MIN_INPUT_COMMANDS = 2;

/**
 * Pool configurations for each challenge level.
 *
 * To modify a challenge's pool, update the filter function.
 * The filter receives a TmuxCommand and returns true if it should be included.
 */
export const CHALLENGE_POOLS: PoolConfig[] = [
	{
		challengeId: 0,
		instructionCount: CHALLENGE_INSTRUCTION_COUNTS[0],
		filter: (cmd) => cmd.difficulty === 'beginner',
		minInputCommands: MIN_INPUT_COMMANDS
	},
	{
		challengeId: 1,
		instructionCount: CHALLENGE_INSTRUCTION_COUNTS[1],
		filter: (cmd) => cmd.difficulty === 'beginner' || cmd.difficulty === 'intermediate',
		minInputCommands: MIN_INPUT_COMMANDS
	},
	{
		challengeId: 2,
		instructionCount: CHALLENGE_INSTRUCTION_COUNTS[2],
		filter: (cmd) => cmd.difficulty === 'beginner' || cmd.difficulty === 'intermediate',
		minInputCommands: MIN_INPUT_COMMANDS
	},
	{
		challengeId: 3,
		instructionCount: CHALLENGE_INSTRUCTION_COUNTS[3],
		filter: () => true,
		minInputCommands: MIN_INPUT_COMMANDS
	},
	{
		challengeId: 4,
		instructionCount: CHALLENGE_INSTRUCTION_COUNTS[4],
		filter: () => true,
		minInputCommands: MIN_INPUT_COMMANDS
	},
	{
		challengeId: 5,
		instructionCount: CHALLENGE_INSTRUCTION_COUNTS[5],
		filter: () => true,
		minInputCommands: MIN_INPUT_COMMANDS
	}
];

/**
 * Get the pool configuration for a challenge level.
 *
 * @param challengeId - The challenge level (0-5)
 * @returns The pool configuration
 * @throws Error if challengeId is invalid
 */
export function getPoolConfig(challengeId: number): PoolConfig {
	const config = CHALLENGE_POOLS.find((p) => p.challengeId === challengeId);

	if (!config) {
		throw new Error(
			`Invalid challenge ID: ${challengeId}. Valid range is 0-${CHALLENGE_POOLS.length - 1}`
		);
	}

	return config;
}

/**
 * Get the command pool for a challenge level.
 *
 * @param challengeId - The challenge level (0-5)
 * @returns Array of TmuxCommand objects in the pool
 * @throws Error if challengeId is invalid
 */
export function getPoolForChallenge(challengeId: number): TmuxCommand[] {
	const config = getPoolConfig(challengeId);

	return TMUX_COMMANDS.filter(config.filter);
}

/**
 * Get input commands (requiresInput=true) from a challenge's pool.
 *
 * @param challengeId - The challenge level (0-5)
 * @returns Array of TmuxCommand objects that require input
 */
export function getInputCommandsForChallenge(challengeId: number): TmuxCommand[] {
	const pool = getPoolForChallenge(challengeId);

	return pool.filter((cmd) => cmd.requiresInput === true);
}

/**
 * Get simple commands (no input required) from a challenge's pool.
 *
 * @param challengeId - The challenge level (0-5)
 * @returns Array of TmuxCommand objects that don't require input
 */
export function getSimpleCommandsForChallenge(challengeId: number): TmuxCommand[] {
	const pool = getPoolForChallenge(challengeId);

	return pool.filter((cmd) => cmd.requiresInput !== true);
}

/**
 * Get the target instruction count for a challenge level.
 *
 * @param challengeId - The challenge level (0-5)
 * @returns Number of instructions in the challenge
 * @throws Error if challengeId is invalid
 */
export function getInstructionCount(challengeId: number): number {
	const config = getPoolConfig(challengeId);

	return config.instructionCount;
}

/**
 * Get the minimum number of input commands for a challenge level.
 *
 * @param challengeId - The challenge level (0-5)
 * @returns Minimum number of input commands to include
 * @throws Error if challengeId is invalid
 */
export function getMinInputCommands(challengeId: number): number {
	const config = getPoolConfig(challengeId);

	return config.minInputCommands;
}

/**
 * Get the total number of available challenge levels.
 */
export function getChallengePoolCount(): number {
	return CHALLENGE_POOLS.length;
}

/**
 * Validate that a challenge ID is within the valid range.
 *
 * @param challengeId - The challenge level to validate
 * @returns true if valid, false otherwise
 */
export function isValidChallengeId(challengeId: number): boolean {
	return Number.isInteger(challengeId) && challengeId >= 0 && challengeId < CHALLENGE_POOLS.length;
}

/**
 * Get all commands that appear in ANY challenge pool.
 *
 * This is the union of all challenge pools, used for displaying
 * a comprehensive man page that shows all commands a user might encounter.
 *
 * @returns Array of unique TmuxCommand objects across all challenges
 */
export function getAllChallengeCommands(): TmuxCommand[] {
	const commandSet = new Set<string>();
	const commands: TmuxCommand[] = [];

	// Iterate through all challenge pools and collect unique commands
	for (const config of CHALLENGE_POOLS) {
		const poolCommands = TMUX_COMMANDS.filter(config.filter);

		for (const cmd of poolCommands) {
			if (!commandSet.has(cmd.name)) {
				commandSet.add(cmd.name);
				commands.push(cmd);
			}
		}
	}

	return commands;
}

/**
 * Get the difficulty label for a challenge based on its pool configuration.
 *
 * @param challengeId - The challenge level (0-5)
 * @returns A human-readable difficulty label
 */
export function getChallengeDifficultyLabel(challengeId: number): string {
	if (challengeId <= 0) {
		return 'Beginner';
	}
	if (challengeId <= 2) {
		return 'Intermediate';
	}

	return 'Advanced';
}

/**
 * Challenge metadata for display in the UI.
 */
export type ChallengeMetadata = {
	index: number;
	instructionCount: number;
	difficultyLabel: string;
};

/**
 * Get metadata for all challenges.
 * This is used by the terminal to display the challenge list.
 *
 * @returns Array of challenge metadata objects
 */
export function getAllChallengeMetadata(): ChallengeMetadata[] {
	return CHALLENGE_POOLS.map((pool) => ({
		index: pool.challengeId,
		instructionCount: pool.instructionCount,
		difficultyLabel: getChallengeDifficultyLabel(pool.challengeId)
	}));
}
