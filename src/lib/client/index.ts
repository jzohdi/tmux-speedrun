/**
 * Client-side challenge utilities.
 *
 * This module provides everything needed for the client to participate
 * in challenges: session management, state stores, and utilities.
 */

// Challenge session and utilities
export {
	ChallengeSession,
	formatDuration,
	type DecryptedStep,
	type EncryptedStep,
	type ChallengeState,
	type ChallengeResult
} from './challenge';

// Svelte runes-based state store
export {
	createChallengeStore,
	type ChallengeStore,
	type ChallengeStatus,
	type AnswerFeedback
} from './challenge-store.svelte';

