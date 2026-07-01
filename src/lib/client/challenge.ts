/**
 * Client-side challenge service.
 *
 * Manages the complete challenge flow:
 * 1. Start challenge - ECDH key exchange, receive encrypted steps
 * 2. Decrypt steps progressively as user provides correct answers
 * 3. Submit proof upon completion
 *
 * This module uses the shared crypto utilities from $lib/crypto.
 */

import {
	generateKeyPairForExchange,
	ecdhExchange,
	base64ToBytes,
	bytesToBase64,
	bufferToBytes
} from '$lib/crypto';
import { hkdf, sha256 } from '$lib/crypto/hkdf';
import { aesGcmDecrypt } from '$lib/crypto/aes-gcm';
import { bytesToString } from '$lib/crypto/utils';

/**
 * Step payload after decryption.
 */
export type DecryptedStep = {
	prompt: string;
	requiredInput?: string;
	seedInput?: string;
};

/**
 * Encrypted step from the server.
 */
export type EncryptedStep = {
	index: number;
	nonceB64: string;
	ciphertextB64: string;
};

/**
 * Challenge state during an active session.
 */
export type ChallengeState = {
	challengeId: number;
	currentStepIndex: number;
	totalSteps: number;
	currentPrompt: string | null;
	currentRequiredInput: string | null;
	currentSeedInput: string | null;
	isComplete: boolean;
	startTime: number;
};

/**
 * Result from finishing a challenge.
 *
 * Iteration 2 (PR #36 feedback): an anonymous finish is DEFERRED — the server
 * returns `recorded: false` with a provisional rank until the user saves under a
 * free-text name or a verified GitHub identity via `record()`. A signed-in
 * finish still records immediately (`recorded: true`, with `username`).
 */
export type ChallengeResult = {
	valid: boolean;
	durationMs: number;
	recorded?: boolean;
	leaderboardPosition?: number; // provisional (anon finish) or final
	username?: string | null; // present when recorded by the server
	message?: string;
};

/**
 * Result from the explicit record step (POST /api/challenge/record).
 */
export type RecordResult = {
	recorded: true;
	leaderboardPosition?: number;
	username: string | null;
};

/**
 * Client-side challenge session manager.
 *
 * Holds the cryptographic state needed to decrypt steps and derive proofs.
 */
export class ChallengeSession {
	private challengeId: number;
	private encryptedSteps: EncryptedStep[];
	private currentKeyRaw: ArrayBuffer;
	private currentStepIndex: number;
	private totalSteps: number;
	private startTime: number;

	private constructor(
		challengeId: number,
		encryptedSteps: EncryptedStep[],
		k0: ArrayBuffer,
		startTime: number
	) {
		this.challengeId = challengeId;
		this.encryptedSteps = encryptedSteps;
		this.currentKeyRaw = k0;
		this.currentStepIndex = 0;
		this.totalSteps = encryptedSteps.length;
		this.startTime = startTime;
	}

	/**
	 * Start a new challenge session.
	 *
	 * Performs ECDH key exchange with the server and initializes the session.
	 *
	 * @param challengeId - The challenge level (0-5)
	 * @returns A new ChallengeSession ready for step decryption
	 * @throws Error if the server request fails
	 */
	static async start(challengeId: number): Promise<ChallengeSession> {
		// Generate client ECDH key pair
		const { keyPair, publicKeyJwk } = await generateKeyPairForExchange();

		// Call server to start challenge
		const response = await fetch('/api/challenge/start', {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				challengeId,
				clientPublicKeyJwk: publicKeyJwk
			})
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({ message: 'Unknown error' }));
			throw new Error(error.message || `Failed to start challenge: ${response.status}`);
		}

		const data = await response.json();
		const { serverPublicKeyJwk, sessionSaltB64, steps } = data;

		// Derive shared secret
		const sharedSecret = await ecdhExchange(keyPair.privateKey, serverPublicKeyJwk);

		// Derive K0
		const sessionSalt = base64ToBytes(sessionSaltB64);
		const k0 = await deriveK0(sharedSecret, sessionSalt);

		return new ChallengeSession(challengeId, steps, k0, Date.now());
	}

	/**
	 * Get the current challenge state.
	 */
	getState(): ChallengeState {
		return {
			challengeId: this.challengeId,
			currentStepIndex: this.currentStepIndex,
			totalSteps: this.totalSteps,
			currentPrompt: null, // Will be set after decryption
			currentRequiredInput: null,
			currentSeedInput: null,
			isComplete: this.currentStepIndex >= this.totalSteps,
			startTime: this.startTime
		};
	}

	/**
	 * Decrypt the current step.
	 *
	 * @returns The decrypted step payload
	 * @throws Error if decryption fails (shouldn't happen on first step)
	 */
	async decryptCurrentStep(): Promise<DecryptedStep> {
		if (this.currentStepIndex >= this.totalSteps) {
			throw new Error('No more steps to decrypt');
		}

		const encryptedStep = this.encryptedSteps[this.currentStepIndex];

		return decryptStep(this.currentKeyRaw, encryptedStep);
	}

	/**
	 * Attempt to advance to the next step using the provided answer.
	 *
	 * If the answer is correct, derives the next key and advances.
	 * If incorrect, decryption will fail and false is returned.
	 *
	 * @param answer - The canonical action (e.g., "split-vertical" or "rename-window:swift-tiger-42")
	 * @returns true if answer was correct and advanced to next step
	 */
	async submitAnswer(answer: string): Promise<boolean> {
		if (this.currentStepIndex >= this.totalSteps) {
			return false;
		}

		// Derive next key using the answer
		const nextKey = await deriveNextKey(this.currentKeyRaw, answer, this.currentStepIndex);

		// Check if we've completed all steps
		if (this.currentStepIndex + 1 >= this.totalSteps) {
			// This was the last step, store the final key for proof
			this.currentKeyRaw = nextKey;
			this.currentStepIndex++;

			return true;
		}

		// Try to decrypt the next step with the derived key
		const nextEncryptedStep = this.encryptedSteps[this.currentStepIndex + 1];

		try {
			await decryptStep(nextKey, nextEncryptedStep);
			// Decryption succeeded - answer was correct
			this.currentKeyRaw = nextKey;
			this.currentStepIndex++;

			return true;
		} catch {
			// Decryption failed - answer was wrong
			return false;
		}
	}

	/**
	 * Check if the challenge is complete.
	 */
	isComplete(): boolean {
		return this.currentStepIndex >= this.totalSteps;
	}

	/**
	 * Get the current step index (0-based).
	 */
	getCurrentStepIndex(): number {
		return this.currentStepIndex;
	}

	/**
	 * Get the total number of steps.
	 */
	getTotalSteps(): number {
		return this.totalSteps;
	}

	/**
	 * Get elapsed time in milliseconds.
	 */
	getElapsedTime(): number {
		return Date.now() - this.startTime;
	}

	/**
	 * Submit the final proof to the server.
	 *
	 * @returns Challenge result with validity and timing
	 * @throws Error if not complete or server request fails
	 */
	async finish(): Promise<ChallengeResult> {
		if (!this.isComplete()) {
			throw new Error('Cannot finish incomplete challenge');
		}

		// The current key after all steps is Kfinal (the proof)
		const proofB64 = bytesToBase64(bufferToBytes(this.currentKeyRaw));

		const response = await fetch('/api/challenge/finish', {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ proofB64 })
		});

		if (!response.ok) {
			const error = await response.json().catch(() => ({ message: 'Unknown error' }));
			throw new Error(error.message || `Failed to finish challenge: ${response.status}`);
		}

		return response.json();
	}

	/**
	 * Record a deferred (anonymous) result to the leaderboard.
	 *
	 * The server reads the deferred result from the signed pending-result cookie
	 * and resolves identity server-side: when the user is signed in, the verified
	 * GitHub identity wins and `username` here is ignored; otherwise the optional
	 * free-text name is used (blank → Anonymous).
	 *
	 * @param username - Optional free-text name (ignored when signed in)
	 * @returns The final record result with resolved username + rank
	 * @throws Error if the server request fails (e.g. no valid pending result)
	 */
	async record(username?: string): Promise<RecordResult> {
		return recordChallenge(username);
	}
}

/**
 * Record a deferred (anonymous) result to the leaderboard.
 *
 * Standalone (not tied to a live session) so it also drives the post-OAuth
 * hydration path, where the completion screen is rebuilt from a server-provided
 * pending result and there is no in-memory `ChallengeSession`. The deferred
 * result travels in the signed pending-result cookie; identity is resolved
 * server-side (verified GitHub identity wins over any `username` here).
 *
 * @param username - Optional free-text name (ignored when signed in)
 * @returns The final record result with resolved username + rank
 * @throws Error if the server request fails (e.g. no valid pending result)
 */
export async function recordChallenge(username?: string): Promise<RecordResult> {
	const response = await fetch('/api/challenge/record', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(username ? { username } : {})
	});

	if (!response.ok) {
		const error = await response.json().catch(() => ({ message: 'Unknown error' }));
		throw new Error(error.message || `Failed to record time: ${response.status}`);
	}

	return response.json();
}

/**
 * Derive K0 from shared secret and session salt.
 */
async function deriveK0(
	sharedSecret: ArrayBuffer,
	sessionSalt: Uint8Array<ArrayBuffer>
): Promise<ArrayBuffer> {
	return hkdf(sharedSecret, sessionSalt, 'k0', 32);
}

/**
 * Derive the next key in the chain.
 *
 * Kn+1 = HKDF(Kn, SHA256(answer), "step-{n+1}")
 */
async function deriveNextKey(
	currentKey: ArrayBuffer,
	answer: string,
	stepIndex: number
): Promise<ArrayBuffer> {
	const answerHash = await sha256(answer);

	return hkdf(currentKey, new Uint8Array(answerHash), `step-${stepIndex + 1}`, 32);
}

/**
 * Decrypt a step payload.
 */
async function decryptStep(key: ArrayBuffer, encryptedStep: EncryptedStep): Promise<DecryptedStep> {
	const nonce = base64ToBytes(encryptedStep.nonceB64);
	const ciphertext = base64ToBytes(encryptedStep.ciphertextB64);

	const plaintext = await aesGcmDecrypt(key, nonce, ciphertext);

	return JSON.parse(bytesToString(plaintext)) as DecryptedStep;
}

/**
 * Format duration in a human-readable way.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string like "12.3s" or "1m 23.4s"
 */
export function formatDuration(ms: number): string {
	const seconds = ms / 1000;

	if (seconds < 60) {
		return `${seconds.toFixed(1)}s`;
	}

	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;

	return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
}
