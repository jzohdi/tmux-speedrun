import { error } from '@sveltejs/kit';
import {
	getChallengeByIndex,
	getChallengeCount,
	getMaxChallengeIndex,
	getDifficultyLabel,
	type Challenge
} from '$lib/data/challenges';
import type { PageServerLoad } from './$types';

export type ChallengePageData = {
	challenge: Challenge;
	challengeIndex: number;
	totalChallenges: number;
	difficultyLabel: string;
};

export const load: PageServerLoad = async ({ params }): Promise<ChallengePageData> => {
	const id = params.id;
	const numericId = parseInt(id, 10);

	// Validate that the ID is a valid number (0-based)
	if (Number.isNaN(numericId) || numericId < 0) {
		error(404, {
			message: `Invalid challenge ID: "${id}". Challenge IDs must be non-negative numbers.`
		});
	}

	const challenge = getChallengeByIndex(numericId);

	if (!challenge) {
		const maxIndex = getMaxChallengeIndex();
		error(404, {
			message: `Challenge ${numericId} not found. Available challenges: 0-${maxIndex}.`
		});
	}

	return {
		challenge,
		challengeIndex: numericId,
		totalChallenges: getChallengeCount(),
		difficultyLabel: getDifficultyLabel(challenge.difficulty)
	};
};
