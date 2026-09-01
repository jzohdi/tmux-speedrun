/**
 * Challenge state store using Svelte 5 runes.
 *
 * This store manages the reactive state for an active challenge session.
 * Components can import and use this to display prompts, progress, and results.
 */

import {
	ChallengeSession,
	recordChallenge,
	type ChallengeResult,
	formatDuration
} from './challenge';

/**
 * Challenge status enum.
 */
export type ChallengeStatus = 'idle' | 'loading' | 'active' | 'submitting' | 'complete' | 'error';

/**
 * Feedback for the last answer attempt.
 */
export type AnswerFeedback = {
	correct: boolean;
	message: string;
};

/**
 * Creates a reactive challenge store.
 *
 * Usage:
 * ```svelte
 * <script>
 *   import { createChallengeStore } from '$lib/client/challenge-store.svelte';
 *   const challenge = createChallengeStore();
 *
 *   // Start a challenge
 *   await challenge.start(0);
 *
 *   // Submit an answer
 *   await challenge.submitAnswer('split-vertical');
 * </script>
 *
 * {#if challenge.status === 'active'}
 *   <p>{challenge.currentPrompt}</p>
 * {/if}
 * ```
 */
export function createChallengeStore() {
	// Reactive state
	let status = $state<ChallengeStatus>('idle');
	let challengeId = $state<number | null>(null);
	let currentStepIndex = $state(0);
	let totalSteps = $state(0);
	let currentPrompt = $state<string | null>(null);
	let currentRequiredInput = $state<string | null>(null);
	let currentSeedInput = $state<string | null>(null);
	let lastFeedback = $state<AnswerFeedback | null>(null);
	let result = $state<ChallengeResult | null>(null);
	let error = $state<string | null>(null);
	let elapsedMs = $state(0);

	// Private session reference
	let session: ChallengeSession | null = null;
	let timerInterval: ReturnType<typeof setInterval> | null = null;

	// Derived state
	const isComplete = $derived(status === 'complete');
	const isActive = $derived(status === 'active');
	const progress = $derived(totalSteps > 0 ? (currentStepIndex / totalSteps) * 100 : 0);
	const formattedTime = $derived(formatDuration(elapsedMs));

	/**
	 * Start the elapsed time timer.
	 */
	function startTimer() {
		stopTimer();
		timerInterval = setInterval(() => {
			if (session) {
				elapsedMs = session.getElapsedTime();
			}
		}, 100);
	}

	/**
	 * Stop the elapsed time timer.
	 */
	function stopTimer() {
		if (timerInterval) {
			clearInterval(timerInterval);
			timerInterval = null;
		}
	}

	/**
	 * Start a new challenge.
	 *
	 * @param id - The challenge level (0-5)
	 */
	async function start(id: number) {
		// Reset state
		status = 'loading';
		challengeId = id;
		currentStepIndex = 0;
		totalSteps = 0;
		currentPrompt = null;
		currentRequiredInput = null;
		currentSeedInput = null;
		lastFeedback = null;
		result = null;
		error = null;
		elapsedMs = 0;

		try {
			// Start the challenge session
			session = await ChallengeSession.start(id);
			totalSteps = session.getTotalSteps();

			// Decrypt the first step
			const step = await session.decryptCurrentStep();
			currentPrompt = step.prompt;
			currentRequiredInput = step.requiredInput ?? null;
			currentSeedInput = step.seedInput ?? null;

			// Start timer and set active
			startTimer();
			status = 'active';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to start challenge';
			status = 'error';
			session = null;
		}
	}

	/**
	 * Submit an answer for the current step.
	 *
	 * @param answer - The canonical action (e.g., "split-vertical")
	 * @returns true if the answer was correct
	 */
	async function submitAnswer(answer: string): Promise<boolean> {
		if (!session || status !== 'active') {
			console.debug('[Challenge] submitAnswer skipped - session:', !!session, 'status:', status);
			return false;
		}

		console.debug(
			'[Challenge] Submitting answer:',
			answer,
			'for step:',
			currentStepIndex + 1,
			'/',
			totalSteps
		);
		console.debug('[Challenge] Current prompt:', currentPrompt);

		const wasCorrect = await session.submitAnswer(answer);

		console.debug('[Challenge] Answer result:', wasCorrect ? 'CORRECT' : 'INCORRECT');

		if (wasCorrect) {
			currentStepIndex = session.getCurrentStepIndex();

			if (session.isComplete()) {
				// All steps verified locally (the last one against the final-check
				// step) — submit the proof to the server to record the time.
				console.debug('[Challenge] All steps complete, submitting proof to server...');
				lastFeedback = { correct: true, message: 'Verifying...' };
				await finishChallenge();
			} else {
				// We know it's correct because the next step decrypted
				lastFeedback = { correct: true, message: 'Correct!' };
				// Decrypt next step
				const step = await session.decryptCurrentStep();
				currentPrompt = step.prompt;
				currentRequiredInput = step.requiredInput ?? null;
				currentSeedInput = step.seedInput ?? null;
				console.debug('[Challenge] Next prompt:', currentPrompt);
			}
		} else {
			lastFeedback = { correct: false, message: 'Incorrect. Try again!' };
		}

		return wasCorrect;
	}

	/**
	 * Finish the challenge and get results.
	 */
	async function finishChallenge() {
		if (!session) {
			return;
		}

		stopTimer();
		status = 'submitting';

		try {
			result = await session.finish();
			elapsedMs = result.durationMs;
			status = 'complete';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to submit results';
			status = 'error';
		}
	}

	/**
	 * Seed the completion view from a server-provided pending result.
	 *
	 * Used on the post-OAuth hydration path (§I9): the challenge page returns a
	 * `pendingResult` from the signed cookie, and we render the completion overlay
	 * without an in-memory session (the OAuth round-trip destroyed it). The seeded
	 * result is a deferred anonymous finish: `{ valid: true, recorded: false }`.
	 *
	 * @param id - The challenge index this pending result belongs to
	 * @param durationMs - The just-completed time carried in the pending cookie
	 */
	function hydratePending(id: number, durationMs: number) {
		stopTimer();
		session = null;
		challengeId = id;
		elapsedMs = durationMs;
		lastFeedback = null;
		error = null;
		result = { valid: true, durationMs, recorded: false };
		status = 'complete';
	}

	/**
	 * Record a deferred result to the leaderboard.
	 *
	 * Resolves identity entirely server-side: a verified GitHub session records
	 * under that username, otherwise the entry is Anonymous (`username: null`).
	 * No client-supplied name is sent (iteration 3). Updates `result` with the
	 * final rank + resolved username.
	 *
	 * @returns true when the record succeeded
	 */
	async function record(): Promise<boolean> {
		if (!result || !result.valid || result.recorded) {
			return false;
		}

		try {
			const recordResult = await recordChallenge();
			result = {
				...result,
				recorded: true,
				leaderboardPosition: recordResult.leaderboardPosition,
				username: recordResult.username
			};
			return true;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to record time';
			return false;
		}
	}

	/**
	 * Reset the store to initial state.
	 */
	function reset() {
		stopTimer();
		status = 'idle';
		challengeId = null;
		currentStepIndex = 0;
		totalSteps = 0;
		currentPrompt = null;
		currentRequiredInput = null;
		currentSeedInput = null;
		lastFeedback = null;
		result = null;
		error = null;
		elapsedMs = 0;
		session = null;
	}

	/**
	 * Clear the last feedback message.
	 */
	function clearFeedback() {
		lastFeedback = null;
	}

	// Return reactive getters and actions
	return {
		// Reactive state (read-only via getters)
		get status() {
			return status;
		},
		get challengeId() {
			return challengeId;
		},
		get currentStepIndex() {
			return currentStepIndex;
		},
		get totalSteps() {
			return totalSteps;
		},
		get currentPrompt() {
			return currentPrompt;
		},
		get currentRequiredInput() {
			return currentRequiredInput;
		},
		get currentSeedInput() {
			return currentSeedInput;
		},
		get lastFeedback() {
			return lastFeedback;
		},
		get result() {
			return result;
		},
		get error() {
			return error;
		},
		get elapsedMs() {
			return elapsedMs;
		},
		// Derived state
		get isComplete() {
			return isComplete;
		},
		get isActive() {
			return isActive;
		},
		get progress() {
			return progress;
		},
		get formattedTime() {
			return formattedTime;
		},
		// Whether the current result has been recorded to the leaderboard.
		get recorded() {
			return result?.recorded ?? false;
		},
		// The username the result was recorded under (null = Anonymous), if any.
		get recordedUsername() {
			return result?.username ?? null;
		},
		// Actions
		start,
		submitAnswer,
		record,
		hydratePending,
		reset,
		clearFeedback
	};
}

/**
 * Type for the challenge store.
 */
export type ChallengeStore = ReturnType<typeof createChallengeStore>;
