import { describe, expect, it } from 'vitest';

import {
	CHALLENGE_METADATA,
	getAllChallengeMetadata,
	getChallengePoolCount,
	isValidChallengeId,
	type ChallengeMetadata
} from './challenges';

const EXPECTED_METADATA = [
	{ index: 0, instructionCount: 18, difficultyLabel: 'Beginner' },
	{ index: 1, instructionCount: 26, difficultyLabel: 'Intermediate' },
	{ index: 2, instructionCount: 33, difficultyLabel: 'Intermediate' },
	{ index: 3, instructionCount: 39, difficultyLabel: 'Advanced' },
	{ index: 4, instructionCount: 44, difficultyLabel: 'Advanced' },
	{ index: 5, instructionCount: 48, difficultyLabel: 'Advanced' }
] satisfies ChallengeMetadata[];

describe('challenge metadata', () => {
	it('exposes the tapered instruction counts for the UI', () => {
		expect(CHALLENGE_METADATA).toEqual(EXPECTED_METADATA);
		expect(getAllChallengeMetadata()).toEqual(EXPECTED_METADATA);
	});

	it('starts at 15-20 commands and uses non-increasing increments', () => {
		const counts = CHALLENGE_METADATA.map((challenge) => challenge.instructionCount);
		const increments = counts.slice(1).map((count, index) => count - counts[index]);

		expect(counts[0]).toBeGreaterThanOrEqual(15);
		expect(counts[0]).toBeLessThanOrEqual(20);
		expect(counts[counts.length - 1]).toBeLessThan(100);
		expect(increments).toEqual([8, 7, 6, 5, 4]);
	});

	it('still exposes exactly six valid challenge ids', () => {
		expect(getChallengePoolCount()).toBe(6);

		for (let challengeId = 0; challengeId < EXPECTED_METADATA.length; challengeId++) {
			expect(isValidChallengeId(challengeId)).toBe(true);
		}

		expect(isValidChallengeId(-1)).toBe(false);
		expect(isValidChallengeId(6)).toBe(false);
		expect(isValidChallengeId(1.5)).toBe(false);
	});
});
