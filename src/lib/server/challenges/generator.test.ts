import { describe, it, expect } from 'vitest';
import { TMUX_COMMANDS } from '$lib/data/tmux-commands';
import {
	generateInstructions,
	getExpectedActions,
	countCommandOccurrences,
	countInputInstructions,
	meetsInputRequirement
} from './generator';
import {
	getPoolForChallenge,
	getInstructionCount,
	getMinInputCommands,
	getInputCommandsForChallenge,
	getSimpleCommandsForChallenge,
	isValidChallengeId,
	getChallengePoolCount,
	CHALLENGE_POOLS
} from './pools';
import {
	generateMeaningfulString,
	isValidMeaningfulString,
	getCombinationCount
} from './random-string';
import {
	getRandomPrompt,
	getRandomPromptWithInput,
	hasPromptVariations,
	getCommandsWithVariations,
	PROMPT_VARIATIONS
} from './prompt-variations';

/**
 * Random String Generator Tests
 */
describe('Random String Generator', () => {
	it('generates strings in word-word-digits format', () => {
		for (let i = 0; i < 20; i++) {
			const str = generateMeaningfulString();
			expect(isValidMeaningfulString(str)).toBe(true);
		}
	});

	it('generates unique strings', () => {
		const strings = new Set<string>();

		for (let i = 0; i < 100; i++) {
			strings.add(generateMeaningfulString());
		}

		// With 144,000 combinations, 100 strings should all be unique
		expect(strings.size).toBe(100);
	});

	it('reports correct combination count', () => {
		const count = getCombinationCount();

		// 40 adjectives × 40 nouns × 90 numbers = 144,000
		expect(count).toBe(144000);
	});

	it('validates format correctly', () => {
		expect(isValidMeaningfulString('swift-tiger-42')).toBe(true);
		expect(isValidMeaningfulString('bright-falcon-99')).toBe(true);
		expect(isValidMeaningfulString('cool-wave-10')).toBe(true);

		expect(isValidMeaningfulString('Swift-tiger-42')).toBe(false); // Capital
		expect(isValidMeaningfulString('swift-tiger-1')).toBe(false); // Single digit
		expect(isValidMeaningfulString('swift-tiger-100')).toBe(false); // Three digits
		expect(isValidMeaningfulString('swifttiger42')).toBe(false); // No dashes
		expect(isValidMeaningfulString('')).toBe(false);
	});
});

/**
 * Prompt Variations Tests
 */
describe('Prompt Variations', () => {
	it('has variations for all commands in TMUX_COMMANDS', () => {
		for (const cmd of TMUX_COMMANDS) {
			expect(hasPromptVariations(cmd.name)).toBe(true);
		}
	});

	it('each command has 4-6 variations', () => {
		for (const [cmdName, variations] of Object.entries(PROMPT_VARIATIONS)) {
			expect(variations.length).toBeGreaterThanOrEqual(4);
			expect(variations.length).toBeLessThanOrEqual(6);
		}
	});

	it('getRandomPrompt returns non-empty string', () => {
		for (const cmd of TMUX_COMMANDS) {
			const prompt = getRandomPrompt(cmd.name);

			expect(typeof prompt).toBe('string');
			expect(prompt.length).toBeGreaterThan(0);
		}
	});

	it('getRandomPromptWithInput replaces placeholder', () => {
		const input = 'test-value-42';
		const prompt = getRandomPromptWithInput('rename-window', input);

		expect(prompt).toContain(input);
		expect(prompt).not.toContain('{input}');
	});

	it('getRandomPrompt returns different values over time', () => {
		const prompts = new Set<string>();

		// Run many times to exercise randomness
		for (let i = 0; i < 50; i++) {
			prompts.add(getRandomPrompt('split-vertical'));
		}

		// With 5 variations, we should see multiple different prompts
		expect(prompts.size).toBeGreaterThan(1);
	});

	it('throws for unknown command', () => {
		expect(() => getRandomPrompt('unknown-command')).toThrow();
	});

	it('keeps previous-window and last-window prompts unambiguous', () => {
		expect(PROMPT_VARIATIONS['previous-window'].some((prompt) => prompt.includes('previous active'))).toBe(
			false
		);
		expect(PROMPT_VARIATIONS['last-window'].some((prompt) => prompt.includes('previous active'))).toBe(
			false
		);
		expect(PROMPT_VARIATIONS['last-window'].some((prompt) => prompt.includes('Toggle to the previous'))).toBe(
			false
		);
	});
});

/**
 * Pool Configuration Tests
 */
describe('Pool Configuration', () => {
	it('C0 pool contains only beginner commands', () => {
		const pool = getPoolForChallenge(0);

		expect(pool.length).toBeGreaterThan(0);

		for (const cmd of pool) {
			expect(cmd.difficulty).toBe('beginner');
		}
	});

	it('C5 pool contains all commands', () => {
		const pool = getPoolForChallenge(5);

		expect(pool.length).toBe(TMUX_COMMANDS.length);
	});

	it('pool size is monotonically non-decreasing across challenges', () => {
		let prevSize = 0;

		for (let i = 0; i < getChallengePoolCount(); i++) {
			const pool = getPoolForChallenge(i);
			expect(pool.length).toBeGreaterThanOrEqual(prevSize);
			prevSize = pool.length;
		}
	});

	it('instruction count follows BASE + INCREMENT * level pattern', () => {
		const expectedCounts = [25, 40, 55, 70, 85, 100];

		for (let i = 0; i < getChallengePoolCount(); i++) {
			expect(getInstructionCount(i)).toBe(expectedCounts[i]);
		}
	});

	it('instruction count grows by 15 per challenge level', () => {
		const counts = CHALLENGE_POOLS.map((p) => p.instructionCount);

		for (let i = 1; i < counts.length; i++) {
			expect(counts[i] - counts[i - 1]).toBe(15);
		}
	});

	it('minInputCommands is configured for each challenge', () => {
		const expectedMins = [3, 5, 7, 9, 11, 13];

		for (let i = 0; i < getChallengePoolCount(); i++) {
			expect(getMinInputCommands(i)).toBe(expectedMins[i]);
		}
	});

	it('input commands are correctly filtered', () => {
		for (let i = 0; i < getChallengePoolCount(); i++) {
			const inputCmds = getInputCommandsForChallenge(i);

			for (const cmd of inputCmds) {
				expect(cmd.requiresInput).toBe(true);
			}
		}
	});

	it('simple commands are correctly filtered', () => {
		for (let i = 0; i < getChallengePoolCount(); i++) {
			const simpleCmds = getSimpleCommandsForChallenge(i);

			for (const cmd of simpleCmds) {
				expect(cmd.requiresInput).not.toBe(true);
			}
		}
	});

	it('isValidChallengeId returns true for valid IDs', () => {
		for (let i = 0; i < getChallengePoolCount(); i++) {
			expect(isValidChallengeId(i)).toBe(true);
		}
	});

	it('isValidChallengeId returns false for invalid IDs', () => {
		expect(isValidChallengeId(-1)).toBe(false);
		expect(isValidChallengeId(99)).toBe(false);
		expect(isValidChallengeId(1.5)).toBe(false);
		expect(isValidChallengeId(NaN)).toBe(false);
	});
});

/**
 * Instruction Generation Tests
 */
describe('Instruction Generation', () => {
	it('generates correct number of instructions for each challenge', () => {
		for (let i = 0; i < getChallengePoolCount(); i++) {
			const instructions = generateInstructions(i);
			expect(instructions.length).toBe(getInstructionCount(i));
		}
	});

	it('meets minimum input command requirement for each challenge', () => {
		for (let challengeId = 0; challengeId < getChallengePoolCount(); challengeId++) {
			const instructions = generateInstructions(challengeId);
			const minRequired = getMinInputCommands(challengeId);

			expect(meetsInputRequirement(instructions, minRequired)).toBe(true);
		}
	});

	it('input instructions have compound expectedAction with random string', () => {
		const instructions = generateInstructions(0);
		const inputInstructions = instructions.filter((inst) => inst.requiredInput !== undefined);

		for (const inst of inputInstructions) {
			// Should be in format "command-name:random-string"
			expect(inst.expectedAction).toContain(':');

			const [cmdName, randomPart] = inst.expectedAction.split(':');
			expect(cmdName.length).toBeGreaterThan(0);
			expect(isValidMeaningfulString(randomPart)).toBe(true);
			expect(inst.requiredInput).toBe(randomPart);
		}
	});

	it('simple instructions have plain expectedAction', () => {
		const instructions = generateInstructions(0);
		const simpleInstructions = instructions.filter((inst) => inst.requiredInput === undefined);

		for (const inst of simpleInstructions) {
			expect(inst.expectedAction).not.toContain(':');
		}
	});

	it('all instructions have valid structure', () => {
		const instructions = generateInstructions(0);

		for (const inst of instructions) {
			expect(typeof inst.index).toBe('number');
			expect(typeof inst.prompt).toBe('string');
			expect(typeof inst.expectedAction).toBe('string');
			expect(inst.prompt.length).toBeGreaterThan(0);
			expect(inst.expectedAction.length).toBeGreaterThan(0);
		}
	});

	it('indices are sequential from 0 to N-1', () => {
		const instructions = generateInstructions(0);

		for (let i = 0; i < instructions.length; i++) {
			expect(instructions[i].index).toBe(i);
		}
	});

	it('generates different order on subsequent calls (randomization)', () => {
		const orders: string[] = [];

		for (let run = 0; run < 5; run++) {
			const instructions = generateInstructions(0);
			orders.push(instructions.map((i) => i.expectedAction).join(','));
		}

		const uniqueOrders = new Set(orders);
		expect(uniqueOrders.size).toBeGreaterThan(1);
	});

	it('input instructions have different random strings each time', () => {
		const allRandomStrings = new Set<string>();

		for (let run = 0; run < 10; run++) {
			const instructions = generateInstructions(0);

			for (const inst of instructions) {
				if (inst.requiredInput) {
					allRandomStrings.add(inst.requiredInput);
				}
			}
		}

		// Should have many unique random strings
		expect(allRandomStrings.size).toBeGreaterThan(20);
	});

	it('prompts use variations (not always same wording)', () => {
		const promptsPerCommand = new Map<string, Set<string>>();

		for (let run = 0; run < 20; run++) {
			const instructions = generateInstructions(0);

			for (const inst of instructions) {
				const cmdName = inst.expectedAction.split(':')[0];

				if (!promptsPerCommand.has(cmdName)) {
					promptsPerCommand.set(cmdName, new Set());
				}
				promptsPerCommand.get(cmdName)!.add(inst.prompt);
			}
		}

		// At least some commands should have multiple prompt variations seen
		let commandsWithMultiplePrompts = 0;

		for (const prompts of promptsPerCommand.values()) {
			if (prompts.size > 1) {
				commandsWithMultiplePrompts++;
			}
		}

		expect(commandsWithMultiplePrompts).toBeGreaterThan(0);
	});
});

/**
 * Helper Function Tests
 */
describe('Helper Functions', () => {
	it('getExpectedActions extracts actions in order', () => {
		const instructions = generateInstructions(0);
		const actions = getExpectedActions(instructions);

		expect(actions.length).toBe(instructions.length);

		for (let i = 0; i < instructions.length; i++) {
			expect(actions[i]).toBe(instructions[i].expectedAction);
		}
	});

	it('countCommandOccurrences counts base command names correctly', () => {
		const instructions = generateInstructions(0);
		const counts = countCommandOccurrences(instructions);

		// Sum of counts should equal instruction count
		let total = 0;

		for (const count of counts.values()) {
			total += count;
		}
		expect(total).toBe(instructions.length);
	});

	it('countInputInstructions counts correctly', () => {
		const instructions = generateInstructions(0);
		const count = countInputInstructions(instructions);

		const manualCount = instructions.filter((i) => i.requiredInput !== undefined).length;
		expect(count).toBe(manualCount);
	});

	it('meetsInputRequirement validates correctly', () => {
		const instructions = generateInstructions(0);
		const inputCount = countInputInstructions(instructions);

		expect(meetsInputRequirement(instructions, inputCount)).toBe(true);
		expect(meetsInputRequirement(instructions, inputCount + 1)).toBe(false);
		expect(meetsInputRequirement(instructions, 0)).toBe(true);
	});
});

/**
 * Edge Cases and Error Handling
 */
describe('Edge Cases', () => {
	it('throws for negative challenge ID', () => {
		expect(() => generateInstructions(-1)).toThrow('Invalid challenge ID');
	});

	it('throws for challenge ID beyond range', () => {
		expect(() => generateInstructions(99)).toThrow('Invalid challenge ID');
	});

	it('throws for non-integer challenge ID', () => {
		expect(() => generateInstructions(1.5)).toThrow('Invalid challenge ID');
	});

	it('getPoolForChallenge throws for invalid ID', () => {
		expect(() => getPoolForChallenge(-1)).toThrow();
		expect(() => getPoolForChallenge(99)).toThrow();
	});

	it('getInstructionCount throws for invalid ID', () => {
		expect(() => getInstructionCount(-1)).toThrow();
		expect(() => getInstructionCount(99)).toThrow();
	});
});

/**
 * Security-Related Tests
 */
describe('Security Properties', () => {
	it('input commands significantly expand answer space', () => {
		// Without input commands: ~28 possible answers per step
		// With input commands: 28 + N × 144,000 possible answers

		const combinationCount = getCombinationCount();
		const inputCommandCount = TMUX_COMMANDS.filter((c) => c.requiresInput).length;

		// Each input command adds combinationCount possibilities
		const expandedSpace = TMUX_COMMANDS.length + inputCommandCount * combinationCount;

		expect(expandedSpace).toBeGreaterThan(100000);
	});

	it('each input instruction has unique random string', () => {
		const instructions = generateInstructions(0);
		const inputInstructions = instructions.filter((i) => i.requiredInput);
		const randomStrings = inputInstructions.map((i) => i.requiredInput);
		const uniqueStrings = new Set(randomStrings);

		expect(uniqueStrings.size).toBe(randomStrings.length);
	});

	it('expectedAction for input commands cannot be guessed without random string', () => {
		const instructions = generateInstructions(0);
		const inputInst = instructions.find((i) => i.requiredInput);

		if (inputInst) {
			// The expectedAction contains the random string
			expect(inputInst.expectedAction).toContain(inputInst.requiredInput!);

			// Guessing just the command name would not match
			const cmdName = inputInst.expectedAction.split(':')[0];
			expect(inputInst.expectedAction).not.toBe(cmdName);
		}
	});
});

/**
 * Data Consistency Tests
 */
describe('Data Consistency', () => {
	it('all used commands have prompt variations', () => {
		const commandsWithVariations = getCommandsWithVariations();

		for (const cmd of TMUX_COMMANDS) {
			expect(commandsWithVariations).toContain(cmd.name);
		}
	});

	it('all challenge pools are subsets of the full command list', () => {
		const allNames = new Set(TMUX_COMMANDS.map((c) => c.name));

		for (let i = 0; i < getChallengePoolCount(); i++) {
			const pool = getPoolForChallenge(i);

			for (const cmd of pool) {
				expect(allNames.has(cmd.name)).toBe(true);
			}
		}
	});

	it('input commands in pool have requiresInput=true', () => {
		for (let i = 0; i < getChallengePoolCount(); i++) {
			const pool = getPoolForChallenge(i);
			const inputCmds = pool.filter((c) => c.requiresInput);

			for (const cmd of inputCmds) {
				expect(PROMPT_VARIATIONS[cmd.name]).toBeDefined();
				// Input command prompts should contain {input} placeholder
				const hasPlaceholder = PROMPT_VARIATIONS[cmd.name].some((p) => p.includes('{input}'));
				expect(hasPlaceholder).toBe(true);
			}
		}
	});
});
