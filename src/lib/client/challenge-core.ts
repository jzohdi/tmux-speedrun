/**
 * Shared, pure challenge key-chain / step helpers.
 *
 * Extracted from `challenge.ts` so both the web `ChallengeSession` and the
 * `tmux-speedrun` CLI (issue #35) import identical logic — guaranteeing the
 * CLI's derived proof matches the server byte-for-byte (interface §1, invariant
 * CC1). These functions are transport-free and depend only on `$lib/crypto`,
 * whose primitives use Web-Crypto globals available in both browsers and Node ≥ 20.
 */

import { base64ToBytes, bytesToString } from '$lib/crypto';
import { hkdf, sha256 } from '$lib/crypto/hkdf';
import { aesGcmDecrypt } from '$lib/crypto/aes-gcm';

/** Step payload after decryption. */
export type DecryptedStep = {
	prompt: string;
	requiredInput?: string;
	seedInput?: string;
};

/** Encrypted step from the server. */
export type EncryptedStep = {
	index: number;
	nonceB64: string;
	ciphertextB64: string;
};

/** K0 = HKDF(sharedSecret, sessionSalt, "k0", 32). */
export async function deriveK0(
	sharedSecret: ArrayBuffer,
	sessionSalt: Uint8Array<ArrayBuffer>
): Promise<ArrayBuffer> {
	return hkdf(sharedSecret, sessionSalt, 'k0', 32);
}

/** K(n+1) = HKDF(Kn, SHA256(answer), `step-${stepIndex+1}`, 32). */
export async function deriveNextKey(
	currentKey: ArrayBuffer,
	answer: string,
	stepIndex: number
): Promise<ArrayBuffer> {
	const answerHash = await sha256(answer);

	return hkdf(currentKey, new Uint8Array(answerHash), `step-${stepIndex + 1}`, 32);
}

/**
 * AES-GCM decrypt + JSON.parse → DecryptedStep. Throws on the wrong key
 * (auth-tag failure) — this is the trial-decrypt correctness check.
 */
export async function decryptStep(key: ArrayBuffer, step: EncryptedStep): Promise<DecryptedStep> {
	const nonce = base64ToBytes(step.nonceB64);
	const ciphertext = base64ToBytes(step.ciphertextB64);

	const plaintext = await aesGcmDecrypt(key, nonce, ciphertext);

	return JSON.parse(bytesToString(plaintext)) as DecryptedStep;
}

/**
 * Resolve the REAL step count from a start response.
 *
 * Servers that honor `finalCheck: true` report `totalSteps` (the real count)
 * and append one extra final-check step to `steps`; a legacy server sends no
 * `totalSteps`, and every entry in `steps` is a real step. Anything outside
 * the sane range falls back to the legacy reading.
 */
export function resolveTotalSteps(steps: EncryptedStep[], totalSteps: unknown): number {
	return typeof totalSteps === 'number' &&
		Number.isInteger(totalSteps) &&
		totalSteps >= 1 &&
		totalSteps <= steps.length
		? totalSteps
		: steps.length;
}

/**
 * Attempt to advance the key chain past `stepIndex` using `answer`.
 *
 * Correctness is checked by trial-decrypting `verifyStep` — the next encrypted
 * step. For the last REAL step the server appends a "final-check" step
 * encrypted under Kfinal (requested via `finalCheck: true` at
 * /api/challenge/start), so even the final answer is verified locally: a wrong
 * command returns null and the caller stays on the step instead of submitting
 * a corrupted proof and failing the whole run.
 *
 * `verifyStep` may be undefined when talking to a legacy server that sends no
 * final-check step. The answer is then accepted unverified (the server still
 * rejects a bad Kfinal at /finish) — the historical last-step behavior.
 *
 * @returns The next key on success, or null when the answer is wrong
 *   (AES-GCM auth-tag failure on the trial decrypt).
 */
export async function tryAdvanceKey(
	currentKey: ArrayBuffer,
	answer: string,
	stepIndex: number,
	verifyStep: EncryptedStep | undefined
): Promise<ArrayBuffer | null> {
	const nextKey = await deriveNextKey(currentKey, answer, stepIndex);

	if (verifyStep === undefined) {
		return nextKey;
	}

	try {
		await decryptStep(nextKey, verifyStep);

		return nextKey;
	} catch {
		return null;
	}
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
