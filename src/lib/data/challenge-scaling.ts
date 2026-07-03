/**
 * Shared instruction-count scaling for challenge runs.
 *
 * Keep this module client-safe so both UI metadata and server challenge pools
 * can import the same values without drifting.
 */
export const BASE_INSTRUCTION_COUNT = 18;

export const INSTRUCTION_INCREMENTS = [8, 7, 6, 5, 4] as const;

export const CHALLENGE_INSTRUCTION_COUNTS = buildChallengeInstructionCounts(
	BASE_INSTRUCTION_COUNT,
	INSTRUCTION_INCREMENTS
);

export function getInstructionCountForChallenge(index: number): number {
	if (!Number.isInteger(index) || index < 0 || index >= CHALLENGE_INSTRUCTION_COUNTS.length) {
		throw new Error(
			`Invalid challenge index: ${index}. Valid range is 0-${CHALLENGE_INSTRUCTION_COUNTS.length - 1}`
		);
	}

	return CHALLENGE_INSTRUCTION_COUNTS[index];
}

function buildChallengeInstructionCounts(
	baseInstructionCount: number,
	instructionIncrements: readonly [number, number, number, number, number]
) {
	const [firstIncrement, secondIncrement, thirdIncrement, fourthIncrement, fifthIncrement] =
		instructionIncrements;

	return [
		baseInstructionCount,
		baseInstructionCount + firstIncrement,
		baseInstructionCount + firstIncrement + secondIncrement,
		baseInstructionCount + firstIncrement + secondIncrement + thirdIncrement,
		baseInstructionCount + firstIncrement + secondIncrement + thirdIncrement + fourthIncrement,
		baseInstructionCount +
			firstIncrement +
			secondIncrement +
			thirdIncrement +
			fourthIncrement +
			fifthIncrement
	] as const;
}
