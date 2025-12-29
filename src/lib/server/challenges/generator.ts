/**
 * Challenge instruction generator.
 *
 * Generates randomized instruction sequences for challenges.
 * The algorithm ensures:
 * 1. Every command in the pool appears at least once
 * 2. Minimum number of input commands are included (security requirement)
 * 3. Remaining slots are filled with random picks from the pool
 * 4. Final order is shuffled for unpredictability
 * 5. Prompts use random variations for each command
 * 6. Input commands get random strings to expand answer space
 */

import type { TmuxCommand } from '$lib/data/tmux-commands';
import type { Instruction } from './types';
import {
	getPoolForChallenge,
	getInstructionCount,
	getMinInputCommands,
	getInputCommandsForChallenge,
	getSimpleCommandsForChallenge,
	isValidChallengeId
} from './pools';
import { getRandomPrompt, getRandomPromptWithInput } from './prompt-variations';
import { generateMeaningfulString } from './random-string';

/**
 * Generate a randomized instruction sequence for a challenge.
 *
 * Algorithm:
 * 1. Separate pool into input commands and simple commands
 * 2. Add minimum required input commands (with random strings)
 * 3. Add remaining simple commands to ensure pool coverage
 * 4. Fill remaining slots with random picks
 * 5. Shuffle the final list for random presentation order
 * 6. Re-index all instructions sequentially
 *
 * @param challengeId - The challenge level (0-5)
 * @returns Array of Instruction objects
 * @throws Error if challengeId is invalid or pool configuration is invalid
 */
export function generateInstructions(challengeId: number): Instruction[] {
	if (!isValidChallengeId(challengeId)) {
		throw new Error(`Invalid challenge ID: ${challengeId}`);
	}

	const targetCount = getInstructionCount(challengeId);
	const minInputCommands = getMinInputCommands(challengeId);
	const inputCommands = getInputCommandsForChallenge(challengeId);
	const simpleCommands = getSimpleCommandsForChallenge(challengeId);
	const allCommands = getPoolForChallenge(challengeId);

	if (allCommands.length === 0) {
		throw new Error(`Empty command pool for challenge ${challengeId}`);
	}

	const instructions: Instruction[] = [];

	// Step 1: Add required input commands (for security)
	// Each input command gets a unique random string
	const shuffledInputCommands = shuffleArray([...inputCommands]);
	const inputCommandsToAdd = Math.min(minInputCommands, shuffledInputCommands.length);

	for (let i = 0; i < inputCommandsToAdd; i++) {
		const cmd = shuffledInputCommands[i];
		instructions.push(createInputInstruction(cmd));
	}

	// Track which simple commands we've used
	const usedSimpleCommands = new Set<string>();

	// Step 2: Ensure every simple command appears at least once
	const shuffledSimpleCommands = shuffleArray([...simpleCommands]);
	for (const cmd of shuffledSimpleCommands) {
		if (instructions.length >= targetCount) {
			break;
		}
		instructions.push(createSimpleInstruction(cmd));
		usedSimpleCommands.add(cmd.name);
	}

	// Step 3: If we still need more input commands to meet minimum, add them
	// (This handles edge cases where we had to add simple commands first)
	// Only attempt if there are input commands available in the pool
	if (inputCommands.length > 0) {
		const currentInputCount = instructions.filter((inst) => inst.requiredInput !== undefined).length;
		const additionalInputNeeded = minInputCommands - currentInputCount;

		for (let i = 0; i < additionalInputNeeded && instructions.length < targetCount; i++) {
			// Reuse input commands with new random strings
			const cmd = inputCommands[i % inputCommands.length];
			instructions.push(createInputInstruction(cmd));
		}
	}

	// Step 4: Fill remaining slots with random picks
	// Prefer input commands for added security, but mix in simple commands
	while (instructions.length < targetCount) {
		// 30% chance to add another input command if available
		const useInput = inputCommands.length > 0 && Math.random() < 0.3;

		if (useInput) {
			const cmd = inputCommands[getRandomInt(inputCommands.length)];
			instructions.push(createInputInstruction(cmd));
		} else {
			const cmd = simpleCommands[getRandomInt(simpleCommands.length)];
			instructions.push(createSimpleInstruction(cmd));
		}
	}

	// Step 5: Shuffle final order for unpredictability
	const shuffledInstructions = shuffleArray(instructions);

	// Step 6: Re-index after shuffle to ensure sequential indices
	return shuffledInstructions.map((instruction, index) => ({
		...instruction,
		index
	}));
}

/**
 * Create an instruction for a simple command (no input required).
 *
 * @param cmd - The source command
 * @returns An Instruction object with random prompt variation
 */
function createSimpleInstruction(cmd: TmuxCommand): Instruction {
	return {
		index: 0, // Will be reassigned after shuffle
		prompt: getRandomPrompt(cmd.name),
		expectedAction: cmd.name
	};
}

/**
 * Create an instruction for an input command (requires typed string).
 *
 * @param cmd - The source command (must have requiresInput=true)
 * @returns An Instruction object with random string and prompt
 */
function createInputInstruction(cmd: TmuxCommand): Instruction {
	const randomInput = generateMeaningfulString();

	return {
		index: 0, // Will be reassigned after shuffle
		prompt: getRandomPromptWithInput(cmd.name, randomInput),
		expectedAction: `${cmd.name}:${randomInput}`,
		requiredInput: randomInput
	};
}

/**
 * Fisher-Yates shuffle algorithm.
 * Creates a new shuffled array without mutating the original.
 *
 * @param array - The array to shuffle
 * @returns A new shuffled array
 */
function shuffleArray<T>(array: T[]): T[] {
	const result = [...array];

	for (let i = result.length - 1; i > 0; i--) {
		const j = getRandomInt(i + 1);
		[result[i], result[j]] = [result[j], result[i]];
	}

	return result;
}

/**
 * Generate a random integer in range [0, max).
 *
 * @param max - The exclusive upper bound
 * @returns A random integer
 */
function getRandomInt(max: number): number {
	return Math.floor(Math.random() * max);
}

/**
 * Extract the expected actions (canonical command names) from instructions.
 * Useful for computing the key chain for encryption.
 *
 * @param instructions - Array of instructions
 * @returns Array of expectedAction strings in order
 */
export function getExpectedActions(instructions: Instruction[]): string[] {
	return instructions.map((inst) => inst.expectedAction);
}

/**
 * Count occurrences of each command in an instruction set.
 * For input commands, counts the base command name (without the random string).
 * Useful for testing and debugging.
 *
 * @param instructions - Array of instructions
 * @returns Map of command name to occurrence count
 */
export function countCommandOccurrences(instructions: Instruction[]): Map<string, number> {
	const counts = new Map<string, number>();

	for (const inst of instructions) {
		// Extract base command name (before colon for input commands)
		const baseName = inst.expectedAction.split(':')[0];
		const current = counts.get(baseName) ?? 0;
		counts.set(baseName, current + 1);
	}

	return counts;
}

/**
 * Count instructions that have required input.
 *
 * @param instructions - Array of instructions
 * @returns Number of input instructions
 */
export function countInputInstructions(instructions: Instruction[]): number {
	return instructions.filter((inst) => inst.requiredInput !== undefined).length;
}

/**
 * Validate that instructions meet the minimum input command requirement.
 *
 * @param instructions - Array of instructions
 * @param minRequired - Minimum input commands required
 * @returns true if requirement is met
 */
export function meetsInputRequirement(instructions: Instruction[], minRequired: number): boolean {
	return countInputInstructions(instructions) >= minRequired;
}
