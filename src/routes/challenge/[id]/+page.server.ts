import { error } from '@sveltejs/kit';
import {
	getChallengeByIndex,
	getChallengeCount,
	getMaxChallengeIndex,
	getDifficultyLabel,
	type Challenge
} from '$lib/data/challenges';
import { PENDING_RESULT_COOKIE_NAME } from '$lib/server/env';
import { verifyPendingResultToken } from '$lib/server/challenges/pending';
import type { SessionUser } from '$lib/server/auth/session';
import type { PageServerLoad } from './$types';

export type ChallengePageData = {
	challenge: Challenge;
	challengeIndex: number;
	totalChallenges: number;
	difficultyLabel: string;
	// Iteration 2 (PR #36 feedback): make the completion flow durable across the
	// full-page GitHub OAuth round-trip.
	user: SessionUser | null;
	pendingResult: { durationMs: number } | null;
};

export const load: PageServerLoad = async ({
	params,
	cookies,
	locals
}): Promise<ChallengePageData> => {
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

	// Re-hydrate a just-finished (deferred) result across the OAuth redirect: if a
	// signed pending-result cookie verifies AND belongs to this challenge, expose
	// its time so the completion overlay can be rebuilt server-side.
	let pendingResult: { durationMs: number } | null = null;
	const pending = await verifyPendingResultToken(cookies.get(PENDING_RESULT_COOKIE_NAME) ?? '');
	if (pending && pending.challengeId === numericId) {
		pendingResult = { durationMs: pending.durationMs };
	}

	return {
		challenge,
		challengeIndex: numericId,
		totalChallenges: getChallengeCount(),
		difficultyLabel: getDifficultyLabel(challenge.difficulty),
		user: locals.user,
		pendingResult
	};
};
