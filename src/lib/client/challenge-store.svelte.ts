/**
 * Challenge state store using Svelte 5 runes.
 *
 * This store manages the reactive state for an active challenge session.
 * Components can import and use this to display prompts, progress, and results.
 */

import { ChallengeSession, type DecryptedStep, type ChallengeResult, formatDuration } from './challenge';

/**
 * Challenge status enum.
 */
export type ChallengeStatus =
	| 'idle'
	| 'loading'
	| 'active'
	| 'submitting'
	| 'complete'
	| 'error';

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
			return false;
		}

		const wasCorrect = await session.submitAnswer(answer);

		if (wasCorrect) {
			currentStepIndex = session.getCurrentStepIndex();
			lastFeedback = { correct: true, message: 'Correct!' };

			if (session.isComplete()) {
				// Challenge complete - submit proof
				await finishChallenge();
			} else {
				// Decrypt next step
				const step = await session.decryptCurrentStep();
				currentPrompt = step.prompt;
				currentRequiredInput = step.requiredInput ?? null;
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
		// Actions
		start,
		submitAnswer,
		reset,
		clearFeedback
	};
}

/**
 * Type for the challenge store.
 */
export type ChallengeStore = ReturnType<typeof createChallengeStore>;

